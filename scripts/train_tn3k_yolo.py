from __future__ import annotations

import argparse
import csv
import json
import os
import random
import shutil
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_MANIFEST = Path("data/artifacts/datasets/tn3k/derived/detection/annotations/manifest.jsonl")
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/model-training/tn3k-yolo")
DEFAULT_MODEL = "data/artifacts/model-weights/yolo/yolo11m.pt"
TARGET_METRIC = "metrics/mAP50(B)"
TARGET_THRESHOLD = 0.93
TRAIN_RATIO = 0.8
MODEL_FAMILIES = ("yolo", "rtdetr")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare and train an Ultralytics detector on thyroid bbox annotations.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--model", default=os.environ.get("JZX_YOLOV11_BASE_WEIGHTS", DEFAULT_MODEL))
    parser.add_argument("--model-family", choices=MODEL_FAMILIES, default="yolo")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--name", default=f"tn3k-yolo11-80-20-{time.strftime('%Y%m%d%H%M%S')}")
    parser.add_argument("--train-ratio", type=float, default=TRAIN_RATIO)
    parser.add_argument("--fixed-split-field", default="")
    parser.add_argument("--seed", type=int, default=20260509)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--imgsz", type=int, default=768)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default=os.environ.get("JZX_MODEL_DEVICE", "0"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--cache", default="disk", choices=("false", "ram", "disk"))
    parser.add_argument("--optimizer", default="auto")
    parser.add_argument("--lr0", type=float, default=0.01)
    parser.add_argument("--lrf", type=float, default=0.01)
    parser.add_argument("--warmup-epochs", type=float, default=3.0)
    parser.add_argument("--target-metric", default=TARGET_METRIC)
    parser.add_argument("--target-threshold", type=float, default=TARGET_THRESHOLD)
    parser.add_argument("--close-mosaic", type=int, default=15)
    parser.add_argument("--multi-scale", action="store_true")
    parser.add_argument("--mosaic", type=float, default=1.0)
    parser.add_argument("--scale", type=float, default=0.5)
    parser.add_argument("--translate", type=float, default=0.1)
    parser.add_argument("--hsv-h", type=float, default=0.015)
    parser.add_argument("--hsv-s", type=float, default=0.7)
    parser.add_argument("--hsv-v", type=float, default=0.4)
    parser.add_argument("--erasing", type=float, default=0.4)
    parser.add_argument("--auto-augment", default="randaugment")
    parser.add_argument("--copy-images", action="store_true", help="Copy images instead of symlinking them.")
    parser.add_argument("--prepare-only", action="store_true")
    return parser.parse_args(argv)


def load_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"TN3K detection manifest not found: {path}")
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        raise ValueError(f"TN3K detection manifest is empty: {path}")
    return rows


def stratified_split(rows: list[dict[str, Any]], *, train_ratio: float, seed: int) -> dict[str, list[dict[str, Any]]]:
    if not 0 < train_ratio < 1:
        raise ValueError("train-ratio must be between 0 and 1")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        label = str(row.get("classification_label", "unknown"))
        grouped.setdefault(label, []).append(row)

    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    rng = random.Random(seed)
    for label, items in sorted(grouped.items()):
        shuffled = list(items)
        rng.shuffle(shuffled)
        train_count = round(len(shuffled) * train_ratio)
        train.extend(shuffled[:train_count])
        val.extend(shuffled[train_count:])

    train.sort(key=sample_key)
    val.sort(key=sample_key)
    return {"train": train, "val": val}


def fixed_split(rows: list[dict[str, Any]], *, field: str) -> dict[str, list[dict[str, Any]]]:
    splits = {"train": [], "val": []}
    for row in rows:
        value = str(row.get(field, "")).strip().lower()
        if value not in splits:
            raise ValueError(f"manifest row has invalid fixed split {field}={value!r}")
        splits[value].append(row)
    if not splits["train"] or not splits["val"]:
        raise ValueError(f"fixed split field must provide non-empty train and val rows: {field}")
    for split_rows in splits.values():
        split_rows.sort(key=sample_key)
    return splits


