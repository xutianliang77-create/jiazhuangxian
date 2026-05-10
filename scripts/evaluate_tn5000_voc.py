from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - real CLI environment only.
    raise SystemExit("Pillow is required. Install it with: pip install Pillow") from exc


DEFAULT_DATASET_ROOT = Path(
    "data/artifacts/datasets/tn5000/raw/extracted/TN5000_forReview/TN5000_forReview"
)
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/datasets/tn5000/derived/evaluation")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLIT_NAMES = ("train", "val", "test", "trainval")


@dataclass
class BoxRecord:
    image_id: str
    split: str
    class_name: str
    bbox_xyxy: list[int]
    bbox_xywh: list[int]
    area_ratio: float
    width_ratio: float
    height_ratio: float
    aspect_ratio: float


@dataclass
class ImageRecord:
    image_id: str
    split: str
    image_path: str
    annotation_path: str
    width: int
    height: int
    depth: int | None
    image_mode: str
    image_format: str | None
    sha256: str
    object_count: int


@dataclass
class IssueStore:
    invalid_xml: list[str] = field(default_factory=list)
    missing_images: list[str] = field(default_factory=list)
    missing_annotations: list[str] = field(default_factory=list)
    image_open_errors: list[str] = field(default_factory=list)
    dimension_mismatches: list[str] = field(default_factory=list)
    invalid_boxes: list[str] = field(default_factory=list)
    out_of_bounds_boxes: list[str] = field(default_factory=list)
    empty_annotations: list[str] = field(default_factory=list)
    split_missing_images: list[str] = field(default_factory=list)
    split_missing_annotations: list[str] = field(default_factory=list)
    train_val_test_overlap: dict[str, list[str]] = field(default_factory=dict)
    duplicate_hash_groups: list[dict[str, Any]] = field(default_factory=list)
    duplicate_hash_cross_split_groups: list[dict[str, Any]] = field(default_factory=list)
    duplicate_hash_group_count: int = 0
    duplicate_hash_image_count: int = 0
    duplicate_hash_cross_split_group_count: int = 0
    duplicate_hash_cross_split_image_count: int = 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate the official TN5000 VOC detection archive.")
    parser.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--sample-limit", type=int, default=10, help="Maximum examples to keep per issue type.")
    parser.add_argument("--skip-image-hash", action="store_true", help="Skip exact duplicate image hash checks.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    summary = evaluate_dataset(
        dataset_root=args.dataset_root,
        output_root=args.output_root,
        sample_limit=args.sample_limit,
        skip_image_hash=args.skip_image_hash,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def evaluate_dataset(
    *,
    dataset_root: Path,
    output_root: Path,
    sample_limit: int = 10,
    skip_image_hash: bool = False,
) -> dict[str, Any]:
    images_dir = dataset_root / "JPEGImages"
    annotations_dir = dataset_root / "Annotations"
    splits_dir = dataset_root / "ImageSets" / "Main"
    if not images_dir.exists():
        raise FileNotFoundError(f"JPEGImages directory not found: {images_dir}")
    if not annotations_dir.exists():
        raise FileNotFoundError(f"Annotations directory not found: {annotations_dir}")
    if not splits_dir.exists():
        raise FileNotFoundError(f"ImageSets/Main directory not found: {splits_dir}")

    image_paths = collect_images(images_dir)
    annotation_paths = {path.stem: path for path in annotations_dir.glob("*.xml")}
    split_ids = read_split_files(splits_dir)
    split_by_image = split_membership(split_ids)
    issues = IssueStore()

    record_by_id: dict[str, ImageRecord] = {}
    box_records: list[BoxRecord] = []
    hash_groups: dict[str, list[str]] = defaultdict(list)

    for image_id, image_path in image_paths.items():
        annotation_path = annotation_paths.get(image_id)
        if annotation_path is None:
            push_limited(issues.missing_annotations, image_id, sample_limit)
            continue
        try:
            image_info = read_image_info(image_path, skip_hash=skip_image_hash)
        except Exception as exc:  # pragma: no cover - error path tested through summary behavior.
            push_limited(issues.image_open_errors, f"{image_id}: {exc}", sample_limit)
            continue
        try:
            annotation = parse_voc_annotation(annotation_path)
        except (ET.ParseError, ValueError) as exc:
            push_limited(issues.invalid_xml, f"{image_id}: {exc}", sample_limit)
            continue

        xml_width = annotation["width"]
        xml_height = annotation["height"]
        xml_depth = annotation["depth"]
        if xml_width != image_info["width"] or xml_height != image_info["height"]:
            push_limited(
                issues.dimension_mismatches,
                f"{image_id}: xml={xml_width}x{xml_height}, image={image_info['width']}x{image_info['height']}",
                sample_limit,
            )

        split = split_by_image.get(image_id, "unknown")
        image_boxes = []
        for obj_index, obj in enumerate(annotation["objects"]):
            class_name = obj["name"]
            bbox = obj["bbox_xyxy"]
            problem = validate_bbox(bbox, xml_width, xml_height)
            if problem == "invalid":
                push_limited(issues.invalid_boxes, f"{image_id}#{obj_index}: {bbox}", sample_limit)
                continue
            if problem == "out_of_bounds":
                push_limited(issues.out_of_bounds_boxes, f"{image_id}#{obj_index}: {bbox}", sample_limit)
                continue
            left, top, right, bottom = bbox
            box_width = right - left
            box_height = bottom - top
            area_ratio = (box_width * box_height) / (xml_width * xml_height)
            image_boxes.append(
                BoxRecord(
                    image_id=image_id,
                    split=split,
                    class_name=class_name,
                    bbox_xyxy=bbox,
                    bbox_xywh=[left, top, box_width, box_height],
                    area_ratio=area_ratio,
                    width_ratio=box_width / xml_width,
                    height_ratio=box_height / xml_height,
                    aspect_ratio=box_width / box_height if box_height else 0,
                )
            )

        if not image_boxes:
            push_limited(issues.empty_annotations, image_id, sample_limit)
        box_records.extend(image_boxes)
        record_by_id[image_id] = ImageRecord(
            image_id=image_id,
            split=split,
            image_path=str(image_path),
            annotation_path=str(annotation_path),
            width=image_info["width"],
            height=image_info["height"],
            depth=xml_depth,
            image_mode=image_info["mode"],
            image_format=image_info["format"],
            sha256=image_info["sha256"],
            object_count=len(image_boxes),
        )
        if image_info["sha256"]:
            hash_groups[image_info["sha256"]].append(image_id)

    for image_id in sorted(set(annotation_paths) - set(image_paths)):
        push_limited(issues.missing_images, image_id, sample_limit)

    for split_name, ids in split_ids.items():
        for image_id in sorted(ids):
            if image_id not in image_paths:
                push_limited(issues.split_missing_images, f"{split_name}:{image_id}", sample_limit)
            if image_id not in annotation_paths:
                push_limited(issues.split_missing_annotations, f"{split_name}:{image_id}", sample_limit)

    issues.train_val_test_overlap = split_overlaps(split_ids, ["train", "val", "test"], sample_limit)
    if not skip_image_hash:
        duplicate_groups = duplicate_hash_summary(hash_groups, record_by_id, sample_limit)
        issues.duplicate_hash_groups = duplicate_groups["all_samples"]
        issues.duplicate_hash_cross_split_groups = duplicate_groups["cross_split_samples"]
        issues.duplicate_hash_group_count = duplicate_groups["all_group_count"]
        issues.duplicate_hash_image_count = duplicate_groups["all_image_count"]
        issues.duplicate_hash_cross_split_group_count = duplicate_groups["cross_split_group_count"]
        issues.duplicate_hash_cross_split_image_count = duplicate_groups["cross_split_image_count"]

    summary = build_summary(
        dataset_root=dataset_root,
        image_paths=image_paths,
        annotation_paths=annotation_paths,
        split_ids=split_ids,
        records=list(record_by_id.values()),
        boxes=box_records,
        issues=issues,
    )
    output_root.mkdir(parents=True, exist_ok=True)
    write_json(output_root / "summary.json", summary)
    (output_root / "evaluation.md").write_text(render_markdown(summary), encoding="utf-8")
    return summary


def collect_images(images_dir: Path) -> dict[str, Path]:
    paths = {}
    for path in sorted(images_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            paths[path.stem] = path
    return paths


def read_split_files(splits_dir: Path) -> dict[str, set[str]]:
    split_ids = {}
    for split_name in SPLIT_NAMES:
        path = splits_dir / f"{split_name}.txt"
        if path.exists():
            split_ids[split_name] = {
                line.strip().split()[0]
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            }
    return split_ids


def split_membership(split_ids: dict[str, set[str]]) -> dict[str, str]:
    mapping = {}
    for split in ["train", "val", "test"]:
        for image_id in split_ids.get(split, set()):
            mapping[image_id] = split
    return mapping


def read_image_info(image_path: Path, *, skip_hash: bool) -> dict[str, Any]:
    with Image.open(image_path) as image:
        width, height = image.size
        mode = image.mode
        image_format = image.format
        image.verify()
    return {
        "width": width,
        "height": height,
        "mode": mode,
        "format": image_format,
        "sha256": "" if skip_hash else sha256_file(image_path),
    }


def parse_voc_annotation(path: Path) -> dict[str, Any]:
    root = ET.parse(path).getroot()
    size = root.find("size")
    if size is None:
        raise ValueError(f"missing size in {path}")
    width = int(size.findtext("width", "0"))
    height = int(size.findtext("height", "0"))
    depth_text = size.findtext("depth")
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
        "width": width,
        "height": height,
        "depth": int(depth_text) if depth_text and depth_text.isdigit() else None,
        "objects": objects,
    }


def validate_bbox(bbox: list[int], width: int, height: int) -> str:
    left, top, right, bottom = bbox
    if right <= left or bottom <= top:
        return "invalid"
    if left < 0 or top < 0 or right > width or bottom > height:
        return "out_of_bounds"
    return "ok"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_overlaps(split_ids: dict[str, set[str]], split_names: list[str], sample_limit: int) -> dict[str, list[str]]:
    overlaps = {}
    for index, left_name in enumerate(split_names):
        for right_name in split_names[index + 1 :]:
            values = sorted(split_ids.get(left_name, set()) & split_ids.get(right_name, set()))
            if values:
                overlaps[f"{left_name}_and_{right_name}"] = values[:sample_limit]
    return overlaps


def duplicate_hash_summary(
    hash_groups: dict[str, list[str]],
    records: dict[str, ImageRecord],
    sample_limit: int,
) -> dict[str, Any]:
    all_groups = []
    cross_split_groups = []
    for digest, image_ids in hash_groups.items():
        if len(image_ids) < 2:
            continue
        group = {
            "sha256": digest,
            "count": len(image_ids),
            "image_ids": sorted(image_ids)[:sample_limit],
            "splits": sorted({records[image_id].split for image_id in image_ids if image_id in records}),
        }
        all_groups.append(group)
        if len(group["splits"]) > 1:
            cross_split_groups.append(group)
    sorted_all = sorted(all_groups, key=lambda item: (-item["count"], item["sha256"]))
    sorted_cross_split = sorted(cross_split_groups, key=lambda item: (-item["count"], item["sha256"]))
    return {
        "all_samples": sorted_all[:sample_limit],
        "cross_split_samples": sorted_cross_split[:sample_limit],
        "all_group_count": len(sorted_all),
        "all_image_count": sum(group["count"] for group in sorted_all),
        "cross_split_group_count": len(sorted_cross_split),
        "cross_split_image_count": sum(group["count"] for group in sorted_cross_split),
    }


def build_summary(
    *,
    dataset_root: Path,
    image_paths: dict[str, Path],
    annotation_paths: dict[str, Path],
    split_ids: dict[str, set[str]],
    records: list[ImageRecord],
    boxes: list[BoxRecord],
    issues: IssueStore,
) -> dict[str, Any]:
    split_counts = {name: len(ids) for name, ids in sorted(split_ids.items())}
    official_eval_ids = set().union(*(split_ids.get(name, set()) for name in ["train", "val", "test"]))
    trainval_consistent = split_ids.get("trainval", set()) == (
        split_ids.get("train", set()) | split_ids.get("val", set())
    )
    issue_counts = issue_count_dict(issues)
    critical_issues = sum(
        issue_counts[name]
        for name in [
            "invalid_xml",
            "missing_images",
            "missing_annotations",
            "image_open_errors",
            "dimension_mismatches",
            "invalid_boxes",
            "out_of_bounds_boxes",
            "empty_annotations",
            "split_missing_images",
            "split_missing_annotations",
            "train_val_test_overlap",
            "duplicate_hash_cross_split_group_count",
        ]
    )
    image_dimensions = Counter((record.width, record.height) for record in records)
    summary = {
        "schema_version": "tn5000.voc_dataset_evaluation.v1",
        "dataset_id": "tn5000_detection_official_figshare",
        "dataset_root": str(dataset_root),
        "verdict": {
            "strict_detector_usable": critical_issues == 0,
            "recommendation": recommendation(critical_issues, trainval_consistent),
            "critical_issue_count": critical_issues,
        },
        "file_counts": {
            "images": len(image_paths),
            "annotations_xml": len(annotation_paths),
            "evaluated_images": len(records),
            "boxes": len(boxes),
        },
        "split_counts": split_counts,
        "split_integrity": {
            "train_val_test_total": len(official_eval_ids),
            "train_val_test_covers_all_images": official_eval_ids == set(image_paths),
            "trainval_equals_train_plus_val": trainval_consistent,
            "overlaps": issues.train_val_test_overlap,
        },
        "image_profile": {
            "mode_counts": dict(sorted(Counter(record.image_mode for record in records).items())),
            "format_counts": dict(sorted(Counter(str(record.image_format) for record in records).items())),
            "depth_counts": dict(sorted(Counter(str(record.depth) for record in records).items())),
            "dimensions": {
                "unique_count": len(image_dimensions),
                "top_10": [
                    {"width": width, "height": height, "count": count}
                    for (width, height), count in image_dimensions.most_common(10)
                ],
                "width": describe([record.width for record in records]),
                "height": describe([record.height for record in records]),
            },
        },
        "annotation_profile": annotation_profile(records, boxes),
        "label_mapping": label_mapping(boxes),
        "split_profiles": split_profiles(records, boxes),
        "issues": {
            "counts": issue_counts,
            "samples": asdict(issues),
        },
        "training_readiness": training_readiness_summary(critical_issues, boxes, split_counts),
    }
    return summary


def issue_count_dict(issues: IssueStore) -> dict[str, int]:
    payload = asdict(issues)
    counts = {}
    for key, value in payload.items():
        if isinstance(value, list):
            counts[key] = len(value)
        elif isinstance(value, dict):
            counts[key] = sum(len(items) for items in value.values())
        elif isinstance(value, int):
            counts[key] = value
        else:
            counts[key] = 0
    return counts


def annotation_profile(records: list[ImageRecord], boxes: list[BoxRecord]) -> dict[str, Any]:
    object_counts = Counter(record.object_count for record in records)
    return {
        "images_by_object_count": {str(key): value for key, value in sorted(object_counts.items())},
        "class_counts": dict(sorted(Counter(box.class_name for box in boxes).items())),
        "boxes_per_image": describe([record.object_count for record in records]),
        "bbox_width_px": describe([box.bbox_xywh[2] for box in boxes]),
        "bbox_height_px": describe([box.bbox_xywh[3] for box in boxes]),
        "bbox_area_ratio": describe([box.area_ratio for box in boxes]),
        "bbox_width_ratio": describe([box.width_ratio for box in boxes]),
        "bbox_height_ratio": describe([box.height_ratio for box in boxes]),
        "bbox_aspect_ratio": describe([box.aspect_ratio for box in boxes]),
        "small_box_counts": {
            "area_ratio_lt_0_01": sum(1 for box in boxes if box.area_ratio < 0.01),
            "area_ratio_lt_0_02": sum(1 for box in boxes if box.area_ratio < 0.02),
            "min_side_lt_16_px": sum(1 for box in boxes if min(box.bbox_xywh[2], box.bbox_xywh[3]) < 16),
        },
    }


def label_mapping(boxes: list[BoxRecord]) -> dict[str, str]:
    class_names = {box.class_name for box in boxes}
    if class_names == {"0", "1"}:
        return {
            "0": "benign_thyroid_nodule",
            "1": "malignant_thyroid_nodule",
            "source": "TN5000 benchmark code uses classes ('0', '1'); mapping follows TN5000 paper benign/malignant binary diagnosis convention.",
        }
    return {}


def split_profiles(records: list[ImageRecord], boxes: list[BoxRecord]) -> dict[str, Any]:
    records_by_split: dict[str, list[ImageRecord]] = defaultdict(list)
    boxes_by_split: dict[str, list[BoxRecord]] = defaultdict(list)
    for record in records:
        records_by_split[record.split].append(record)
    for box in boxes:
        boxes_by_split[box.split].append(box)
    profiles = {}
    for split in sorted(records_by_split):
        split_records = records_by_split[split]
        split_boxes = boxes_by_split.get(split, [])
        profiles[split] = {
            "images": len(split_records),
            "boxes": len(split_boxes),
            "class_counts": dict(sorted(Counter(box.class_name for box in split_boxes).items())),
            "object_count": describe([record.object_count for record in split_records]),
            "bbox_area_ratio": describe([box.area_ratio for box in split_boxes]),
            "width": describe([record.width for record in split_records]),
            "height": describe([record.height for record in split_records]),
        }
    return profiles


def training_readiness_summary(critical_issues: int, boxes: list[BoxRecord], split_counts: dict[str, int]) -> list[str]:
    notes = []
    if critical_issues == 0:
        notes.append("可作为严格检测训练数据：图片、VOC XML、bbox 与官方 split 均通过一致性检查。")
    else:
        notes.append("存在关键质量问题，进入训练前应先修复或剔除问题样本。")
    if split_counts.get("train") == 3500 and split_counts.get("val") == 500 and split_counts.get("test") == 1000:
        notes.append("建议优先保留官方 train/val/test，不再随机 80/20 切分 TN5000。")
    class_names = {box.class_name for box in boxes}
    if class_names == {"0", "1"}:
        notes.append("XML <object><name> 是诊断类别标签：0=良性结节，1=恶性结节；可训练二分类检测器，也可在转换时折叠为单类结节定位。")
    elif class_names == {"0"}:
        notes.append("XML 类别字段只有 0，当前数据可按单类结节定位处理；良恶性/TI-RADS 需另接分类特征数据或人工标签。")
    notes.append("可与 TN3K mask-derived bbox 合并，但训练/验证必须标记 dataset_id 与 source_split，便于按数据源分层评估。")
    return notes


def recommendation(critical_issues: int, trainval_consistent: bool) -> str:
    if critical_issues == 0 and trainval_consistent:
        return "accept_for_strict_detector_training"
    if critical_issues == 0:
        return "accept_for_training_but_review_split_metadata"
    return "hold_until_quality_issues_are_fixed"


def describe(values: list[int] | list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "min": None, "p25": None, "median": None, "p75": None, "max": None, "mean": None}
    ordered = sorted(float(value) for value in values)
    return {
        "count": len(ordered),
        "min": ordered[0],
        "p25": percentile(ordered, 0.25),
        "median": statistics.median(ordered),
        "p75": percentile(ordered, 0.75),
        "max": ordered[-1],
        "mean": statistics.fmean(ordered),
    }


def percentile(ordered_values: list[float], ratio: float) -> float:
    if len(ordered_values) == 1:
        return ordered_values[0]
    position = ratio * (len(ordered_values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered_values) - 1)
    fraction = position - lower
    return ordered_values[lower] * (1 - fraction) + ordered_values[upper] * fraction


def push_limited(values: list[str], value: str, limit: int) -> None:
    if len(values) < limit:
        values.append(value)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def render_markdown(summary: dict[str, Any]) -> str:
    verdict = summary["verdict"]
    file_counts = summary["file_counts"]
    annotation = summary["annotation_profile"]
    label_mapping_payload = summary.get("label_mapping", {})
    dimensions = summary["image_profile"]["dimensions"]
    split_counts = summary["split_counts"]
    issues = summary["issues"]["counts"]
    lines = [
        "# TN5000 Detection Archive Evaluation",
        "",
        "## Verdict",
        "",
        f"- Recommendation: `{verdict['recommendation']}`",
        f"- Strict detector usable: `{str(verdict['strict_detector_usable']).lower()}`",
        f"- Critical issue count: `{verdict['critical_issue_count']}`",
        "",
        "## File And Split Counts",
        "",
        f"- Images: `{file_counts['images']}`",
        f"- XML annotations: `{file_counts['annotations_xml']}`",
        f"- Evaluated images: `{file_counts['evaluated_images']}`",
        f"- Bboxes: `{file_counts['boxes']}`",
        f"- Splits: train `{split_counts.get('train', 0)}`, val `{split_counts.get('val', 0)}`, test `{split_counts.get('test', 0)}`, trainval `{split_counts.get('trainval', 0)}`",
        "",
        "## Image Profile",
        "",
        f"- Unique dimensions: `{dimensions['unique_count']}`",
        f"- Width median: `{fmt(dimensions['width']['median'])}`, range `{fmt(dimensions['width']['min'])}` to `{fmt(dimensions['width']['max'])}`",
        f"- Height median: `{fmt(dimensions['height']['median'])}`, range `{fmt(dimensions['height']['min'])}` to `{fmt(dimensions['height']['max'])}`",
        "",
        "## Annotation Profile",
        "",
        f"- Class counts: `{json.dumps(annotation['class_counts'], ensure_ascii=False)}`",
        f"- Label mapping: `{json.dumps(label_mapping_payload, ensure_ascii=False)}`",
        f"- Images by object count: `{json.dumps(annotation['images_by_object_count'], ensure_ascii=False)}`",
        f"- Bbox area ratio median: `{fmt(annotation['bbox_area_ratio']['median'])}`, p25 `{fmt(annotation['bbox_area_ratio']['p25'])}`, p75 `{fmt(annotation['bbox_area_ratio']['p75'])}`",
        f"- Small boxes area_ratio < 0.01: `{annotation['small_box_counts']['area_ratio_lt_0_01']}`",
        "",
        "## Quality Issues",
        "",
    ]
    for key, count in sorted(issues.items()):
        lines.append(f"- {key}: `{count}`")
    lines.extend(["", "## Training Readiness", ""])
    lines.extend(f"- {note}" for note in summary["training_readiness"])
    lines.append("")
    return "\n".join(lines)


def fmt(value: Any) -> str:
    if value is None:
        return "None"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


if __name__ == "__main__":
    raise SystemExit(main())
