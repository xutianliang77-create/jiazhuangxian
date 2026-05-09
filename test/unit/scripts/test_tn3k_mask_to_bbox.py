from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "tn3k_mask_to_bbox.py"
SPEC = importlib.util.spec_from_file_location("tn3k_mask_to_bbox", SCRIPT_PATH)
assert SPEC is not None
tn3k_mask_to_bbox = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["tn3k_mask_to_bbox"] = tn3k_mask_to_bbox
SPEC.loader.exec_module(tn3k_mask_to_bbox)


class Tn3kMaskToBboxTest(unittest.TestCase):
    def test_converts_masks_to_yolo_coco_and_manifest_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tn3k"
            output = Path(tmp) / "out"
            create_sample(root, "trainval", "0001.jpg", label=1, bbox=(2, 3, 6, 8))
            create_sample(root, "test", "0002.jpg", label=0, bbox=(1, 1, 4, 5))

            summary = tn3k_mask_to_bbox.convert_dataset(
                tn3k_root=root,
                output_root=output,
                image_mode="copy",
            )

            self.assertEqual(summary["total"]["converted"], 2)
            self.assertEqual(summary["total"]["skipped"], 0)

            yolo_label = (output / "yolo" / "labels" / "trainval" / "0001.txt").read_text(encoding="utf-8")
            self.assertEqual(yolo_label, "0 0.400000 0.550000 0.400000 0.500000\n")
            self.assertTrue((output / "yolo" / "images" / "trainval" / "0001.jpg").is_file())

            coco = json.loads((output / "coco" / "trainval.json").read_text(encoding="utf-8"))
            self.assertEqual(coco["annotations"][0]["bbox"], [2, 3, 4, 5])
            self.assertEqual(coco["images"][0]["classification_label"], 1)

            manifest_line = (output / "annotations" / "manifest.jsonl").read_text(encoding="utf-8").splitlines()[0]
            manifest = json.loads(manifest_line)
            self.assertEqual(manifest["bbox_xyxy"], [2, 3, 6, 8])
            self.assertEqual(manifest["classification_label"], 1)

    def test_skips_empty_masks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tn3k"
            output = Path(tmp) / "out"
            create_sample(root, "trainval", "0001.jpg", label=1, bbox=None)
            create_sample(root, "test", "0002.jpg", label=0, bbox=(1, 1, 4, 5))

            summary = tn3k_mask_to_bbox.convert_dataset(
                tn3k_root=root,
                output_root=output,
                image_mode="none",
            )

            self.assertEqual(summary["splits"]["trainval"]["converted"], 0)
            self.assertEqual(summary["splits"]["trainval"]["skipped_empty_masks"], 1)
            self.assertEqual(summary["total"]["converted"], 1)
            self.assertEqual(summary["total"]["skipped"], 1)


def create_sample(root: Path, split: str, filename: str, *, label: int, bbox: tuple[int, int, int, int] | None) -> None:
    image_dir = root / f"{split}-image"
    mask_dir = root / f"{split}-mask"
    image_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (10, 10), (20, 20, 20)).save(image_dir / filename)
    mask = Image.new("L", (10, 10), 0)
    if bbox is not None:
        draw = ImageDraw.Draw(mask)
        left, top, right, bottom = bbox
        draw.rectangle((left, top, right - 1, bottom - 1), fill=255)
    mask.save(mask_dir / filename)
    with (root / f"label4{split}.csv").open("a", encoding="utf-8", newline="") as handle:
        handle.write(f"{filename},{label}\n")


if __name__ == "__main__":
    unittest.main()
