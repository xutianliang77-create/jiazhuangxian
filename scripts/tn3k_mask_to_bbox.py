from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - exercised by real CLI environments only.
    raise SystemExit("Pillow is required. Install it with: pip install Pillow") from exc


DATASET_ID = "tn3k"
DEFAULT_TN3K_ROOT = Path("data/artifacts/datasets/tn3k/processed/datasets/tn3k")
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/datasets/tn3k/derived/detection")
SPLITS = ("trainval", "test")


@dataclass(frozen=True)
class DetectionSample:
    dataset_id: str
    split: str
    image_id: str
    image_file: str
    image_path: str
    mask_path: str
    width: int
    height: int
    bbox_xyxy: list[int]
    bbox_xywh: list[int]
    foreground_pixels: int
    classification_label: int | None
    yolo_label_path: str
    yolo_image_path: str | None


@dataclass
class SplitSummary:
    split: str
    images_seen: int = 0
    converted: int = 0
    skipped_empty_masks: int = 0
    skipped_missing_masks: int = 0
    skipped_size_mismatch: int = 0
    missing_classification_labels: int = 0

    @property
    def skipped(self) -> int:
        return self.skipped_empty_masks + self.skipped_missing_masks + self.skipped_size_mismatch


def parse_label_csv(path: Path) -> dict[str, int]:
    labels: dict[str, int] = {}
    if not path.exists():
        return labels
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 2:
                continue
            name = row[0].strip()
            label = row[1].strip()
            if not name or name.lower() in {"image", "filename", "file"}:
                continue
            try:
                labels[name] = int(label)
            except ValueError:
                continue
    return labels


def mask_bbox(mask_path: Path, *, threshold: int, min_foreground_pixels: int) -> tuple[list[int] | None, int]:
    mask = Image.open(mask_path).convert("L")
    binary = mask.point(lambda value: 255 if value > threshold else 0)
    bbox = binary.getbbox()
    foreground_pixels = int(binary.histogram()[255])
    if bbox is None or foreground_pixels < min_foreground_pixels:
        return None, foreground_pixels
    left, top, right, bottom = [int(value) for value in bbox]
    return [left, top, right, bottom], foreground_pixels


def bbox_xywh(bbox_xyxy: list[int]) -> list[int]:
    left, top, right, bottom = bbox_xyxy
    return [left, top, right - left, bottom - top]


def yolo_line(bbox: list[int], width: int, height: int, *, class_id: int) -> str:
    left, top, box_width, box_height = bbox_xywh(bbox)
    x_center = (left + box_width / 2) / width
    y_center = (top + box_height / 2) / height
    return f"{class_id} {x_center:.6f} {y_center:.6f} {box_width / width:.6f} {box_height / height:.6f}\n"


def convert_dataset(
    *,
    tn3k_root: Path,
    output_root: Path,
    threshold: int = 127,
    min_foreground_pixels: int = 1,
    class_id: int = 0,
    image_mode: str = "symlink",
    limit: int | None = None,
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "annotations").mkdir(parents=True, exist_ok=True)
    (output_root / "coco").mkdir(parents=True, exist_ok=True)
    (output_root / "yolo").mkdir(parents=True, exist_ok=True)

    write_yolo_dataset_yaml(output_root / "yolo")
    (output_root / "yolo" / "classes.txt").write_text("thyroid_nodule\n", encoding="utf-8")

    split_summaries: dict[str, SplitSummary] = {}
    all_samples: list[DetectionSample] = []
    for split in SPLITS:
        samples, summary = convert_split(
            tn3k_root=tn3k_root,
            output_root=output_root,
            split=split,
            threshold=threshold,
            min_foreground_pixels=min_foreground_pixels,
            class_id=class_id,
            image_mode=image_mode,
            limit=limit,
        )
        split_summaries[split] = summary
        all_samples.extend(samples)

    write_jsonl(output_root / "annotations" / "manifest.jsonl", all_samples)

    summary = {
        "schema_version": "tn3k.mask_to_bbox.summary.v1",
        "dataset_id": DATASET_ID,
        "source_root": str(tn3k_root),
        "output_root": str(output_root),
        "threshold": threshold,
        "min_foreground_pixels": min_foreground_pixels,
        "class_id": class_id,
        "image_mode": image_mode,
        "splits": {split: asdict(item) | {"skipped": item.skipped} for split, item in split_summaries.items()},
        "total": {
            "images_seen": sum(item.images_seen for item in split_summaries.values()),
            "converted": sum(item.converted for item in split_summaries.values()),
            "skipped": sum(item.skipped for item in split_summaries.values()),
            "missing_classification_labels": sum(item.missing_classification_labels for item in split_summaries.values()),
        },
        "outputs": {
            "yolo_root": str(output_root / "yolo"),
            "coco_trainval": str(output_root / "coco" / "trainval.json"),
            "coco_test": str(output_root / "coco" / "test.json"),
            "manifest_jsonl": str(output_root / "annotations" / "manifest.jsonl"),
        },
    }
    write_json(output_root / "summary.json", summary)
    return summary