def sample_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (str(row.get("split", "")), str(row.get("classification_label", "")), str(row.get("image_file", "")))


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
    rows = load_manifest(manifest)
    splits = fixed_split(rows, field=fixed_split_field) if fixed_split_field else stratified_split(
        rows, train_ratio=train_ratio, seed=seed
    )
    dataset_root = output_root / "datasets" / name
    replace_dir(dataset_root)

    for split_name, split_rows in splits.items():
        materialize_split(dataset_root=dataset_root, split=split_name, rows=split_rows, copy_images=copy_images)

    data_yaml = dataset_root / "data.yaml"
    class_names = class_names_from_rows(rows)
    data_yaml.write_text(
        "\n".join(
            [
                f"path: {dataset_root.resolve().as_posix()}",
                "train: images/train",
                "val: images/val",
                "test: images/val",
                "names:",
                *[f"  {index}: {name}" for index, name in enumerate(class_names)],
                "",
            ]
        ),
        encoding="utf-8",
    )

    split_summary = {split: split_counts(rows) for split, rows in splits.items()}
    summary = {
        "dataset_root": str(dataset_root),
        "data_yaml": str(data_yaml),
        "source_manifest": str(manifest),
        "train_ratio": train_ratio,
        "fixed_split_field": fixed_split_field or None,
        "seed": seed,
        "image_mode": "copy" if copy_images else "symlink",
        "class_names": class_names,
        "total_samples": len(rows),
        "splits": split_summary,
    }
    write_json(dataset_root / "split-summary.json", summary)
    return summary


def materialize_split(*, dataset_root: Path, split: str, rows: list[dict[str, Any]], copy_images: bool) -> None:
    image_dir = dataset_root / "images" / split
    label_dir = dataset_root / "labels" / split
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = dataset_root / "annotations" / f"{split}.jsonl"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    manifest_lines: list[str] = []
    seen_stems: set[str] = set()
    for row in rows:
        image_path = Path(required_string(row, "image_path"))
        if not image_path.exists():
            raise FileNotFoundError(f"image file not found: {image_path}")
        target_stem = training_file_stem(row, image_path)
        if target_stem in seen_stems:
            raise ValueError(f"duplicate training sample target stem in {split}: {target_stem}")
        seen_stems.add(target_stem)
        image_target = image_dir / f"{target_stem}{image_path.suffix}"
        link_or_copy(image_path.resolve(), image_target, copy_file=copy_images)

        boxes, class_ids = boxes_and_class_ids(row)
        for bbox in boxes:
            if not valid_bbox(bbox):
                raise ValueError(f"invalid bbox for {image_path}: {bbox}")
        width = int(row["width"])
        height = int(row["height"])
        label_target = label_dir / f"{target_stem}.txt"
        label_target.write_text(
            "".join(yolo_line(bbox, width, height, class_id=class_id) for bbox, class_id in zip(boxes, class_ids, strict=True)),
            encoding="utf-8",
        )

        manifest_row = {
            **row,
            "training_split": split,
            "training_image_path": str(image_target),
            "training_label_path": str(label_target),
        }
        manifest_lines.append(json.dumps(manifest_row, ensure_ascii=False))

    manifest_path.write_text("\n".join(manifest_lines) + ("\n" if manifest_lines else ""), encoding="utf-8")


def training_file_stem(row: dict[str, Any], image_path: Path) -> str:
    source_split = safe_component(str(row.get("split", "source") or "source"))
    image_id = safe_component(str(row.get("image_id", image_path.stem) or image_path.stem))
    return f"{source_split}_{image_id}"


def safe_component(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in value.strip())
    return cleaned or "unknown"


def required_string(row: dict[str, Any], key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"manifest row missing string field: {key}")
    return value


def boxes_and_class_ids(row: dict[str, Any]) -> tuple[list[list[int | float]], list[int]]:
    raw_boxes = row.get("bboxes_xyxy")
    if isinstance(raw_boxes, list) and raw_boxes and all(valid_bbox(item) for item in raw_boxes):
        boxes = raw_boxes
    else:
        bbox = row.get("bbox_xyxy")
        boxes = [bbox] if valid_bbox(bbox) else []
    if not boxes:
        raise ValueError(f"manifest row has no valid boxes: {row.get('image_path')}")
    raw_class_ids = row.get("yolo_class_ids")
    if isinstance(raw_class_ids, list) and len(raw_class_ids) == len(boxes):
        class_ids = [int(value) for value in raw_class_ids]
    else:
        class_ids = [0 for _ in boxes]
    return boxes, class_ids


