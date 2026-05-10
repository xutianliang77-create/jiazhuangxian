from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "prepare_tn3k_roi_nnunet.py"
SPEC = importlib.util.spec_from_file_location("prepare_tn3k_roi_nnunet", SCRIPT_PATH)
assert SPEC is not None
prepare_tn3k_roi_nnunet = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["prepare_tn3k_roi_nnunet"] = prepare_tn3k_roi_nnunet
SPEC.loader.exec_module(prepare_tn3k_roi_nnunet)


class PrepareTn3kRoiNnunetTest(unittest.TestCase):
    def test_prepare_roi_dataset_writes_fixed_size_crops(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_root = root / "tn3k"
            create_tn3k_pair(data_root, "sample_000", bbox=(10, 8, 20, 18))
            for index in range(1, 10):
                create_tn3k_pair(data_root, f"sample_{index:03d}", bbox=(4, 5, 16, 22))

            summary = prepare_tn3k_roi_nnunet.prepare_roi_dataset(
                data_root=data_root,
                nnunet_raw=root / "nnUNet_raw",
                dataset_id=902,
                dataset_name="UnitROI",
                seed=123,
                val_ratio=0.2,
                output_size=32,
                margin_ratio=0.25,
                min_crop_size=20,
                overwrite=False,
            )

            dataset_dir = Path(summary["dataset_dir"])
            self.assertEqual(summary["total_roi_samples"], 10)
            self.assertEqual(summary["train_samples"], 8)
            self.assertEqual(summary["validation_samples"], 2)
            self.assertTrue((dataset_dir / "dataset.json").is_file())
            self.assertEqual(len(list((dataset_dir / "imagesTr").glob("*.png"))), 8)
            self.assertEqual(len(list((dataset_dir / "labelsTr").glob("*.png"))), 8)

            with Image.open(next((dataset_dir / "imagesTr").glob("*.png"))) as image:
                self.assertEqual(image.size, (32, 32))
            with Image.open(next((dataset_dir / "labelsTr").glob("*.png"))) as mask:
                self.assertEqual(mask.size, (32, 32))
                self.assertLessEqual(set(mask.tobytes()), {0, 1})

    def test_prepare_roi_dataset_skips_empty_masks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_root = root / "tn3k"
            for index in range(10):
                create_tn3k_pair(data_root, f"sample_{index:03d}", bbox=(5, 5, 15, 16))
            create_tn3k_pair(data_root, "empty", bbox=None)

            summary = prepare_tn3k_roi_nnunet.prepare_roi_dataset(
                data_root=data_root,
                nnunet_raw=root / "nnUNet_raw",
                dataset_id=903,
                dataset_name="UnitROISkip",
                seed=123,
                val_ratio=0.2,
                output_size=32,
                margin_ratio=0.25,
                min_crop_size=20,
                overwrite=False,
            )

            self.assertEqual(summary["total_paired_samples"], 11)
            self.assertEqual(summary["total_roi_samples"], 10)
            self.assertEqual(summary["skipped_empty_masks"], 1)

    def test_expanded_crop_box_stays_inside_image(self) -> None:
        crop = prepare_tn3k_roi_nnunet.expanded_crop_box(
            (0, 0, 5, 6),
            (24, 20),
            margin_ratio=1.0,
            min_crop_size=16,
        )

        left, top, right, bottom = crop
        self.assertGreaterEqual(left, 0)
        self.assertGreaterEqual(top, 0)
        self.assertLessEqual(right, 24)
        self.assertLessEqual(bottom, 20)
        self.assertGreater(right - left, 0)
        self.assertGreater(bottom - top, 0)


def create_tn3k_pair(data_root: Path, stem: str, *, bbox: tuple[int, int, int, int] | None) -> None:
    image_dir = data_root / "trainval-image"
    mask_dir = data_root / "trainval-mask"
    image_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    Image.new("L", (40, 30), 30).save(image_dir / f"{stem}.png")
    mask = Image.new("L", (40, 30), 0)
    if bbox is not None:
        pixels = mask.load()
        left, top, right, bottom = bbox
        for y in range(top, bottom):
            for x in range(left, right):
                pixels[x, y] = 255
    mask.save(mask_dir / f"{stem}.png")


if __name__ == "__main__":
    unittest.main()
