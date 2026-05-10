from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - real CLI environment only.
    raise SystemExit("Pillow is required. Install it with: pip install Pillow") from exc


DEFAULT_DATASET_ROOT = Path(
    "data/artifacts/datasets/tn5000/raw/extracted/TN5000_forReview/TN5000_forReview"
)
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/datasets/tn5000/derived/detection-clean")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert and clean the official TN5000 VOC archive.")
    parser.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=20260510)
    parser.add_argument("--image-mode", choices=("symlink", "copy", "none"), default="symlink")
    parser.add_argument(
        "--class-mode",
        choices=("collapsed", "binary"),
        default="collapsed",
        help="collapsed trains one thyroid_nodule class; binary keeps benign/malignant class ids.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    summary = convert_dataset(
        dataset_root=args.dataset_root,
        output_root=args.output_root,
        train_ratio=args.train_ratio,
        seed=args.seed,
        image_mode=args.image_mode,
        class_mode=args.class_mode,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def convert_dataset(
    *,
    dataset_root: Path,
    output_root: Path,
    train_ratio: float = 0.8,
    seed: int = 20260510,
    image_mode: str = "symlink",
    class_mode: str = "collapsed",
) -> dict[str, Any]:
    if class_mode not in {"collapsed", "binary"}:
        raise ValueError("class_mode must be collapsed or binary")
    if image_mode not in {"symlink", "copy", "none"}:
        raise ValueError("image_mode must be symlink, copy, or none")
    if not 0 < train_ratio < 1:
        raise ValueError("train_ratio must be between 0 and 1")

    output_root.mkdir(parents=True, exist_ok=True)
    samples, raw_summary = load_valid_samples(dataset_root)
    rows, merge_summary = merge_exact_duplicate_images(samples, class_mode=class_mode)
    splits = stratified_split(rows, train_ratio=train_ratio, seed=seed)
    rows_with_split = []
    for split_name, split_rows in splits.items():
        for row in split_rows:
            rows_with_split.append({**row, "fixed_training_split": split_name})
    rows_with_split.sort(key=lambda row: (row["fixed_training_split"], row["image_id"]))

    write_outputs(output_root, rows_with_split, image_mode=image_mode, class_mode=class_mode)
    summary = build_summary(
        dataset_root=dataset_root,
        output_root=output_root,
        rows=rows_with_split,
        raw_summary=raw_summary,
        merge_summary=merge_summary,
        train_ratio=train_ratio,
        seed=seed,
        image_mode=image_mode,
        class_mode=class_mode,
    )
    write_json(output_root / "summary.json", summary)
    (output_root / "README.md").write_text(render_markdown(summary), encoding="utf-8")
    return summary


def load_valid_samples(dataset_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    image_dir = dataset_root / "JPEGImages"
    annotation_dir = dataset_root / "Annotations"
    split_by_image = read_split_membership(dataset_root / "ImageSets" / "Main")
    if not image_dir.exists():
        raise FileNotFoundError(f"JPEGImages not found: {image_dir}")
    if not annotation_dir.exists():
        raise FileNotFoundError(f"Annotations not found: {annotation_dir}")

    samples = []
    skipped: dict[str, list[str]] = {
        "missing_annotation": [],
        "invalid_xml": [],
        "dimension_mismatch": [],
        "invalid_or_out_of_bounds_box": [],
        "empty_annotation": [],
    }
    for image_path in sorted(path for path in image_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS):
        annotation_path = annotation_dir / f"{image_path.stem}.xml"
        if not annotation_path.exists():
            skipped["missing_annotation"].append(image_path.stem)
            continue
        try:
            annotation = parse_voc_annotation(annotation_path)
        except (ET.ParseError, ValueError) as exc:
            skipped["invalid_xml"].append(f"{image_path.stem}: {exc}")
            continue
        with Image.open(image_path) as image:
            width, height = image.size
            image.verify()
        if (annotation["width"], annotation["height"]) != (width, height):
            skipped["dimension_mismatch"].append(
                f"{image_path.stem}: xml={annotation['width']}x{annotation['height']}, image={width}x{height}"
            )
            continue
        if not annotation["objects"]:
            skipped["empty_annotation"].append(image_path.stem)
            continue
        objects = []
        bad_box = False
        for obj in annotation["objects"]:
            bbox = obj["bbox_xyxy"]
            if not valid_bbox(bbox, width, height):
                skipped["invalid_or_out_of_bounds_box"].append(f"{image_path.stem}: {bbox}")
                bad_box = True
                break
            objects.append({"class_name": obj["name"], "bbox_xyxy": bbox, "bbox_xywh": bbox_xywh(bbox)})
        if bad_box:
            continue
        digest = sha256_file(image_path)
        samples.append(
            {
                "image_id": image_path.stem,
                "image_file": image_path.name,
                "image_path": str(image_path),
                "annotation_path": str(annotation_path),
                "source_split": split_by_image.get(image_path.stem, "unknown"),
                "width": width,
                "height": height,
                "sha256": digest,
                "objects": objects,
            }
        )
    return samples, {
        "input_images": len([path for path in image_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS]),
        "valid_original_samples": len(samples),
        "skipped": {key: {"count": len(values), "samples": values[:20]} for key, values in skipped.items()},
    }


def parse_voc_annotation(path: Path) -> dict[str, Any]:
    root = ET.parse(path).getroot()
    size = root.find("size")
    if size is None:
        raise ValueError("missing size")
    objects = []
    for obj in root.findall("object"):
        bbox = obj.find("bndbox")
        if bbox is None:
            continue
        objects.append(
            {
                "name": obj.findtext("name", "unknown"),
                "bbox_xyxy": [
                    int(float(bbox.findtext("xmin", "0"))),
                    int(float(bbox.findtext("ymin", "0"))),
                    int(float(bbox.findtext("xmax", "0"))),
                    int(float(bbox.findtext("ymax", "0"))),
                ],
            }
        )
    return {
        "width": int(size.findtext("width", "0")),
        "height": int(size.findtext("height", "0")),
        "objects": objects,
    }


def read_split_membership(split_dir: Path) -> dict[str, str]:
    membership = {}
    for split_name in ["train", "val", "test"]:
        path = split_dir / f"{split_name}.txt"
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            image_id = line.strip().split()[0] if line.strip() else ""
            if image_id:
                membership[image_id] = split_name
    return membership


def merge_exact_duplicate_images(samples: list[dict[str, Any]], *, class_mode: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for sample in samples:
        grouped[sample["sha256"]].append(sample)

    rows = []
    merged_group_count = 0
    merged_original_sample_count = 0
    mixed_label_groups = []
    for digest, group in sorted(grouped.items()):
        group = sorted(group, key=lambda item: item["image_id"])
        canonical = group[0]
        merged_objects = []
        seen_objects: set[tuple[str, tuple[int, int, int, int]]] = set()
        for sample in group:
            for obj in sample["objects"]:
                key = (obj["class_name"], tuple(obj["bbox_xyxy"]))
                if key in seen_objects:
                    continue
                seen_objects.add(key)
                merged_objects.append(
                    {
                        **obj,
                        "source_image_id": sample["image_id"],
                        "source_split": sample["source_split"],
                    }
                )
        labels = sorted({obj["class_name"] for obj in merged_objects})
        if len(group) > 1:
            merged_group_count += 1
            merged_original_sample_count += len(group)
        if len(labels) > 1:
            mixed_label_groups.append([sample["image_id"] for sample in group])
        yolo_class_ids = [class_id_for(obj["class_name"], class_mode=class_mode) for obj in merged_objects]
        bboxes = [obj["bbox_xyxy"] for obj in merged_objects]
        rows.append(
            {
                "dataset_id": "tn5000_detection_clean",
                "split": "tn5000_cleaned",
                "image_id": canonical["image_id"],
                "image_file": canonical["image_file"],
                "image_path": canonical["image_path"],
                "annotation_path": canonical["annotation_path"],
                "width": canonical["width"],
                "height": canonical["height"],
                "sha256": digest,
                "bbox_source": "true_voc_bbox_merged_exact_duplicate_frames",
                "sample_quality": "strict_detector_cleaned",
                "source_image_ids": [sample["image_id"] for sample in group],
                "source_splits": sorted({sample["source_split"] for sample in group}),
                "source_class_labels": labels,
                "classification_label": int(labels[0]) if len(labels) == 1 and labels[0] in {"0", "1"} else None,
                "object_count": len(merged_objects),
                "bbox_xyxy": bboxes[0],
                "bbox_xywh": bbox_xywh(bboxes[0]),
                "bboxes_xyxy": bboxes,
                "bboxes_xywh": [bbox_xywh(bbox) for bbox in bboxes],
                "yolo_class_ids": yolo_class_ids,
                "yolo_class_names": class_names_for(class_mode),
                "objects": merged_objects,
            }
        )
    return rows, {
        "unique_image_hashes": len(rows),
        "merged_duplicate_hash_groups": merged_group_count,
        "merged_duplicate_original_samples": merged_original_sample_count,
        "mixed_label_duplicate_groups": {"count": len(mixed_label_groups), "samples": mixed_label_groups[:20]},
    }


def class_id_for(class_name: str, *, class_mode: str) -> int:
    if class_mode == "collapsed":
        return 0
    if class_name not in {"0", "1"}:
        raise ValueError(f"unsupported TN5000 class label: {class_name}")
    return int(class_name)


def class_names_for(class_mode: str) -> list[str]:
    if class_mode == "collapsed":
        return ["thyroid_nodule"]
    return ["benign_thyroid_nodule", "malignant_thyroid_nodule"]


def stratified_split(rows: list[dict[str, Any]], *, train_ratio: float, seed: int) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row.get("classification_label", "unknown"))].append(row)
    rng = random.Random(seed)
    splits = {"train": [], "val": []}
    for _, items in sorted(grouped.items()):
        shuffled = list(items)
        rng.shuffle(shuffled)
        train_count = round(len(shuffled) * train_ratio)
        splits["train"].extend(shuffled[:train_count])
        splits["val"].extend(shuffled[train_count:])
    for split_rows in splits.values():
        split_rows.sort(key=lambda row: row["image_id"])
    return splits


def write_outputs(output_root: Path, rows: list[dict[str, Any]], *, image_mode: str, class_mode: str) -> None:
    replace_dir(output_root / "annotations")
    replace_dir(output_root / "coco")
    replace_dir(output_root / "yolo")

    write_jsonl(output_root / "annotations" / "manifest.jsonl", rows)
    for split_name in ["train", "val"]:
        split_rows = [row for row in rows if row["fixed_training_split"] == split_name]
        write_jsonl(output_root / "annotations" / f"{split_name}.jsonl", split_rows)
        write_yolo_split(output_root / "yolo", split_name, split_rows, image_mode=image_mode)
        write_coco(output_root / "coco" / f"{split_name}.json", split_name, split_rows, class_mode=class_mode)

    data_yaml = "\n".join(
        [
            f"path: {(output_root / 'yolo').resolve().as_posix()}",
            "train: images/train",
            "val: images/val",
            "test: images/val",
            "names:",
            *[f"  {index}: {name}" for index, name in enumerate(class_names_for(class_mode))],
            "",
        ]
    )
    (output_root / "yolo" / "data.yaml").write_text(data_yaml, encoding="utf-8")
    (output_root / "yolo" / "classes.txt").write_text("\n".join(class_names_for(class_mode)) + "\n", encoding="utf-8")


def write_yolo_split(yolo_root: Path, split_name: str, rows: list[dict[str, Any]], *, image_mode: str) -> None:
    image_dir = yolo_root / "images" / split_name
    label_dir = yolo_root / "labels" / split_name
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    for row in rows:
        source = Path(row["image_path"])
        target_stem = f"tn5000_{row['image_id']}"
        if image_mode != "none":
            target = image_dir / f"{target_stem}{source.suffix.lower()}"
            link_or_copy(source.resolve(), target, copy_file=image_mode == "copy")
        label_lines = [
            yolo_line(bbox, row["width"], row["height"], class_id=class_id)
            for bbox, class_id in zip(row["bboxes_xyxy"], row["yolo_class_ids"], strict=True)
        ]
        (label_dir / f"{target_stem}.txt").write_text("".join(label_lines), encoding="utf-8")


def write_coco(path: Path, split_name: str, rows: list[dict[str, Any]], *, class_mode: str) -> None:
    images = []
    annotations = []
    annotation_id = 1
    for image_index, row in enumerate(rows, start=1):
        images.append(
            {
                "id": image_index,
                "file_name": Path(row["image_path"]).name,
                "width": row["width"],
                "height": row["height"],
                "tn5000_image_id": row["image_id"],
                "split": split_name,
                "classification_label": row["classification_label"],
                "source_image_ids": row["source_image_ids"],
            }
        )
        for bbox, class_id in zip(row["bboxes_xyxy"], row["yolo_class_ids"], strict=True):
            xywh = bbox_xywh(bbox)
            annotations.append(
                {
                    "id": annotation_id,
                    "image_id": image_index,
                    "category_id": class_id,
                    "bbox": xywh,
                    "area": xywh[2] * xywh[3],
                    "iscrowd": 0,
                }
            )
            annotation_id += 1
    write_json(
        path,
        {
            "images": images,
            "annotations": annotations,
            "categories": [
                {"id": index, "name": name, "supercategory": "thyroid"}
                for index, name in enumerate(class_names_for(class_mode))
            ],
        },
    )


def build_summary(
    *,
    dataset_root: Path,
    output_root: Path,
    rows: list[dict[str, Any]],
    raw_summary: dict[str, Any],
    merge_summary: dict[str, Any],
    train_ratio: float,
    seed: int,
    image_mode: str,
    class_mode: str,
) -> dict[str, Any]:
    split_counts = {}
    for split_name in ["train", "val"]:
        split_rows = [row for row in rows if row["fixed_training_split"] == split_name]
        split_counts[split_name] = {
            "images": len(split_rows),
            "boxes": sum(row["object_count"] for row in split_rows),
            "classification_labels": dict(sorted(Counter(str(row["classification_label"]) for row in split_rows).items())),
        }
    return {
        "schema_version": "tn5000.voc_to_detection_clean.v1",
        "dataset_id": "tn5000_detection_clean",
        "dataset_root": str(dataset_root),
        "output_root": str(output_root),
        "train_ratio": train_ratio,
        "seed": seed,
        "image_mode": image_mode,
        "class_mode": class_mode,
        "class_names": class_names_for(class_mode),
        "raw": raw_summary,
        "merge": merge_summary,
        "total": {
            "images": len(rows),
            "boxes": sum(row["object_count"] for row in rows),
            "classification_labels": dict(sorted(Counter(str(row["classification_label"]) for row in rows).items())),
            "images_with_multiple_boxes": sum(1 for row in rows if row["object_count"] > 1),
        },
        "splits": split_counts,
        "outputs": {
            "manifest_jsonl": str(output_root / "annotations" / "manifest.jsonl"),
            "train_manifest_jsonl": str(output_root / "annotations" / "train.jsonl"),
            "val_manifest_jsonl": str(output_root / "annotations" / "val.jsonl"),
            "yolo_data_yaml": str(output_root / "yolo" / "data.yaml"),
            "coco_train": str(output_root / "coco" / "train.json"),
            "coco_val": str(output_root / "coco" / "val.json"),
        },
    }


def render_markdown(summary: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# TN5000 Clean Detection Dataset",
            "",
            f"- Class mode: `{summary['class_mode']}`",
            f"- Class names: `{', '.join(summary['class_names'])}`",
            f"- Images: `{summary['total']['images']}`",
            f"- Boxes: `{summary['total']['boxes']}`",
            f"- Images with multiple boxes: `{summary['total']['images_with_multiple_boxes']}`",
            f"- Train images/boxes: `{summary['splits']['train']['images']}` / `{summary['splits']['train']['boxes']}`",
            f"- Val images/boxes: `{summary['splits']['val']['images']}` / `{summary['splits']['val']['boxes']}`",
            f"- Skipped dimension mismatch: `{summary['raw']['skipped']['dimension_mismatch']['count']}`",
            f"- Skipped invalid/out-of-bounds bbox: `{summary['raw']['skipped']['invalid_or_out_of_bounds_box']['count']}`",
            f"- Merged duplicate hash groups: `{summary['merge']['merged_duplicate_hash_groups']}`",
            "",
        ]
    )


def valid_bbox(bbox: list[int], width: int, height: int) -> bool:
    left, top, right, bottom = bbox
    return right > left and bottom > top and left >= 0 and top >= 0 and right <= width and bottom <= height


def bbox_xywh(bbox: list[int]) -> list[int]:
    left, top, right, bottom = bbox
    return [left, top, right - left, bottom - top]


def yolo_line(bbox: list[int], width: int, height: int, *, class_id: int) -> str:
    left, top, box_width, box_height = bbox_xywh(bbox)
    x_center = (left + box_width / 2) / width
    y_center = (top + box_height / 2) / height
    return f"{class_id} {x_center:.6f} {y_center:.6f} {box_width / width:.6f} {box_height / height:.6f}\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def replace_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def link_or_copy(source: Path, target: Path, *, copy_file: bool) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        target.unlink()
    if copy_file:
        shutil.copy2(source, target)
        return
    try:
        target.symlink_to(source)
    except OSError:
        shutil.copy2(source, target)


if __name__ == "__main__":
    raise SystemExit(main())