def convert_split(
    *,
    tn3k_root: Path,
    output_root: Path,
    split: str,
    threshold: int,
    min_foreground_pixels: int,
    class_id: int,
    image_mode: str,
    limit: int | None,
) -> tuple[list[DetectionSample], SplitSummary]:
    image_dir = tn3k_root / f"{split}-image"
    mask_dir = tn3k_root / f"{split}-mask"
    labels = parse_label_csv(tn3k_root / f"label4{split}.csv")
    summary = SplitSummary(split=split)
    samples: list[DetectionSample] = []
    coco_images: list[dict[str, Any]] = []
    coco_annotations: list[dict[str, Any]] = []

    for index, image_path in enumerate(limited(sorted(image_dir.glob("*.jpg")), limit), start=1):
        summary.images_seen += 1
        mask_path = mask_dir / image_path.name
        if not mask_path.exists():
            summary.skipped_missing_masks += 1
            continue

        with Image.open(image_path) as image:
            width, height = image.size
        with Image.open(mask_path) as mask:
            mask_size = mask.size
        if mask_size != (width, height):
            summary.skipped_size_mismatch += 1
            continue

        bbox, foreground_pixels = mask_bbox(
            mask_path,
            threshold=threshold,
            min_foreground_pixels=min_foreground_pixels,
        )
        if bbox is None:
            summary.skipped_empty_masks += 1
            continue

        label = labels.get(image_path.name)
        if label is None:
            summary.missing_classification_labels += 1

        yolo_label_path = output_root / "yolo" / "labels" / split / f"{image_path.stem}.txt"
        yolo_label_path.parent.mkdir(parents=True, exist_ok=True)
        yolo_label_path.write_text(yolo_line(bbox, width, height, class_id=class_id), encoding="utf-8")
        yolo_image_path = prepare_yolo_image(image_path, output_root / "yolo" / "images" / split, image_mode)

        sample = DetectionSample(
            dataset_id=DATASET_ID,
            split=split,
            image_id=image_path.stem,
            image_file=image_path.name,
            image_path=str(image_path),
            mask_path=str(mask_path),
            width=width,
            height=height,
            bbox_xyxy=bbox,
            bbox_xywh=bbox_xywh(bbox),
            foreground_pixels=foreground_pixels,
            classification_label=label,
            yolo_label_path=str(yolo_label_path),
            yolo_image_path=str(yolo_image_path) if yolo_image_path else None,
        )
        samples.append(sample)
        summary.converted += 1

        coco_images.append(
            {
                "id": index,
                "file_name": f"images/{split}/{image_path.name}",
                "width": width,
                "height": height,
                "source_file": str(image_path),
                "classification_label": label,
            }
        )
        coco_annotations.append(
            {
                "id": index,
                "image_id": index,
                "category_id": 1,
                "bbox": bbox_xywh(bbox),
                "area": bbox_xywh(bbox)[2] * bbox_xywh(bbox)[3],
                "iscrowd": 0,
                "foreground_pixels": foreground_pixels,
                "source_mask": str(mask_path),
            }
        )

    write_jsonl(output_root / "annotations" / f"{split}.jsonl", samples)
    write_json(
        output_root / "coco" / f"{split}.json",
        {
            "info": {
                "description": "TN3K mask-derived thyroid nodule detection annotations",
                "source_dataset": DATASET_ID,
                "split": split,
            },
            "licenses": [{"id": 1, "name": "MIT"}],
            "categories": [{"id": 1, "name": "thyroid_nodule", "supercategory": "nodule"}],
            "images": coco_images,
            "annotations": coco_annotations,
        },
    )
    return samples, summary


def prepare_yolo_image(image_path: Path, image_dir: Path, image_mode: str) -> Path | None:
    if image_mode == "none":
        return None
    image_dir.mkdir(parents=True, exist_ok=True)
    target = image_dir / image_path.name
    replace_file(target)
    if image_mode == "copy":
        shutil.copy2(image_path, target)
    elif image_mode == "symlink":
        try:
            target.symlink_to(image_path.resolve())
        except OSError:
            shutil.copy2(image_path, target)
    else:
        raise ValueError(f"unsupported image mode: {image_mode}")
    return target


def replace_file(path: Path) -> None:
    if path.exists() or path.is_symlink():
        if path.is_dir():
            raise IsADirectoryError(str(path))
        path.unlink()


def write_yolo_dataset_yaml(yolo_root: Path) -> None:
    yolo_root.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        [
            f"path: {yolo_root.resolve().as_posix()}",
            "train: images/trainval",
            "val: images/test",
            "test: images/test",
            "names:",
            "  0: thyroid_nodule",
            "",
        ]
    )
    (yolo_root / "data.yaml").write_text(content, encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, samples: Iterable[DetectionSample]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(asdict(sample), ensure_ascii=False) for sample in samples]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def limited(paths: list[Path], limit: int | None) -> Iterable[Path]:
    if limit is None or limit <= 0:
        return paths
    return paths[:limit]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert TN3K segmentation masks into detection bbox annotations.")
    parser.add_argument("--tn3k-root", type=Path, default=DEFAULT_TN3K_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--threshold", type=int, default=127, help="Foreground mask threshold; pixels > threshold are foreground.")
    parser.add_argument("--min-foreground-pixels", type=int, default=1)
    parser.add_argument("--class-id", type=int, default=0, help="YOLO class id for thyroid_nodule.")
    parser.add_argument("--image-mode", choices=("symlink", "copy", "none"), default="symlink")
    parser.add_argument("--limit", type=int, default=0, help="Optional per-split sample limit for smoke tests.")
    parser.add_argument("--allow-skips", action="store_true", help="Exit successfully even if masks are skipped.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    summary = convert_dataset(
        tn3k_root=args.tn3k_root,
        output_root=args.output_root,
        threshold=args.threshold,
        min_foreground_pixels=args.min_foreground_pixels,
        class_id=args.class_id,
        image_mode=args.image_mode,
        limit=args.limit if args.limit > 0 else None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if summary["total"]["skipped"] and not args.allow_skips:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
