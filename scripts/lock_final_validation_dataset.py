#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a reproducible lock file for a final validation dataset.")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--raw-root", required=True)
    parser.add_argument("--file-manifest", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--purpose", default="final_external_validation_only")
    parser.add_argument("--source-url")
    parser.add_argument("--download-url-used")
    parser.add_argument("--snapshot-sha")
    args = parser.parse_args()

    lock = build_lock(
        dataset_id=args.dataset_id,
        raw_root=Path(args.raw_root),
        file_manifest=Path(args.file_manifest),
        output_json=Path(args.output_json),
        expected_count=args.expected_count,
        purpose=args.purpose,
        source_url=args.source_url,
        download_url_used=args.download_url_used,
        snapshot_sha=args.snapshot_sha,
    )
    print(json.dumps(lock, ensure_ascii=False, indent=2))
    return 0


def build_lock(
    *,
    dataset_id: str,
    raw_root: Path,
    file_manifest: Path,
    output_json: Path,
    expected_count: int | None,
    purpose: str,
    source_url: str | None,
    download_url_used: str | None,
    snapshot_sha: str | None,
) -> dict[str, Any]:
    if not raw_root.is_dir():
        raise SystemExit(f"raw root not found: {raw_root}")
    if not file_manifest.is_file():
        raise SystemExit(f"file manifest not found: {file_manifest}")

    rows = read_manifest(file_manifest)
    if expected_count is not None and len(rows) != expected_count:
        raise SystemExit(f"expected {expected_count} files, found {len(rows)} in {file_manifest}")

    class_counts: Counter[str] = Counter()
    extension_counts: Counter[str] = Counter()
    total_bytes = 0
    for row in rows:
        rel = row["relative_path"]
        path = raw_root / rel
        if not path.is_file():
            raise SystemExit(f"listed file not found: {path}")
        actual_size = path.stat().st_size
        expected_size = int(row["bytes"])
        if actual_size != expected_size:
            raise SystemExit(f"size mismatch for {rel}: expected {expected_size}, found {actual_size}")
        actual_sha = sha256_file(path)
        if actual_sha != row["sha256"]:
            raise SystemExit(f"sha256 mismatch for {rel}: expected {row['sha256']}, found {actual_sha}")
        class_counts[row["class"]] += 1
        extension_counts[row["extension"]] += 1
        total_bytes += actual_size

    lock = {
        "schema_version": "final_validation_dataset_lock.v1",
        "dataset_id": dataset_id,
        "locked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "purpose": purpose,
        "source_url": source_url,
        "download_url_used": download_url_used,
        "snapshot_sha": snapshot_sha,
        "raw_root": str(raw_root),
        "file_manifest": str(file_manifest),
        "manifest_sha256": sha256_file(file_manifest),
        "counts": {
            "files": len(rows),
            "total_bytes": total_bytes,
            "class_counts": dict(sorted(class_counts.items())),
            "extension_counts": dict(sorted(extension_counts.items())),
        },
        "policy": {
            "train": False,
            "tune": False,
            "model_selection": False,
            "final_validation": True,
            "allowed_task": "three_class_thyroid_carcinoma_subtype_classification",
            "disallowed_tasks": ["nodule_detection", "segmentation", "tirads_scoring", "benign_malignant_training"],
        },
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return lock


def read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    required = {"relative_path", "class", "extension", "bytes", "sha256"}
    missing = required.difference(rows[0].keys() if rows else set())
    if missing:
        raise SystemExit(f"manifest missing columns: {', '.join(sorted(missing))}")
    return rows


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
