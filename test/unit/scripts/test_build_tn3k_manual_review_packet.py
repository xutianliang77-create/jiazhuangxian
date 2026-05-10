from __future__ import annotations

import csv
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "build_tn3k_manual_review_packet.py"
SPEC = importlib.util.spec_from_file_location("build_tn3k_manual_review_packet", SCRIPT_PATH)
assert SPEC is not None
build_tn3k_manual_review_packet = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["build_tn3k_manual_review_packet"] = build_tn3k_manual_review_packet
SPEC.loader.exec_module(build_tn3k_manual_review_packet)


class BuildTn3kManualReviewPacketTest(unittest.TestCase):
    def test_build_packet_writes_review_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset_root = root / "Dataset503"
            pred_dir = root / "pred"
            create_case(dataset_root, pred_dir, "case_a")
            queue_csv = root / "manual_review_queue.csv"
            with queue_csv.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=["case_id", "dice", "iou", "category", "primary_group", "suggested_action"],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "case_id": "case_a",
                        "dice": "0.51",
                        "iou": "0.34",
                        "category": "location_shift",
                        "primary_group": "label_or_task_review",
                        "suggested_action": "verify_image_label_alignment_and_task_definition",
                    }
                )

            summary = build_tn3k_manual_review_packet.build_packet(
                dataset_root=dataset_root,
                prediction_dir=pred_dir,
                queue_csv=queue_csv,
                output_dir=root / "packet",
                limit=1,
                offset=0,
                overwrite=False,
            )

            self.assertEqual(summary["selected_cases"], 1)
            self.assertTrue((root / "packet" / "manual_review_queue_first20.csv").is_file())
            self.assertTrue((root / "packet" / "manual_review_packet.md").is_file())
            self.assertTrue((root / "packet" / "tn3k_manual_review_contact_sheet.png").is_file())
            self.assertTrue((root / "packet" / "cases" / "case_a" / "case_a_comparison_overlay.png").is_file())


def create_case(dataset_root: Path, pred_dir: Path, case_id: str) -> None:
    (dataset_root / "imagesTs").mkdir(parents=True, exist_ok=True)
    (dataset_root / "labelsTs").mkdir(parents=True, exist_ok=True)
    pred_dir.mkdir(parents=True, exist_ok=True)
    Image.new("L", (16, 16), 80).save(dataset_root / "imagesTs" / f"{case_id}_0000.png")
    label = Image.new("L", (16, 16), 0)
    pred = Image.new("L", (16, 16), 0)
    for x in range(3, 10):
        for y in range(3, 10):
            label.putpixel((x, y), 255)
    for x in range(6, 13):
        for y in range(6, 13):
            pred.putpixel((x, y), 255)
    label.save(dataset_root / "labelsTs" / f"{case_id}.png")
    pred.save(pred_dir / f"{case_id}.png")


if __name__ == "__main__":
    unittest.main()
