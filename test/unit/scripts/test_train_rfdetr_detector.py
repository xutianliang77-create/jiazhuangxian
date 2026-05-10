from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "train_rfdetr_detector.py"
SPEC = importlib.util.spec_from_file_location("train_rfdetr_detector", SCRIPT_PATH)
assert SPEC is not None
train_rfdetr_detector = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["train_rfdetr_detector"] = train_rfdetr_detector
SPEC.loader.exec_module(train_rfdetr_detector)


class TrainRfDetrDetectorTest(unittest.TestCase):
    def test_prepare_dataset_writes_rfdetr_coco_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = create_manifest(root)

            summary = train_rfdetr_detector.prepare_dataset(
                manifest=manifest,
                output_root=root / "out",
                name="unit-rfdetr",
                train_ratio=0.8,
                fixed_split_field="fixed_training_split",
                seed=123,
                copy_images=True,
            )

            dataset_root = Path(summary["dataset_root"])
            self.assertTrue((dataset_root / "train" / "_annotations.coco.json").is_file())
            self.assertTrue((dataset_root / "valid" / "_annotations.coco.json").is_file())
            self.assertTrue((dataset_root / "test" / "_annotations.coco.json").is_file())
            train_coco = json.loads((dataset_root / "train" / "_annotations.coco.json").read_text(encoding="utf-8"))
            valid_coco = json.loads((dataset_root / "valid" / "_annotations.coco.json").read_text(encoding="utf-8"))
            self.assertEqual(train_coco["categories"], [{"id": 1, "name": "thyroid_nodule", "supercategory": "thyroid"}])
            self.assertEqual(len(train_coco["images"]), 1)
            self.assertEqual(len(train_coco["annotations"]), 2)
            self.assertEqual(len(valid_coco["images"]), 1)
            self.assertEqual(len(valid_coco["annotations"]), 1)
            self.assertEqual(summary["splits"]["test"]["mirrors"], "valid")

    def test_target_result_reads_map50_aliases(self) -> None:
        passed = train_rfdetr_detector.target_result({"AP50": "0.91"}, 0.90)
        failed = train_rfdetr_detector.target_result({"mAP50": "0.89"}, 0.90)

        self.assertTrue(passed["target_met"])
        self.assertFalse(failed["target_met"])

    def test_default_resolution_matches_model_size(self) -> None:
        self.assertEqual(train_rfdetr_detector.default_resolution("medium"), 576)
        self.assertEqual(train_rfdetr_detector.default_resolution("base"), 560)

    def test_extract_rfdetr_csv_metrics_uses_best_map50_row(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "metrics.csv"
            path.write_text(
                "\n".join(
                    [
                        "epoch,step,val/mAP_50,val/mAP_50_95,val/precision,val/recall,val/F1",
                        "0,10,0.91,0.55,0.88,0.86,0.87",
                        "1,20,0.94,0.58,0.92,0.89,0.90",
                        "2,30,0.93,0.57,0.91,0.88,0.89",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            metrics = train_rfdetr_detector.extract_rfdetr_csv_metrics(path)

            self.assertEqual(metrics["mAP50"], 0.94)
            self.assertEqual(metrics["best_epoch"], 1.0)
            self.assertEqual(metrics["latest_mAP50"], 0.93)


def create_manifest(root: Path) -> Path:
    image_dir = root / "images"
    image_dir.mkdir()
    rows = []
    for split, name, boxes in [
        ("train", "multi.jpg", [[2, 2, 10, 12], [10, 10, 15, 16]]),
        ("val", "single.jpg", [[1, 1, 4, 4]]),
    ]:
        image_path = image_dir / name
        Image.new("RGB", (20, 20), (20, 20, 20)).save(image_path)
        rows.append(
            {
                "dataset_id": "tn5000_detection_clean",
                "split": "tn5000_cleaned",
                "image_id": image_path.stem,
                "image_file": name,
                "image_path": str(image_path),
                "width": 20,
                "height": 20,
                "classification_label": 1,
                "bbox_xyxy": boxes[0],
                "bboxes_xyxy": boxes,
                "yolo_class_ids": [0 for _ in boxes],
                "yolo_class_names": ["thyroid_nodule"],
                "fixed_training_split": split,
            }
        )
    manifest = root / "manifest.jsonl"
    manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    unittest.main()
