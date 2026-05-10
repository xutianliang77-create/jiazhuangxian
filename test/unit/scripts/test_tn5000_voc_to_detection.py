from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "tn5000_voc_to_detection.py"
SPEC = importlib.util.spec_from_file_location("tn5000_voc_to_detection", SCRIPT_PATH)
assert SPEC is not None
tn5000_voc_to_detection = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["tn5000_voc_to_detection"] = tn5000_voc_to_detection
SPEC.loader.exec_module(tn5000_voc_to_detection)


class Tn5000VocToDetectionTest(unittest.TestCase):
    def test_cleans_merges_duplicate_frames_and_writes_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tn5000"
            output = Path(tmp) / "out"
            create_sample(root, "000001", split="train", bbox=(2, 3, 12, 18), class_name="1", color=(30, 30, 30))
            create_sample(root, "000002", split="val", bbox=(5, 6, 20, 24), class_name="1", color=(30, 30, 30))
            create_sample(root, "000003", split="test", bbox=(1, 2, 10, 12), class_name="0", color=(90, 90, 90))
            create_sample(
                root,
                "000004",
                split="train",
                bbox=(1, 1, 4, 4),
                class_name="0",
                color=(120, 120, 120),
                xml_size=(30, 30),
            )
            create_sample(root, "000005", split="train", bbox=(1, 1, 30, 4), class_name="0", color=(150, 150, 150))

            summary = tn5000_voc_to_detection.convert_dataset(
                dataset_root=root,
                output_root=output,
                train_ratio=0.5,
                seed=123,
                image_mode="copy",
                class_mode="collapsed",
            )

            self.assertEqual(summary["raw"]["valid_original_samples"], 3)
            self.assertEqual(summary["raw"]["skipped"]["dimension_mismatch"]["count"], 1)
            self.assertEqual(summary["raw"]["skipped"]["invalid_or_out_of_bounds_box"]["count"], 1)
            self.assertEqual(summary["merge"]["unique_image_hashes"], 2)
            self.assertEqual(summary["merge"]["merged_duplicate_hash_groups"], 1)
            self.assertEqual(summary["total"]["images"], 2)
            self.assertEqual(summary["total"]["boxes"], 3)
            self.assertEqual(summary["total"]["images_with_multiple_boxes"], 1)

            rows = [
                json.loads(line)
                for line in (output / "annotations" / "manifest.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            merged = next(row for row in rows if row["object_count"] == 2)
            self.assertEqual(merged["source_image_ids"], ["000001", "000002"])
            self.assertEqual(merged["yolo_class_ids"], [0, 0])
            self.assertTrue((output / "coco" / "train.json").is_file())
            self.assertTrue((output / "yolo" / "data.yaml").is_file())
            label_text = "\n".join(path.read_text(encoding="utf-8").strip() for path in (output / "yolo" / "labels").rglob("*.txt"))
            self.assertIn("0 0.291667 0.437500 0.416667 0.625000", label_text)
            self.assertIn("0 0.520833 0.625000 0.625000 0.750000", label_text)


def create_sample(
    root: Path,
    image_id: str,
    *,
    split: str,
    bbox: tuple[int, int, int, int],
    class_name: str,
    color: tuple[int, int, int],
    xml_size: tuple[int, int] = (24, 24),
) -> None:
    (root / "JPEGImages").mkdir(parents=True, exist_ok=True)
    (root / "Annotations").mkdir(parents=True, exist_ok=True)
    (root / "ImageSets" / "Main").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (24, 24), color).save(root / "JPEGImages" / f"{image_id}.jpg")
    left, top, right, bottom = bbox
    xml_width, xml_height = xml_size
    (root / "Annotations" / f"{image_id}.xml").write_text(
        f"""<annotation>
  <folder>VOC2007</folder>
  <filename>{image_id}.jpg</filename>
  <size><width>{xml_width}</width><height>{xml_height}</height><depth>3</depth></size>
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
    with (root / "ImageSets" / "Main" / f"{split}.txt").open("a", encoding="utf-8") as handle:
        handle.write(f"{image_id}\n")


if __name__ == "__main__":
    unittest.main()
