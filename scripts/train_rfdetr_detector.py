from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import train_tn3k_yolo as thyroid_training  # noqa: E402


DEFAULT_MANIFEST = Path("data/artifacts/datasets/tn5000/derived/detection-clean/annotations/manifest.jsonl")
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/model-training/tn5000-rfdetr")
TARGET_METRIC = "mAP50"
TARGET_THRESHOLD = 0.90
DEFAULT_RESOLUTION_BY_SIZE = {
    "nano": 384,
    "small": 512,
    "base": 560,
    "medium": 576,
    "large": 560,
}
RFDETR_SPLITS = {"train": "train", "val": "valid"}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare and train RF-DETR on thyroid bbox annotations.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--name", default=f"tn5000-rfdetr-80-20-{time.strftime('%Y%m%d%H%M%S')}")
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--fixed-split-field", default="")
    parser.add_argument("--seed", type=int, default=20260510)
    parser.add_argument("--model-size", default="medium", choices=("nano", "small", "base", "medium", "large"))
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--grad-accum-steps", type=int, default=4)
    parser.add_argument(
        "--resolution",
        type=int,
        default=0,
        help="Input resolution. 0 uses the RF-DETR checkpoint default for the selected model size.",
    )
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--patience", type=int, default=20)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--num-workers", type=int, default=6)
    parser.add_argument("--target-threshold", type=float, default=TARGET_THRESHOLD)
    parser.add_argument("--copy-images", action="store_true", help="Copy images instead of symlinking them.")
    parser.add_argument("--prepare-only", action="store_true")
    return parser.parse_args(argv)


def prepare_dataset(
    *,
    manifest: Path,
    output_root: Path,
    name: str,
    train_ratio: float,
    fixed_split_field: str,
    seed: int,
    copy_images: bool,
) -> dict[str, Any]:
    rows = thyroid_training.load_manifest(manifest)
    splits = (
        thyroid_training.fixed_split(rows, field=fixed_split_field)
        if fixed_split_field
        else thyroid_training.stratified_split(rows, train_ratio=train_ratio, seed=seed)
    )
    dataset_root = output_root / "datasets" / name
    thyroid_training.replace_dir(dataset_root)

    class_names = thyroid_training.class_names_from_rows(rows)
    split_summaries: dict[str, Any] = {}
    for source_split, target_split in RFDETR_SPLITS.items():
        split_summaries[target_split] = materialize_coco_split(
            dataset_root=dataset_root,
            target_split=target_split,
            rows=splits[source_split],
            class_names=class_names,
            copy_images=copy_images,
        )
    mirror_valid_as_test(dataset_root)
    split_summaries["test"] = {**split_summaries["valid"], "mirrors": "valid"}

    summary = {
        "dataset_root": str(dataset_root),
        "source_manifest": str(manifest),
        "train_ratio": train_ratio,
        "fixed_split_field": fixed_split_field or None,
        "seed": seed,
        "image_mode": "copy" if copy_images else "symlink",
        "class_names": class_names,
        "total_samples": len(rows),
        "splits": split_summaries,
    }
    thyroid_training.write_json(dataset_root / "split-summary.json", summary)
    return summary


