from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    import pyarrow.parquet as pq
except ImportError as exc:  # pragma: no cover - real CLI environment only.
    raise SystemExit("pyarrow is required. Install it with: pip install pyarrow") from exc

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - real CLI environment only.
    raise SystemExit("Pillow is required. Install it with: pip install Pillow") from exc


DEFAULT_PARQUET_ROOT = Path("data/artifacts/datasets/hf-thyroid/btx24_thyroid_cancer_classification_ultrasound/raw/data")
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/datasets/hf-thyroid/btx24_thyroid_cancer_classification_ultrasound/derived/pseudo-detection")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create BTX24 pseudo bbox labels with a trained thyroid detector.")
    parser.add_argument("--parquet-root", type=Path, default=DEFAULT_PARQUET_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--detector", required=True)
    parser.add_argument("--conf", type=float, default=0.5)
    parser.add_argument("--imgsz", type=int, default=896)
    parser.add_argument("--device", default="0")
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    summary = build_pseudo_manifest(
        parquet_root=args.parquet_root,
        output_root=args.output_root,
        detector=args.detector,
        conf=args.conf,
        imgsz=args.imgsz,
        device=args.device,
        batch=args.batch,
        limit=args.limit or None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def build_pseudo_manifest(
    *,
    parquet_root: Path,
    output_root: Path,
    detector: str,
    conf: float,
    imgsz: int,
    device: str,
    batch: int,
    limit: int | None,
) -> dict[str, Any]:
    image_root = output_root / "images"
    image_root.mkdir(parents=True, exist_ok=True)
    exported = export_images(parquet_root, image_root, limit=limit)
    rows, reject_counts = pseudo_label(exported, detector=detector, conf=conf, imgsz=imgsz, device=device, batch=batch)
    manifest_path = output_root / "annotations" / "manifest.jsonl"
    write_jsonl(manifest_path, rows)
    summary = {
        "schema_version": "btx24.pseudo_detection_manifest.summary.v1",
        "source_parquet_root": str(parquet_root),
        "output_root": str(output_root),
        "manifest_jsonl": str(manifest_path),
        "detector": detector,
        "conf": conf,
        "imgsz": imgsz,
        "device": device,
        "exported_images": len(exported),
        "pseudo_labeled": len(rows),
        "rejected": dict(sorted(reject_counts.items())),
        "classification_label_counts": dict(sorted(Counter(str(row["classification_label"]) for row in rows).items())),
        "source_split_counts": dict(sorted(Counter(str(row["split"]) for row in rows).items())),
    }
    write_json(output_root / "summary.json", summary)
    return summary


def export_images(parquet_root: Path, image_root: Path, *, limit: int | None) -> list[dict[str, Any]]:
    if not parquet_root.exists():
        raise FileNotFoundError(f"BTX24 parquet root not found: {parquet_root}")
    exported: list[dict[str, Any]] = []
    for parquet in sorted(parquet_root.glob("*.parquet")):
        split = parquet.name.split("-", 1)[0]
        table = pq.read_table(parquet, columns=["image", "label"])
        images = table.column("image").to_pylist()
        labels = table.column("label").to_pylist()
        for index, (image_payload, label) in enumerate(zip(images, labels)):
            if limit is not None and len(exported) >= limit:
                return exported
            if not isinstance(image_payload, dict) or image_payload.get("bytes") is None:
                continue
            with Image.open(BytesIO(image_payload["bytes"])) as image:
                rgb = image.convert("RGB")
                width, height = rgb.size
                target = image_root / split / str(label) / f"{split}_{index:06d}_label{label}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    rgb.save(target)
            exported.append(
                {
                    "split": f"btx24_{split}_label{label}",
                    "image_id": f"{split}_{index:06d}_label{label}",
                    "image_file": target.name,
                    "image_path": str(target),
                    "width": width,
                    "height": height,
                    "classification_label": int(label),
                }
            )
    return exported


def pseudo_label(
    exported: list[dict[str, Any]],
    *,
    detector: str,
    conf: float,
    imgsz: int,
    device: str,
    batch: int,
) -> tuple[list[dict[str, Any]], Counter[str]]:
    try:
        from ultralytics import YOLO  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - real CLI environment only.
        raise RuntimeError("ultralytics is required for pseudo labeling") from exc

    model = YOLO(detector)
    rows: list[dict[str, Any]] = []
    rejects: Counter[str] = Counter()
    for chunk in chunks(exported, max(32, batch * 8)):
        paths = [str(Path(item["image_path"]).resolve()) for item in chunk]
        predictions = model.predict(source=paths, imgsz=imgsz, conf=conf, device=device, batch=batch, verbose=False, stream=True)
        for item, result in zip(chunk, predictions):
            image_path = str(Path(item["image_path"]).resolve())
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                rejects["no_box"] += 1
                continue
            best_index = int(boxes.conf.argmax().item())
            best_conf = float(boxes.conf[best_index].item())
            xyxy = [float(value) for value in boxes.xyxy[best_index].tolist()]
            width = int(item["width"])
            height = int(item["height"])
            if not plausible_bbox(xyxy, width, height):
                rejects["implausible_box"] += 1
                continue
            rows.append(
                {
                    "dataset_id": "btx24_pseudo_detection",
                    "split": item["split"],
                    "image_id": item["image_id"],
                    "image_file": item["image_file"],
                    "image_path": image_path,
                    "width": width,
                    "height": height,
                    "bbox_xyxy": [round(value, 2) for value in xyxy],
                    "bbox_xywh": [
                        round(xyxy[0], 2),
                        round(xyxy[1], 2),
                        round(xyxy[2] - xyxy[0], 2),
                        round(xyxy[3] - xyxy[1], 2),
                    ],
                    "classification_label": item["classification_label"],
                    "bbox_source": f"pseudo_detector:{Path(detector).name}",
                    "pseudo_confidence": round(best_conf, 6),
                    "sample_quality": "pseudo_detector_high_conf",
                    "fixed_training_split": "train",
                }
            )
    return rows, rejects


def chunks(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def plausible_bbox(xyxy: list[float], width: int, height: int) -> bool:
    left, top, right, bottom = xyxy
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        return False
    area_ratio = ((right - left) * (bottom - top)) / float(width * height)
    return 0.002 <= area_ratio <= 0.85


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + ("\n" if rows else ""), encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
