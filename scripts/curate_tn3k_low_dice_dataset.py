#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
from collections import Counter
from pathlib import Path
from typing import Any


LABEL_OR_TASK_REVIEW_CATEGORIES = {"multi_region_gt_partial", "location_shift"}
MODEL_HARD_CATEGORIES = {"boundary_or_shape_mismatch", "oversegmentation", "undersegmentation"}
BORDERLINE_CATEGORIES = {"moderate_boundary_error"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Curate TN3K holdout cases from low-Dice audit results.")
    parser.add_argument("--dataset-root", required=True, help="nnU-Net raw Dataset503 root containing imagesTs/labelsTs.")
    parser.add_argument("--prediction-dir", required=True, help="Prediction folder containing case_id.png predictions.")
    parser.add_argument("--audit-csv", required=True, help="Low-Dice audit CSV. Cases not present are treated as high confidence.")
    parser.add_argument("--summary-json", help="Optional full nnU-Net summary.json to fill Dice/IoU for all holdout cases.")
    parser.add_argument("--output-dir", required=True, help="Output curation directory.")
    parser.add_argument("--manual-review-dice", type=float, default=0.80)
    parser.add_argument("--copy", action="store_true", help="Copy files instead of creating symlinks.")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    summary = curate_dataset(
        dataset_root=Path(args.dataset_root),
        prediction_dir=Path(args.prediction_dir),
        audit_csv=Path(args.audit_csv),
        summary_json=Path(args.summary_json) if args.summary_json else None,
        output_dir=Path(args.output_dir),
        manual_review_dice=args.manual_review_dice,
        use_symlinks=not args.copy,
        overwrite=args.overwrite,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def curate_dataset(
    *,
    dataset_root: Path,
    prediction_dir: Path,
    audit_csv: Path,
    summary_json: Path | None,
    output_dir: Path,
    manual_review_dice: float,
    use_symlinks: bool,
    overwrite: bool,
) -> dict[str, Any]:
    images_dir = dataset_root / "imagesTs"
    labels_dir = dataset_root / "labelsTs"
    if not images_dir.is_dir():
        raise SystemExit(f"imagesTs not found: {images_dir}")
    if not labels_dir.is_dir():
        raise SystemExit(f"labelsTs not found: {labels_dir}")
    if not prediction_dir.is_dir():
        raise SystemExit(f"prediction dir not found: {prediction_dir}")
    if not audit_csv.is_file():
        raise SystemExit(f"audit CSV not found: {audit_csv}")
    if summary_json is not None and not summary_json.is_file():
        raise SystemExit(f"summary JSON not found: {summary_json}")
    if output_dir.exists():
        if not overwrite:
            raise SystemExit(f"{output_dir} already exists; pass --overwrite to replace")
        shutil.rmtree(output_dir)

    audit_by_case = read_audit_csv(audit_csv)
    metrics_by_case = read_summary_metrics(summary_json) if summary_json is not None else {}
    case_ids = discover_case_ids(images_dir)
    rows = []
    for case_id in case_ids:
        audit = audit_by_case.get(case_id, {})
        full_metrics = metrics_by_case.get(case_id, {})
        dice = parse_float(audit.get("dice"))
        if dice is None:
            dice = parse_float(full_metrics.get("dice"))
        iou = parse_float(audit.get("iou"))
        if iou is None:
            iou = parse_float(full_metrics.get("iou"))
        category = audit.get("category") or "clean_high_confidence"
        primary_group = classify_group(category)
        review_priority = review_priority_for(dice, primary_group, manual_review_dice)
        flags = flags_for(dice, category, primary_group, manual_review_dice)
        row = {
            "case_id": case_id,
            "dice": dice,
            "iou": iou,
            "category": category,
            "primary_group": primary_group,
            "review_priority": review_priority,
            "flags": ";".join(flags),
            "image_path": str(images_dir / f"{case_id}_0000.png"),
            "label_path": str(labels_dir / f"{case_id}.png"),
            "prediction_path": str(prediction_dir / f"{case_id}.png"),
        }
        rows.append(row)

    output_dir.mkdir(parents=True, exist_ok=True)
    write_manifest_csv(output_dir / "curation_manifest.csv", rows)
    (output_dir / "curation_manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    write_manual_review_queue(output_dir / "manual_review_queue.csv", rows)

    subsets = build_subsets(rows)
    for subset_name, subset_rows in subsets.items():
        write_subset(output_dir / "subsets" / subset_name, subset_rows, use_symlinks=use_symlinks)
        (output_dir / "subsets" / subset_name / "cases.txt").write_text(
            "\n".join(row["case_id"] for row in subset_rows) + ("\n" if subset_rows else ""),
            encoding="utf-8",
        )
        write_manifest_csv(output_dir / "subsets" / subset_name / "manifest.csv", subset_rows)

    summary = {
        "dataset_root": str(dataset_root),
        "prediction_dir": str(prediction_dir),
        "audit_csv": str(audit_csv),
        "summary_json": str(summary_json) if summary_json is not None else None,
        "output_dir": str(output_dir),
        "total_cases": len(rows),
        "manual_review_dice": manual_review_dice,
        "group_counts": dict(Counter(row["primary_group"] for row in rows)),
        "review_priority_counts": dict(Counter(row["review_priority"] for row in rows)),
        "subset_counts": {name: len(items) for name, items in subsets.items()},
        "use_symlinks": use_symlinks,
    }
    (output_dir / "curation_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def read_audit_csv(path: Path) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["case_id"]: row for row in csv.DictReader(handle)}


def read_summary_metrics(path: Path) -> dict[str, dict[str, float]]:
    data = json.loads(path.read_text())
    metrics_by_case = {}
    for item in data.get("metric_per_case", []):
        pred_file = Path(item.get("prediction_file", ""))
        ref_file = Path(item.get("reference_file", ""))
        name = pred_file.name or ref_file.name
        if not name:
            continue
        case_id = Path(name).stem
        values = item.get("metrics", {}).get("1", {})
        metrics_by_case[case_id] = {
            "dice": float(values["Dice"]) if "Dice" in values else None,
            "iou": float(values["IoU"]) if "IoU" in values else None,
        }
    return metrics_by_case


def discover_case_ids(images_dir: Path) -> list[str]:
    case_ids = []
    for image in sorted(images_dir.glob("*_0000.png")):
        case_ids.append(image.name.removesuffix("_0000.png"))
    return case_ids


def parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def classify_group(category: str) -> str:
    if category in LABEL_OR_TASK_REVIEW_CATEGORIES:
        return "label_or_task_review"
    if category in MODEL_HARD_CATEGORIES:
        return "model_hard"
    if category in BORDERLINE_CATEGORIES:
        return "borderline_boundary"
    return "clean_high_confidence"


def review_priority_for(dice: float | None, primary_group: str, manual_review_dice: float) -> str:
    if primary_group == "label_or_task_review":
        return "high"
    if dice is not None and dice < manual_review_dice:
        return "high"
    if primary_group in {"model_hard", "borderline_boundary"}:
        return "medium"
    return "low"


def flags_for(dice: float | None, category: str, primary_group: str, manual_review_dice: float) -> list[str]:
    flags = []
    if dice is not None and dice < manual_review_dice:
        flags.append("low_dice_below_threshold")
    if primary_group == "label_or_task_review":
        flags.append("requires_label_or_task_review")
    if primary_group == "model_hard":
        flags.append("candidate_for_hard_case_training")
    if primary_group == "borderline_boundary":
        flags.append("candidate_for_boundary_review")
    if category == "clean_high_confidence":
        flags.append("clean_high_confidence")
    return flags


def build_subsets(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    subsets = {
        "clean_high_confidence": [row for row in rows if row["primary_group"] == "clean_high_confidence"],
        "clean_label_candidate": [row for row in rows if row["primary_group"] != "label_or_task_review"],
        "manual_review_required": [row for row in rows if row["review_priority"] == "high"],
        "label_or_task_review": [row for row in rows if row["primary_group"] == "label_or_task_review"],
        "model_hard_cases": [row for row in rows if row["primary_group"] == "model_hard"],
        "borderline_boundary": [row for row in rows if row["primary_group"] == "borderline_boundary"],
        "low_dice_below_080": [row for row in rows if row["dice"] is not None and row["dice"] < 0.80],
    }
    return subsets


def write_manifest_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "case_id",
        "dice",
        "iou",
        "category",
        "primary_group",
        "review_priority",
        "flags",
        "image_path",
        "label_path",
        "prediction_path",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_manual_review_queue(path: Path, rows: list[dict[str, Any]]) -> None:
    review_rows = sorted(
        [row for row in rows if row["review_priority"] == "high"],
        key=lambda row: (row["dice"] is None, row["dice"] if row["dice"] is not None else 1.0, row["case_id"]),
    )
    fieldnames = [
        "case_id",
        "dice",
        "iou",
        "category",
        "primary_group",
        "suggested_action",
        "review_decision",
        "corrected_mask_path",
        "reviewer",
        "reviewed_at",
        "notes",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in review_rows:
            writer.writerow(
                {
                    "case_id": row["case_id"],
                    "dice": row["dice"],
                    "iou": row["iou"],
                    "category": row["category"],
                    "primary_group": row["primary_group"],
                    "suggested_action": suggested_review_action(row),
                    "review_decision": "",
                    "corrected_mask_path": "",
                    "reviewer": "",
                    "reviewed_at": "",
                    "notes": "",
                }
            )


def suggested_review_action(row: dict[str, Any]) -> str:
    if row["primary_group"] == "label_or_task_review":
        return "verify_image_label_alignment_and_task_definition"
    if row["primary_group"] == "model_hard":
        return "verify_label_then_mark_hard_case_or_correct_mask"
    return "manual_review_required"


def write_subset(subset_dir: Path, rows: list[dict[str, Any]], *, use_symlinks: bool) -> None:
    for name in ("imagesTs", "labelsTs", "predictions"):
        (subset_dir / name).mkdir(parents=True, exist_ok=True)
    for row in rows:
        link_or_copy(Path(row["image_path"]), subset_dir / "imagesTs" / f"{row['case_id']}_0000.png", use_symlinks=use_symlinks)
        link_or_copy(Path(row["label_path"]), subset_dir / "labelsTs" / f"{row['case_id']}.png", use_symlinks=use_symlinks)
        prediction = Path(row["prediction_path"])
        if prediction.exists():
            link_or_copy(prediction, subset_dir / "predictions" / f"{row['case_id']}.png", use_symlinks=use_symlinks)


def link_or_copy(src: Path, dst: Path, *, use_symlinks: bool) -> None:
    if not src.exists():
        raise SystemExit(f"source file not found: {src}")
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    if use_symlinks:
        os.symlink(src.resolve(), dst)
    else:
        shutil.copy2(src, dst)


if __name__ == "__main__":
    raise SystemExit(main())
