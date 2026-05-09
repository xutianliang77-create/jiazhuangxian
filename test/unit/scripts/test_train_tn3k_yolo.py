from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "train_tn3k_yolo.py"
SPEC = importlib.util.spec_from_file_location("train_tn3k_yolo", SCRIPT_PATH)
assert SPEC is not None
train_tn3k_yolo = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["train_tn3k_yolo"] = train_tn3k_yolo
SPEC.loader.exec_module(train_tn3k_yolo)


class TrainTn3kYoloTest(unittest.TestCase):
    def test_prepare_dataset_uses_stratified_80_20_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = create_manifest(root, benign=10, malignant=5)

            summary = train_tn3k_yolo.prepare_dataset(
                manifest=manifest,
                output_root=root / "out",
                name="unit",
                train_ratio=0.8,
                seed=123,
                copy_images=True,
            )

            self.assertEqual(summary["total_samples"], 15)
            self.assertEqual(summary["splits"]["train"]["samples"], 12)
            self.assertEqual(summary["splits"]["val"]["samples"], 3)
            self.assertEqual(summary["splits"]["train"]["classification_labels"], {"0": 8, "1": 4})
            self.assertEqual(summary["splits"]["val"]["classification_labels"], {"0": 2, "1": 1})
            dataset_root = Path(summary["dataset_root"])
            self.assertTrue((dataset_root / "data.yaml").is_file())
            self.assertEqual(len(list((dataset_root / "images" / "train").glob("*.jpg"))), 12)
            self.assertEqual(len(list((dataset_root / "labels" / "val").glob("*.txt"))), 3)

    def test_target_result_marks_metric_threshold(self) -> None:
        passed = train_tn3k_yolo.target_result({"metrics/mAP50(B)": "0.931"}, metric_name="metrics/mAP50(B)", threshold=0.93)
        failed = train_tn3k_yolo.target_result({"metrics/mAP50(B)": "0.929"}, metric_name="metrics/mAP50(B)", threshold=0.93)

        self.assertTrue(passed["target_met"])
        self.assertFalse(failed["target_met"])


def create_manifest(root: Path, *, benign: int, malignant: int) -> Path:
    image_dir = root / "images"
    image_dir.mkdir()
    rows = []
    for label, count in [(0, benign), (1, malignant)]:
        for index in range(count):
            name = f"{label}_{index:03d}.jpg"
            image_path = image_dir / name
            Image.new("RGB", (20, 20), (20, 20, 20)).save(image_path)
            rows.append(
                {
                    "dataset_id": "tn3k",
                    "split": "synthetic",
                    "image_id": image_path.stem,
                    "image_file": name,
                    "image_path": str(image_path),
                    "mask_path": str(image_path),
                    "width": 20,
                    "height": 20,
                    "bbox_xyxy": [2, 3, 10, 13],
                    "bbox_xywh": [2, 3, 8, 10],
                    "foreground_pixels": 80,
                    "classification_label": label,
                }
            )
    manifest = root / "manifest.jsonl"
    manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    unittest.main()
