from __future__ import annotations

import csv
import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "lock_final_validation_dataset.py"
SPEC = importlib.util.spec_from_file_location("lock_final_validation_dataset", SCRIPT_PATH)
assert SPEC is not None
lock_final_validation_dataset = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["lock_final_validation_dataset"] = lock_final_validation_dataset
SPEC.loader.exec_module(lock_final_validation_dataset)


class LockFinalValidationDatasetTest(unittest.TestCase):
    def test_build_lock_verifies_manifest_and_writes_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = root / "raw"
            raw.mkdir()
            image = raw / "Thyroid" / "PTC" / "case.png"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"fake-image")
            manifest = root / "file_manifest.csv"
            write_manifest(manifest, image, raw)

            output = root / "final_validation_lock.json"
            lock = lock_final_validation_dataset.build_lock(
                dataset_id="demo",
                raw_root=raw,
                file_manifest=manifest,
                output_json=output,
                expected_count=1,
                purpose="final_external_validation_only",
                source_url="https://example.test/source",
                download_url_used="https://example.test/download",
                snapshot_sha="abc123",
            )

            self.assertTrue(output.is_file())
            self.assertEqual(lock["counts"]["files"], 1)
            self.assertEqual(lock["counts"]["class_counts"], {"PTC": 1})
            self.assertFalse(lock["policy"]["train"])
            self.assertTrue(lock["policy"]["final_validation"])

    def test_build_lock_fails_on_hash_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = root / "raw"
            raw.mkdir()
            image = raw / "case.png"
            image.write_bytes(b"changed")
            manifest = root / "file_manifest.csv"
            with manifest.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=["relative_path", "class", "extension", "bytes", "sha256"])
                writer.writeheader()
                writer.writerow(
                    {
                        "relative_path": "case.png",
                        "class": "PTC",
                        "extension": ".png",
                        "bytes": image.stat().st_size,
                        "sha256": "0" * 64,
                    }
                )

            with self.assertRaises(SystemExit):
                lock_final_validation_dataset.build_lock(
                    dataset_id="demo",
                    raw_root=raw,
                    file_manifest=manifest,
                    output_json=root / "lock.json",
                    expected_count=1,
                    purpose="final_external_validation_only",
                    source_url=None,
                    download_url_used=None,
                    snapshot_sha=None,
                )


def write_manifest(manifest: Path, image: Path, raw: Path) -> None:
    digest = hashlib.sha256(image.read_bytes()).hexdigest()
    with manifest.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["relative_path", "class", "extension", "bytes", "sha256"])
        writer.writeheader()
        writer.writerow(
            {
                "relative_path": image.relative_to(raw).as_posix(),
                "class": "PTC",
                "extension": ".png",
                "bytes": image.stat().st_size,
                "sha256": digest,
            }
        )


if __name__ == "__main__":
    unittest.main()