def class_names_from_rows(rows: list[dict[str, Any]]) -> list[str]:
    class_names: list[str] | None = None
    for row in rows:
        raw = row.get("yolo_class_names")
        if not isinstance(raw, list) or not raw or not all(isinstance(item, str) and item for item in raw):
            continue
        candidate = list(raw)
        if class_names is None:
            class_names = candidate
        elif class_names != candidate:
            raise ValueError("manifest rows contain inconsistent yolo_class_names")
    if class_names is not None:
        return class_names
    return ["thyroid_nodule"]


def valid_bbox(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(item, (int, float)) for item in value)
        and value[2] > value[0]
        and value[3] > value[1]
    )


def yolo_line(bbox: list[int | float], width: int, height: int, *, class_id: int) -> str:
    left, top, right, bottom = [float(item) for item in bbox]
    box_width = right - left
    box_height = bottom - top
    x_center = (left + box_width / 2) / width
    y_center = (top + box_height / 2) / height
    return f"{class_id} {x_center:.6f} {y_center:.6f} {box_width / width:.6f} {box_height / height:.6f}\n"


def split_counts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    labels: dict[str, int] = {}
    original_splits: dict[str, int] = {}
    boxes = 0
    for row in rows:
        labels[str(row.get("classification_label", "unknown"))] = labels.get(str(row.get("classification_label", "unknown")), 0) + 1
        original_splits[str(row.get("split", "unknown"))] = original_splits.get(str(row.get("split", "unknown")), 0) + 1
        boxes += len(boxes_and_class_ids(row)[0])
    return {
        "samples": len(rows),
        "boxes": boxes,
        "classification_labels": labels,
        "source_splits": original_splits,
    }


def link_or_copy(source: Path, target: Path, *, copy_file: bool) -> None:
    if target.exists() or target.is_symlink():
        target.unlink()
    if copy_file:
        shutil.copy2(source, target)
        return
    try:
        target.symlink_to(source)
    except OSError:
        shutil.copy2(source, target)


def replace_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def train_ultralytics_detector(
    *,
    data_yaml: Path,
    model_ref: str,
    model_family: str,
    output_root: Path,
    name: str,
    epochs: int,
    patience: int,
    imgsz: int,
    batch: int,
    device: str,
    workers: int,
    cache: str,
    optimizer: str,
    lr0: float,
    lrf: float,
    warmup_epochs: float,
    close_mosaic: int,
    multi_scale: bool,
    mosaic: float,
    scale: float,
    translate: float,
    hsv_h: float,
    hsv_s: float,
    hsv_v: float,
    erasing: float,
    auto_augment: str,
) -> dict[str, Any]:
    if not data_yaml.exists():
        raise FileNotFoundError(f"YOLO data.yaml not found: {data_yaml}")

    try:
        from ultralytics import RTDETR, YOLO  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("ultralytics is required in the active Python environment") from exc

    effective_model_ref = effective_model_reference(model_ref)
    project = output_root / "runs"
    project.mkdir(parents=True, exist_ok=True)
    model = RTDETR(effective_model_ref) if model_family == "rtdetr" else YOLO(effective_model_ref)
    cache_value: bool | str = False if cache == "false" else cache
    result = model.train(
        data=str(data_yaml),
        epochs=epochs,
        patience=patience,
        imgsz=imgsz,
        batch=batch,
        device=device,
        workers=workers,
        cache=cache_value,
        optimizer=optimizer,
        lr0=lr0,
        lrf=lrf,
        warmup_epochs=warmup_epochs,
        cos_lr=True,
        close_mosaic=close_mosaic,
        multi_scale=multi_scale,
        mosaic=mosaic,
        scale=scale,
        translate=translate,
        hsv_h=hsv_h,
        hsv_s=hsv_s,
        hsv_v=hsv_v,
        erasing=erasing,
        auto_augment=None if auto_augment == "none" else auto_augment,
        amp=True,
        project=str(project),
        name=name,
        exist_ok=True,
        plots=True,
        verbose=False,
    )
    run_dir = Path(getattr(result, "save_dir", project / name))
    summary = {
        "run_dir": str(run_dir),
        "effective_model": effective_model_ref,
        "best_weights": str(run_dir / "weights" / "best.pt"),
        "last_weights": str(run_dir / "weights" / "last.pt"),
        "results_csv": str(run_dir / "results.csv"),
        "metrics": read_last_csv_row(run_dir / "results.csv"),
    }
    return summary