def materialize_coco_split(
    *,
    dataset_root: Path,
    target_split: str,
    rows: list[dict[str, Any]],
    class_names: list[str],
    copy_images: bool,
) -> dict[str, Any]:
    split_dir = dataset_root / target_split
    image_dir = split_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)

    images: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []
    manifest_lines: list[str] = []
    seen_stems: set[str] = set()
    annotation_id = 1
    for image_index, row in enumerate(rows, start=1):
        image_path = Path(thyroid_training.required_string(row, "image_path"))
        if not image_path.exists():
            raise FileNotFoundError(f"image file not found: {image_path}")
        target_stem = thyroid_training.training_file_stem(row, image_path)
        if target_stem in seen_stems:
            raise ValueError(f"duplicate RF-DETR sample target stem in {target_split}: {target_stem}")
        seen_stems.add(target_stem)
        image_target = image_dir / f"{target_stem}{image_path.suffix}"
        thyroid_training.link_or_copy(image_path.resolve(), image_target, copy_file=copy_images)

        width = int(row["width"])
        height = int(row["height"])
        images.append({"id": image_index, "file_name": f"images/{image_target.name}", "width": width, "height": height})

        boxes, class_ids = thyroid_training.boxes_and_class_ids(row)
        for bbox, class_id in zip(boxes, class_ids, strict=True):
            left, top, right, bottom = [float(item) for item in bbox]
            box_width = right - left
            box_height = bottom - top
            annotations.append(
                {
                    "id": annotation_id,
                    "image_id": image_index,
                    "category_id": int(class_id) + 1,
                    "bbox": [left, top, box_width, box_height],
                    "area": box_width * box_height,
                    "iscrowd": 0,
                }
            )
            annotation_id += 1

        manifest_lines.append(
            json.dumps(
                {
                    **row,
                    "rfdetr_split": target_split,
                    "rfdetr_image_path": str(image_target),
                },
                ensure_ascii=False,
            )
        )

    categories = [{"id": index + 1, "name": name, "supercategory": "thyroid"} for index, name in enumerate(class_names)]
    coco = {"images": images, "annotations": annotations, "categories": categories}
    thyroid_training.write_json(split_dir / "_annotations.coco.json", coco)
    (split_dir / "manifest.jsonl").write_text(
        "\n".join(manifest_lines) + ("\n" if manifest_lines else ""),
        encoding="utf-8",
    )
    return {"samples": len(images), "boxes": len(annotations)}


def mirror_valid_as_test(dataset_root: Path) -> None:
    valid_dir = dataset_root / "valid"
    test_dir = dataset_root / "test"
    if test_dir.exists():
        shutil.rmtree(test_dir)
    test_dir.mkdir(parents=True)
    (test_dir / "images").mkdir()
    shutil.copy2(valid_dir / "_annotations.coco.json", test_dir / "_annotations.coco.json")
    shutil.copy2(valid_dir / "manifest.jsonl", test_dir / "manifest.jsonl")
    for image_path in (valid_dir / "images").iterdir():
        if image_path.is_file() or image_path.is_symlink():
            thyroid_training.link_or_copy(image_path.resolve(), test_dir / "images" / image_path.name, copy_file=False)


def train_rfdetr(
    *,
    dataset_root: Path,
    output_root: Path,
    name: str,
    model_size: str,
    epochs: int,
    batch_size: int,
    grad_accum_steps: int,
    resolution: int,
    learning_rate: float,
    patience: int,
    device: str,
    num_workers: int,
) -> dict[str, Any]:
    model_class = import_rfdetr_model_class(model_size)
    run_dir = output_root / "runs" / name
    run_dir.mkdir(parents=True, exist_ok=True)
    effective_resolution = resolution or default_resolution(model_size)
    model = model_class(resolution=effective_resolution)
    result = model.train(
        dataset_dir=str(dataset_root),
        output_dir=str(run_dir),
        epochs=epochs,
        batch_size=batch_size,
        grad_accum_steps=grad_accum_steps,
        lr=learning_rate,
        early_stopping=True,
        early_stopping_patience=patience,
        device=device,
        num_workers=num_workers,
        tensorboard=False,
        wandb=False,
    )
    metrics = extract_rfdetr_metrics(run_dir, result)
    return {
        "run_dir": str(run_dir),
        "model_size": model_size,
        "resolution": effective_resolution,
        "best_weights": str(best_rfdetr_checkpoint(run_dir)),
        "metrics": metrics,
        "training_return": repr(result),
    }


def import_rfdetr_model_class(model_size: str) -> Any:
    try:
        import rfdetr  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("rfdetr is required in the active Python environment") from exc

    class_names = {
        "nano": "RFDETRNano",
        "small": "RFDETRSmall",
        "base": "RFDETRBase",
        "medium": "RFDETRMedium",
        "large": "RFDETRLarge",
    }
    class_name = class_names[model_size]
    model_class = getattr(rfdetr, class_name, None)
    if model_class is None:
        raise RuntimeError(f"rfdetr package does not expose {class_name}")
    return model_class


def default_resolution(model_size: str) -> int:
    try:
        return DEFAULT_RESOLUTION_BY_SIZE[model_size]
    except KeyError as exc:
        raise ValueError(f"unsupported RF-DETR model size: {model_size}") from exc


def extract_rfdetr_metrics(run_dir: Path, result: Any) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    if isinstance(result, dict):
        metrics.update(result)
    metrics.update(extract_rfdetr_csv_metrics(run_dir / "metrics.csv"))
    for json_path in sorted(run_dir.rglob("*.json")):
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(payload, dict):
            for key, value in payload.items():
                normalized = str(key).lower()
                if "map" in normalized or "ap" == normalized:
                    metrics.setdefault(str(key), value)
    return metrics


