from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "evaluate_tn5000_voc.py"
SPEC = importlib.util.spec_from_file_location("evaluate_tn5000_voc", SCRIPT_PATH)
assert SPEC is not None
evaluate_tn5000_voc = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["evaluate_tn5000_voc"] = evaluate_tn5000_voc
SPEC.loader.exec_module(evaluate_tn5000_voc)


class EvaluateTn5000VocTest(unittest.TestCase):
    def test_evaluates_valid_voc_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tn5000"
            output = Path(tmp) / "out"
            create_sample(root, "000001", split="train", bbox=(2, 3, 12, 18))
            create_sample(root, "000002", split="val", bbox=(5, 6, 20, 24))
            create_sample(root, "000003", split="test", bbox=(1, 2, 10, 12))
            write_trainval(root, ["000001", "000002"])

            summary = evaluate_tn5000_voc.evaluate_dataset(
                dataset_root=root,
                output_root=output,
            )

            self.assertTrue(summary["verdict"]["strict_detector_usable"])
            self.assertEqual(summary["file_counts"]["images"], 3)
            self.assertEqual(summary["file_counts"]["boxes"], 3)
            self.assertEqual(summary["split_counts"]["train"], 1)
            self.assertEqual(summary["split_counts"]["val"], 1)
            self.assertEqual(summary["split_counts"]["test"], 1)
            self.assertEqual(summary["annotation_profile"]["class_counts"], {"0": 3})
            self.assertEqual(summary["label_mapping"], {})
            self.assertEqual(summary["issues"]["counts"]["invalid_boxes"], 0)
            self.assertTrue((output / "summary.json").is_file())
            self.assertTrue((output / "evaluation.md").is_file())

    def test_flags_out_of_bounds_bbox_and_split_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tn5000"
            output = Path(tmp) / "out"
            create_sample(root, "000001", split="train", bbox=(2, 3, 30, 18))
            append_split(root, "val", "000001")
            write_trainval(root, ["000001"])

            summary = evaluate_tn5000_voc.evaluate_dataset(
                dataset_root=root,
                output_root=output,
            )

            self.assertFalse(summary["verdict"]["strict_detector_usable"])
            self.assertEqual(summary["issues"]["counts"]["out_of_bounds_boxes"], 1)
            self.assertEqual(summary["issues"]["counts"]["train_val_test_overlap"], 1)

    def test_reports_binary_label_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tn5000"
            output = Path(tmp) / "out"
            create_sample(root, "000001", split="train", bbox=(2, 3, 12, 18), class_name="0")
            create_sample(root, "000002", split="val", bbox=(5, 6, 20, 24), class_name="1")
            create_sample(root, "000003", split="test", bbox=(1, 2, 10, 12), class_name="1")
            write_trainval(root, ["000001", "000002"])

            summary = evaluate_tn5000_voc.evaluate_dataset(
                dataset_root=root,
                output_root=output,
            )

            self.assertEqual(summary["label_mapping"]["0"], "benign_thyroid_nodule")
            self.assertEqual(summary["label_mapping"]["1"], "malignant_thyroid_nodule")


def create_sample(
    root: Path,
    image_id: str,
    *,
    split: str,
    bbox: tuple[int, int, int, int],
    class_name: str = "0",
) -> None:
    (root / "JPEGImages").mkdir(parents=True, exist_ok=True)
    (root / "Annotations").mkdir(parents=True, exist_ok=True)
    (root / "ImageSets" / "Main").mkdir(parents=True, exist_ok=True)

    color_seed = int(image_id)
    Image.new(
        "RGB",
        (24, 24),
        (color_seed % 255, (color_seed * 3) % 255, (color_seed * 7) % 255),
    ).save(root / "JPEGImages" / f"{image_id}.jpg")
    left, top, right, bottom = bbox
    (root / "Annotations" / f"{image_id}.xml").write_text(
        f"""<annotation>
  <folder>VOC2007</folder>
  <filename>{image_id}.jpg</filename>
  <size><width>24</width><height>24</height><depth>3</depth></size>
  <object>
    <name>{class_name}</name>
    <bndbox>
      <xmin>{left}</xmin><ymin>{top}</ymin><xmax>{right}</xmax><ymax>{bottom}</ymax>
    </bndbox>
  </object>
</annotation>
""",
        encoding="utf-8",
    )
    append_split(root, split, image_id)


def append_split(root: Path, split: str, image_id: str) -> None:
    path = root / "ImageSets" / "Main" / f"{split}.txt"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{image_id}\n")


def write_trainval(root: Path, image_ids: list[str]) -> None:
    path = root / "ImageSets" / "Main" / "trainval.txt"
    path.write_text("\n".join(image_ids) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