def effective_model_reference(model_ref: str) -> str:
    path = Path(model_ref)
    if path.exists():
        return str(path)
    if path.name.startswith("yolo11") and path.name.endswith(".pt"):
        return path.name
    if path.name.startswith("rtdetr") and path.name.endswith(".pt"):
        return path.name
    return model_ref


def target_result(metrics: dict[str, str] | None, *, metric_name: str, threshold: float) -> dict[str, Any]:
    value = metric_float(metrics, metric_name)
    return {
        "metric": metric_name,
        "threshold": threshold,
        "value": value,
        "target_met": value is not None and value >= threshold,
    }


def metric_float(metrics: dict[str, str] | None, metric_name: str) -> float | None:
    if metrics is None:
        return None
    raw = metrics.get(metric_name)
    if raw is None:
        normalized = {key.strip(): value for key, value in metrics.items()}
        raw = normalized.get(metric_name)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def read_last_csv_row(path: Path) -> dict[str, str] | None:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        return None
    return {key.strip(): value.strip() for key, value in rows[-1].items()}


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
        "schema_version": "thyroid.ultralytics_detector.training.v1",
        "status": "prepared" if args.prepare_only else "running",
        "name": args.name,
        "model": args.model,
        "model_family": args.model_family,
        "output_root": str(args.output_root),
        "params": {
            "train_ratio": args.train_ratio,
            "fixed_split_field": args.fixed_split_field or None,
            "seed": args.seed,
            "epochs": args.epochs,
            "patience": args.patience,
            "imgsz": args.imgsz,
            "batch": args.batch,
            "device": args.device,
            "workers": args.workers,
            "cache": args.cache,
            "optimizer": args.optimizer,
            "lr0": args.lr0,
            "lrf": args.lrf,
            "warmup_epochs": args.warmup_epochs,
            "close_mosaic": args.close_mosaic,
            "multi_scale": args.multi_scale,
            "mosaic": args.mosaic,
            "scale": args.scale,
            "translate": args.translate,
            "hsv_h": args.hsv_h,
            "hsv_s": args.hsv_s,
            "hsv_v": args.hsv_v,
            "erasing": args.erasing,
            "auto_augment": args.auto_augment,
            "target_metric": args.target_metric,
            "target_threshold": args.target_threshold,
        },
        "dataset": dataset,
    }
    summary_path = args.output_root / "summaries" / f"{args.name}.json"
    if args.prepare_only:
        write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    summary["training"] = train_ultralytics_detector(
        data_yaml=Path(dataset["data_yaml"]),
        model_ref=args.model,
        model_family=args.model_family,
        output_root=args.output_root,
        name=args.name,
        epochs=args.epochs,
        patience=args.patience,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        cache=args.cache,
        optimizer=args.optimizer,
        lr0=args.lr0,
        lrf=args.lrf,
        warmup_epochs=args.warmup_epochs,
        close_mosaic=args.close_mosaic,
        multi_scale=args.multi_scale,
        mosaic=args.mosaic,
        scale=args.scale,
        translate=args.translate,
        hsv_h=args.hsv_h,
        hsv_s=args.hsv_s,
        hsv_v=args.hsv_v,
        erasing=args.erasing,
        auto_augment=args.auto_augment,
    )
    summary["target"] = target_result(
        summary["training"]["metrics"],
        metric_name=args.target_metric,
        threshold=args.target_threshold,
    )
    summary["status"] = "target_met" if summary["target"]["target_met"] else "target_not_met"
    write_json(summary_path, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