def extract_rfdetr_csv_metrics(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    val_rows = [row for row in rows if numeric_value(row.get("val/mAP_50")) is not None]
    if not val_rows:
        return {}
    latest = val_rows[-1]
    best = max(val_rows, key=lambda row: numeric_value(row.get("val/mAP_50")) or -1.0)
    return {
        "mAP50": numeric_value(best.get("val/mAP_50")),
        "mAP50_95": numeric_value(best.get("val/mAP_50_95")),
        "AP75": numeric_value(best.get("val/mAP_75")),
        "mAR": numeric_value(best.get("val/mAR")),
        "F1": numeric_value(best.get("val/F1")),
        "precision": numeric_value(best.get("val/precision")),
        "recall": numeric_value(best.get("val/recall")),
        "ema_mAP50": numeric_value(best.get("val/ema_mAP_50")),
        "ema_mAP50_95": numeric_value(best.get("val/ema_mAP_50_95")),
        "best_epoch": numeric_value(best.get("epoch")),
        "best_step": numeric_value(best.get("step")),
        "latest_mAP50": numeric_value(latest.get("val/mAP_50")),
        "latest_epoch": numeric_value(latest.get("epoch")),
        "metrics_csv": str(path),
    }


def numeric_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def best_rfdetr_checkpoint(run_dir: Path) -> Path:
    candidates = [
        run_dir / "best_checkpoint.pth",
        run_dir / "checkpoint_best_total.pth",
        run_dir / "checkpoint_best_regular.pth",
        run_dir / "checkpoint.pth",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    discovered = sorted(run_dir.rglob("*.pth"))
    return discovered[0] if discovered else run_dir / "checkpoint.pth"


def target_result(metrics: dict[str, Any], threshold: float) -> dict[str, Any]:
    value = first_numeric_metric(metrics, ("mAP50", "map50", "AP50", "bbox_mAP_50", "val/mAP_50"))
    return {
        "metric": TARGET_METRIC,
        "threshold": threshold,
        "value": value,
        "target_met": value is not None and value >= threshold,
    }


def first_numeric_metric(metrics: dict[str, Any], names: tuple[str, ...]) -> float | None:
    normalized = {str(key).lower(): value for key, value in metrics.items()}
    for name in names:
        raw = normalized.get(name.lower())
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    args.output_root.mkdir(parents=True, exist_ok=True)
    dataset = prepare_dataset(
        manifest=args.manifest,
        output_root=args.output_root,
        name=args.name,
        train_ratio=args.train_ratio,
        fixed_split_field=args.fixed_split_field,
        seed=args.seed,
        copy_images=args.copy_images,
    )
    summary: dict[str, Any] = {
        "schema_version": "thyroid.rfdetr_detector.training.v1",
        "status": "prepared" if args.prepare_only else "running",
        "name": args.name,
        "model_family": "rf-detr",
        "model_size": args.model_size,
        "output_root": str(args.output_root),
        "params": {
            "train_ratio": args.train_ratio,
            "fixed_split_field": args.fixed_split_field or None,
            "seed": args.seed,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "grad_accum_steps": args.grad_accum_steps,
            "resolution": args.resolution or default_resolution(args.model_size),
            "learning_rate": args.learning_rate,
            "patience": args.patience,
            "device": args.device,
            "num_workers": args.num_workers,
            "target_metric": TARGET_METRIC,
            "target_threshold": args.target_threshold,
        },
        "dataset": dataset,
    }
    summary_path = args.output_root / "summaries" / f"{args.name}.json"
    if args.prepare_only:
        thyroid_training.write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    summary["training"] = train_rfdetr(
        dataset_root=Path(dataset["dataset_root"]),
        output_root=args.output_root,
        name=args.name,
        model_size=args.model_size,
        epochs=args.epochs,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum_steps,
        resolution=args.resolution,
        learning_rate=args.learning_rate,
        patience=args.patience,
        device=args.device,
        num_workers=args.num_workers,
    )
    summary["target"] = target_result(summary["training"]["metrics"], args.target_threshold)
    summary["status"] = "target_met" if summary["target"]["target_met"] else "target_not_met"
    thyroid_training.write_json(summary_path, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
