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
                fixed_split_field="",
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

    def test_prepare_dataset_preserves_same_file_names_from_different_source_splits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = create_duplicate_name_manifest(root)

            summary = train_tn3k_yolo.prepare_dataset(
                manifest=manifest,
                output_root=root / "out",
                name="unit-duplicates",
                train_ratio=0.5,
                fixed_split_field="",
                seed=123,
                copy_images=True,
            )

            dataset_root = Path(summary["dataset_root"])
            train_images = [path.name for path in (dataset_root / "images" / "train").glob("*.jpg")]
            val_images = [path.name for path in (dataset_root / "images" / "val").glob("*.jpg")]
            self.assertEqual(set(train_images + val_images), {"test_0000.jpg", "trainval_0000.jpg"})
            label_paths = {
                path.name
                for label_split in ["train", "val"]
                for path in (dataset_root / "labels" / label_split).glob("*.txt")
            }
            self.assertEqual(label_paths, {"test_0000.txt", "trainval_0000.txt"})

    def test_prepare_dataset_can_use_fixed_split_field(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = create_manifest(root, benign=3, malignant=1)
            rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()]
            for index, row in enumerate(rows):
                row["fixed_training_split"] = "val" if index == 0 else "train"
            manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")

            summary = train_tn3k_yolo.prepare_dataset(
                manifest=manifest,
                output_root=root / "out",
                name="unit-fixed",
                train_ratio=0.8,
                fixed_split_field="fixed_training_split",
                seed=123,
                copy_images=True,
            )

            self.assertEqual(summary["splits"]["train"]["samples"], 3)
            self.assertEqual(summary["splits"]["val"]["samples"], 1)
            self.assertEqual(summary["fixed_split_field"], "fixed_training_split")

    def test_prepare_dataset_writes_multiple_boxes_per_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = create_multi_box_manifest(root)

            summary = train_tn3k_yolo.prepare_dataset(
                manifest=manifest,
                output_root=root / "out",
                name="unit-multibox",
                train_ratio=0.8,
                fixed_split_field="fixed_training_split",
                seed=123,
                copy_images=True,
            )

            dataset_root = Path(summary["dataset_root"])
            labels = sorted((dataset_root / "labels" / "train").glob("*.txt"))
            self.assertEqual(len(labels), 1)
            self.assertEqual(
                labels[0].read_text(encoding="utf-8"),
                "0 0.300000 0.350000 0.400000 0.500000\n"
                "0 0.625000 0.650000 0.250000 0.300000\n",
            )
            self.assertEqual(summary["class_names"], ["thyroid_nodule"])
            self.assertEqual(summary["splits"]["train"]["boxes"], 2)


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


def create_duplicate_name_manifest(root: Path) -> Path:
    rows = []
    for split in ["trainval", "test"]:
        image_dir = root / split
        image_dir.mkdir()
        image_path = image_dir / "0000.jpg"
        Image.new("RGB", (20, 20), (20, 20, 20)).save(image_path)
        rows.append(
            {
                "dataset_id": "tn3k",
                "split": split,
                "image_id": image_path.stem,
                "image_file": image_path.name,
                "image_path": str(image_path),
                "mask_path": str(image_path),
                "width": 20,
                "height": 20,
                "bbox_xyxy": [2, 3, 10, 13],
                "bbox_xywh": [2, 3, 8, 10],
                "foreground_pixels": 80,
                "classification_label": 0,
            }
        )
    manifest = root / "duplicate-name-manifest.jsonl"
    manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return manifest


def create_multi_box_manifest(root: Path) -> Path:
    image_dir = root / "images"
    image_dir.mkdir()
    rows = []
    for split, name in [("train", "multi.jpg"), ("val", "single.jpg")]:
        image_path = image_dir / name
        Image.new("RGB", (20, 20), (20, 20, 20)).save(image_path)
        if split == "train":
            row = {
                "dataset_id": "tn5000_detection_clean",
                "split": "tn5000_cleaned",
                "image_id": image_path.stem,
                "image_file": name,
                "image_path": str(image_path),
                "width": 20,
                "height": 20,
                "classification_label": 1,
                "bbox_xyxy": [2, 2, 10, 12],
                "bboxes_xyxy": [[2, 2, 10, 12], [10, 10, 15, 16]],
                "yolo_class_ids": [0, 0],
                "yolo_class_names": ["thyroid_nodule"],
                "fixed_training_split": "train",
            }
        else:
            row = {
                "dataset_id": "tn5000_detection_clean",
                "split": "tn5000_cleaned",
                "image_id": image_path.stem,
                "image_file": name,
                "image_path": str(image_path),
                "width": 20,
                "height": 20,
                "classification_label": 0,
                "bbox_xyxy": [1, 1, 4, 4],
                "fixed_training_split": "val",
            }
        rows.append(row)
    manifest = root / "multi-box-manifest.jsonl"
    manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    unittest.main()
