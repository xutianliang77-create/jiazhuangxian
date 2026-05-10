from __future__ import annotations

import csv
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "curate_tn3k_low_dice_dataset.py"
SPEC = importlib.util.spec_from_file_location("curate_tn3k_low_dice_dataset", SCRIPT_PATH)
assert SPEC is not None
curate_tn3k_low_dice_dataset = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["curate_tn3k_low_dice_dataset"] = curate_tn3k_low_dice_dataset
SPEC.loader.exec_module(curate_tn3k_low_dice_dataset)


class CurateTn3kLowDiceDatasetTest(unittest.TestCase):
    def test_curate_dataset_groups_holdout_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset_root = root / "Dataset503"
            pred_dir = root / "pred"
            create_case(dataset_root, pred_dir, "case_clean")
            create_case(dataset_root, pred_dir, "case_label")
            create_case(dataset_root, pred_dir, "case_model")
            create_case(dataset_root, pred_dir, "case_borderline")

            audit_csv = root / "audit.csv"
            with audit_csv.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=["case_id", "dice", "iou", "category"])
                writer.writeheader()
                writer.writerow({"case_id": "case_label", "dice": "0.70", "iou": "0.54", "category": "multi_region_gt_partial"})
                writer.writerow({"case_id": "case_model", "dice": "0.76", "iou": "0.62", "category": "oversegmentation"})
                writer.writerow({"case_id": "case_borderline", "dice": "0.86", "iou": "0.75", "category": "moderate_boundary_error"})

            summary = curate_tn3k_low_dice_dataset.curate_dataset(
                dataset_root=dataset_root,
                prediction_dir=pred_dir,
                audit_csv=audit_csv,
                summary_json=None,
                output_dir=root / "curated",
                manual_review_dice=0.80,
                use_symlinks=True,
                overwrite=False,
            )

            self.assertEqual(summary["total_cases"], 4)
            self.assertEqual(summary["group_counts"]["clean_high_confidence"], 1)
            self.assertEqual(summary["group_counts"]["label_or_task_review"], 1)
            self.assertEqual(summary["group_counts"]["model_hard"], 1)
            self.assertEqual(summary["group_counts"]["borderline_boundary"], 1)
            self.assertEqual(summary["subset_counts"]["manual_review_required"], 2)
            self.assertEqual(summary["subset_counts"]["clean_label_candidate"], 3)

            curated = root / "curated"
            self.assertTrue((curated / "curation_manifest.csv").is_file())
            review_queue = curated / "manual_review_queue.csv"
            self.assertTrue(review_queue.is_file())
            with review_queue.open(newline="", encoding="utf-8") as handle:
                review_rows = list(csv.DictReader(handle))
            self.assertEqual([row["case_id"] for row in review_rows], ["case_label", "case_model"])
            self.assertEqual(review_rows[0]["suggested_action"], "verify_image_label_alignment_and_task_definition")
            self.assertTrue((curated / "subsets" / "manual_review_required" / "imagesTs" / "case_label_0000.png").is_symlink())
            self.assertTrue((curated / "subsets" / "model_hard_cases" / "labelsTs" / "case_model.png").is_symlink())


def create_case(dataset_root: Path, pred_dir: Path, case_id: str) -> None:
    (dataset_root / "imagesTs").mkdir(parents=True, exist_ok=True)
    (dataset_root / "labelsTs").mkdir(parents=True, exist_ok=True)
    pred_dir.mkdir(parents=True, exist_ok=True)
    Image.new("L", (8, 8), 30).save(dataset_root / "imagesTs" / f"{case_id}_0000.png")
    Image.new("L", (8, 8), 1).save(dataset_root / "labelsTs" / f"{case_id}.png")
    Image.new("L", (8, 8), 1).save(pred_dir / f"{case_id}.png")


if __name__ == "__main__":
    unittest.main()
