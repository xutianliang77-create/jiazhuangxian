from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - real CLI environment only.
    raise SystemExit("Pillow is required. Install it with: pip install Pillow") from exc


DEFAULT_TN3K_MANIFEST = Path("data/artifacts/datasets/tn3k/derived/detection/annotations/manifest.jsonl")
DEFAULT_TN5000_CROPPED_ROOT = Path(
    "data/artifacts/datasets/hf-thyroid/tn5000_cropped_classification/raw"
)
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/datasets/thyroid-detection-combined/derived")


@dataclass(frozen=True)
class BuildOptions:
    tn3k_manifest: Path
    tn5000_cropped_root: Path
    output_root: Path
    mode: str
    train_ratio: float
    seed: int
    extra_train_manifests: list[Path]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a combined thyroid detection manifest.")
    parser.add_argument("--tn3k-manifest", type=Path, default=DEFAULT_TN3K_MANIFEST)
    parser.add_argument("--tn5000-cropped-root", type=Path, default=DEFAULT_TN5000_CROPPED_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--extra-train-manifest", action="append", type=Path, default=[])
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=20260509)
    parser.add_argument(
        "--mode",
        default="strict",
        choices=("strict", "with-cropped-classification"),
        help=(
            "strict keeps only true detector labels. with-cropped-classification adds cropped classification images "
            "as full-image pseudo bbox samples and marks them as non-production auxiliary labels."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    options = BuildOptions(
        tn3k_manifest=args.tn3k_manifest,
        tn5000_cropped_root=args.tn5000_cropped_root,
        output_root=args.output_root,
        mode=args.mode,
        train_ratio=args.train_ratio,
        seed=args.seed,
        extra_train_manifests=args.extra_train_manifest,
    )
    summary = build_manifest(options)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def build_manifest(options: BuildOptions) -> dict[str, Any]:
    options.output_root.mkdir(parents=True, exist_ok=True)
    rows = load_jsonl(options.tn3k_manifest)
    normalized = assign_tn3k_fixed_splits(
        [normalize_tn3k_row(row) for row in rows],
        train_ratio=options.train_ratio,
        seed=options.seed,
    )
    if options.mode == "with-cropped-classification":
        normalized.extend(tn5000_cropped_rows(options.tn5000_cropped_root))
    for extra_manifest in getattr(options, "extra_train_manifests", []):
        normalized.extend(load_extra_train_rows(extra_manifest))

    manifest_path = options.output_root / f"{options.mode}.manifest.jsonl"
    write_jsonl(manifest_path, normalized)
    summary = summarize(options, manifest_path, normalized)
    write_json(options.output_root / f"{options.mode}.summary.json", summary)
    return summary


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"manifest not found: {path}")
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        raise ValueError(f"manifest is empty: {path}")
    return rows


def load_extra_train_rows(path: Path) -> list[dict[str, Any]]:
    rows = load_jsonl(path)
    return [{**row, "fixed_training_split": "train"} for row in rows]


def normalize_tn3k_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **row,
        "dataset_id": row.get("dataset_id", "tn3k"),
        "bbox_source": row.get("bbox_source", "true_mask_derived_bbox"),
        "sample_quality": row.get("sample_quality", "strict_detector"),
    }


def tn5000_cropped_rows(root: Path) -> list[dict[str, Any]]:
    if not root.exists():
        raise FileNotFoundError(f"TN5000 cropped root not found: {root}")
    rows: list[dict[str, Any]] = []
    for image_path in sorted(root.rglob("*")):
        if not image_path.is_file() or image_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
            continue
        rel = image_path.relative_to(root)
        if len(rel.parts) < 3:
            continue
        source_split, class_name = rel.parts[0], rel.parts[1]
        if class_name.lower() not in {"benign", "malignant"}:
            continue
        with Image.open(image_path) as image:
            width, height = image.size
        rows.append(
            {
                "dataset_id": "tn5000_cropped_classification",
                "split": f"tn5000_{source_split.lower()}_{class_name.lower()}",
                "image_id": "__".join(rel.with_suffix("").parts),
                "image_file": image_path.name,
                "image_path": str(image_path),
                "width": width,
                "height": height,
                "bbox_xyxy": [0, 0, width, height],
                "bbox_xywh": [0, 0, width, height],
                "foreground_pixels": width * height,
                "classification_label": 0 if class_name.lower() == "benign" else 1,
                "bbox_source": "full_image_pseudo_bbox_from_cropped_classification",
                "sample_quality": "auxiliary_cropped_not_strict_detector",
                "fixed_training_split": "train",
            }
        )
    return rows


def assign_tn3k_fixed_splits(rows: list[dict[str, Any]], *, train_ratio: float, seed: int) -> list[dict[str, Any]]:
    if not 0 < train_ratio < 1:
        raise ValueError("train-ratio must be between 0 and 1")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("classification_label", "unknown")), []).append(row)
    rng = random.Random(seed)
    output: list[dict[str, Any]] = []
    for _, items in sorted(grouped.items()):
        shuffled = list(items)
        rng.shuffle(shuffled)
        train_count = round(len(shuffled) * train_ratio)
        for row in shuffled[:train_count]:
            output.append({**row, "fixed_training_split": "train"})
        for row in shuffled[train_count:]:
            output.append({**row, "fixed_training_split": "val"})
    output.sort(key=lambda row: (str(row.get("fixed_training_split")), str(row.get("dataset_id")), str(row.get("split")), str(row.get("image_id"))))
    return output


def summarize(options: BuildOptions, manifest_path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    dataset_counts = Counter(str(row.get("dataset_id", "unknown")) for row in rows)
    quality_counts = Counter(str(row.get("sample_quality", "unknown")) for row in rows)
    bbox_source_counts = Counter(str(row.get("bbox_source", "unknown")) for row in rows)
    label_counts = Counter(str(row.get("classification_label", "unknown")) for row in rows)
    return {
        "schema_version": "thyroid.detection_combined_manifest.summary.v1",
        "mode": options.mode,
        "manifest_jsonl": str(manifest_path),
        "source_manifests": {
            "tn3k": str(options.tn3k_manifest),
            "tn5000_cropped_root": str(options.tn5000_cropped_root),
            "extra_train_manifests": [str(path) for path in options.extra_train_manifests],
        },
        "train_ratio": options.train_ratio,
        "seed": options.seed,
        "total_samples": len(rows),
        "dataset_counts": dict(sorted(dataset_counts.items())),
        "fixed_training_split_counts": dict(sorted(Counter(str(row.get("fixed_training_split", "unknown")) for row in rows).items())),
        "sample_quality_counts": dict(sorted(quality_counts.items())),
        "bbox_source_counts": dict(sorted(bbox_source_counts.items())),
        "classification_label_counts": dict(sorted(label_counts.items())),
        "warnings": warnings_for(options.mode),
    }


def warnings_for(mode: str) -> list[str]:
    if mode == "with-cropped-classification":
        return [
            "TN5000 cropped classification images are added with full-image pseudo bboxes.",
            "Do not use mixed validation mAP as strict clinical detector evidence.",
            "Prefer validating detector quality on true bbox/mask datasets such as TN3K, TN5000 detection, or ThyroidXL after access approval.",
        ]
    return []


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
