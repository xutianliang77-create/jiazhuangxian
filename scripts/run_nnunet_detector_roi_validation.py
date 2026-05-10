#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare/evaluate nnU-Net detector-ROI validation cases.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare", help="Create nnU-Net input ROI crops from detector bboxes.")
    prepare_parser.add_argument("--case-metrics", required=True, help="SAM2 detector-prompt case_metrics.csv.")
    prepare_parser.add_argument("--output-dir", required=True, help="Output directory for nnU-Net ROI validation.")
    prepare_parser.add_argument("--output-size", type=int, default=384)
    prepare_parser.add_argument("--margin-ratio", type=float, default=0.15)
    prepare_parser.add_argument("--min-crop-size", type=int, default=80)

    eval_parser = subparsers.add_parser("evaluate", help="Evaluate nnU-Net ROI predictions against full-size masks.")
    eval_parser.add_argument("--manifest", required=True)
    eval_parser.add_argument("--pred-dir", required=True)
    eval_parser.add_argument("--output-dir", required=True)

    args = parser.parse_args()
    if args.command == "prepare":
        summary = prepare_inputs(
            case_metrics=Path(args.case_metrics),
            output_dir=Path(args.output_dir),
            output_size=args.output_size,
            margin_ratio=args.margin_ratio,
            min_crop_size=args.min_crop_size,
        )
    else:
        summary = evaluate_predictions(
            manifest_path=Path(args.manifest),
            pred_dir=Path(args.pred_dir),
            output_dir=Path(args.output_dir),
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary.get("failed", 0) == 0 else 2


def prepare_inputs(
    *,
    case_metrics: Path,
    output_dir: Path,
    output_size: int,
    margin_ratio: float,
    min_crop_size: int,
) -> dict[str, Any]:
    input_dir = output_dir / "images"
    label_dir = output_dir / "labels_roi"
    for path in (input_dir, label_dir):
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)

    manifest: list[dict[str, Any]] = []
    with case_metrics.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            image_id = row["image_id"]
            if not row.get("detector_bbox"):
                manifest.append({"image_id": image_id, "status": row.get("status") or "skipped", "error": "missing_detector_bbox"})
                continue
            image_path = Path(row["image_path"])
            mask_path = Path(row["mask_path"])
            detector_bbox = parse_float_list(row["detector_bbox"])
            with Image.open(image_path) as image, Image.open(mask_path) as mask:
                image = image.convert("L")
                mask = mask.convert("L")
                if mask.size != image.size:
                    mask = mask.resize(image.size, Image.Resampling.NEAREST)
                crop_box = expanded_crop_box(detector_bbox, image.size, margin_ratio=margin_ratio, min_crop_size=min_crop_size)
                case_id = f"tn3k_test_{image_id}"
                roi_image_path = input_dir / f"{case_id}_0000.png"
                roi_label_path = label_dir / f"{case_id}.png"
                image.crop(crop_box).resize((output_size, output_size), Image.Resampling.BILINEAR).save(roi_image_path)
                binary = mask.crop(crop_box).resize((output_size, output_size), Image.Resampling.NEAREST)
                binary.point(lambda value: 1 if value > 0 else 0).save(roi_label_path)
            manifest.append(
                {
                    "case_id": case_id,
                    "image_id": image_id,
                    "status": "prepared",
                    "source_status": row.get("status"),
                    "source_dice": parse_optional_float(row.get("dice")),
                    "source_iou": parse_optional_float(row.get("iou")),
                    "image_path": str(image_path),
                    "mask_path": str(mask_path),
                    "detector_bbox": detector_bbox,
                    "crop_box_xyxy": list(crop_box),
                    "roi_image": str(roi_image_path),
                    "roi_label": str(roi_label_path),
                }
            )

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    prepared = sum(1 for row in manifest if row.get("status") == "prepared")
    skipped = len(manifest) - prepared
    return {
        "schema_version": "thyroid.nnunet_detector_roi_prepare.v1",
        "total_cases": len(manifest),
        "prepared": prepared,
        "skipped": skipped,
        "input_dir": str(input_dir),
        "manifest": str(manifest_path),
        "output_size": output_size,
        "margin_ratio": margin_ratio,
        "min_crop_size": min_crop_size,
    }


def evaluate_predictions(*, manifest_path: Path, pred_dir: Path, output_dir: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    overlay_dir = output_dir / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for item in manifest:
        if item.get("status") != "prepared":
            rows.append({"image_id": item.get("image_id"), "status": item.get("status"), "error": item.get("error")})
            continue
        prediction_path = pred_dir / f"{item['case_id']}.png"
        if not prediction_path.exists():
            rows.append({"image_id": item["image_id"], "status": "prediction_missing", "error": str(prediction_path)})
            continue
        with Image.open(item["image_path"]) as image, Image.open(item["mask_path"]) as gt_mask, Image.open(prediction_path) as pred_roi:
            image = image.convert("RGB")
            gt = binary_array(gt_mask.resize(image.size, Image.Resampling.NEAREST))
            crop_box = tuple(int(value) for value in item["crop_box_xyxy"])
            crop_width = crop_box[2] - crop_box[0]
            crop_height = crop_box[3] - crop_box[1]
            pred_crop = pred_roi.convert("L").resize((crop_width, crop_height), Image.Resampling.NEAREST)
            pred_full = Image.new("L", image.size, 0)
            pred_full.paste(pred_crop.point(lambda value: 255 if value > 0 else 0), crop_box)
            pred = binary_array(pred_full)
            metrics = mask_metrics(pred, gt)
            overlay_path = overlay_dir / f"{item['image_id']}_overlay.png"
            write_overlay(image, pred, gt, crop_box, overlay_path)
        rows.append(
            {
                "image_id": item["image_id"],
                "case_id": item["case_id"],
                "status": "succeeded",
                "dice": round(metrics["dice"], 6),
                "iou": round(metrics["iou"], 6),
                "pred_area": metrics["pred_area"],
                "gt_area": metrics["gt_area"],
                "area_ratio": round(metrics["area_ratio"], 6) if metrics["area_ratio"] is not None else None,
                "source_sam2_dice": item.get("source_dice"),
                "source_sam2_iou": item.get("source_iou"),
                "crop_box_xyxy": json.dumps(item["crop_box_xyxy"]),
                "overlay_path": str(overlay_path),
            }
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / "case_metrics.csv", rows)
    summary = summarize(rows)
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_contact_sheet(output_dir / "contact_sheet.png", rows)
    write_report(output_dir / "NNUNET_DETECTOR_ROI_VALIDATION_REPORT.md", rows, summary, pred_dir)
    return summary


def parse_float_list(value: str) -> list[float]:
    return [float(item) for item in json.loads(value)]


def parse_optional_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def expanded_crop_box(
    bbox: list[float],
    image_size: tuple[int, int],
    *,
    margin_ratio: float,
    min_crop_size: int,
) -> tuple[int, int, int, int]:
    image_width, image_height = image_size
    left, top, right, bottom = bbox
    width = max(1.0, right - left)
    height = max(1.0, bottom - top)
    margin = int(round(max(width, height) * margin_ratio))
    side = int(math.ceil(max(width + 2 * margin, height + 2 * margin, float(min_crop_size))))
    side = min(side, max(image_width, image_height))
    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    crop_left = int(round(center_x - side / 2.0))
    crop_top = int(round(center_y - side / 2.0))
    crop_right = crop_left + side
    crop_bottom = crop_top + side
    if crop_left < 0:
        crop_right -= crop_left
        crop_left = 0
    if crop_top < 0:
        crop_bottom -= crop_top
        crop_top = 0
    if crop_right > image_width:
        shift = crop_right - image_width
        crop_left = max(0, crop_left - shift)
        crop_right = image_width
    if crop_bottom > image_height:
        shift = crop_bottom - image_height
        crop_top = max(0, crop_top - shift)
        crop_bottom = image_height
    return crop_left, crop_top, crop_right, crop_bottom


def binary_array(image: Image.Image) -> np.ndarray:
    return np.array(image.convert("L")) > 0


def mask_metrics(pred: np.ndarray, gt: np.ndarray) -> dict[str, Any]:
    pred_area = int(pred.sum())
    gt_area = int(gt.sum())
    intersection = int(np.logical_and(pred, gt).sum())
    union = int(np.logical_or(pred, gt).sum())
    dice_denominator = pred_area + gt_area
    return {
        "dice": (2.0 * intersection / dice_denominator) if dice_denominator else 1.0,
        "iou": (intersection / union) if union else 1.0,
        "pred_area": pred_area,
        "gt_area": gt_area,
        "area_ratio": (pred_area / gt_area) if gt_area else None,
    }


def write_overlay(image: Image.Image, pred: np.ndarray, gt: np.ndarray, crop_box: tuple[int, int, int, int], path: Path) -> None:
    base = image.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    pred_layer = np.zeros((base.height, base.width, 4), dtype=np.uint8)
    pred_layer[pred] = [0, 255, 0, 95]
    pred_layer[gt] = [255, 0, 0, 90]
    both = np.logical_and(pred, gt)
    pred_layer[both] = [255, 230, 0, 120]
    overlay = Image.fromarray(pred_layer, "RGBA")
    composed = Image.alpha_composite(base, overlay)
    draw = ImageDraw.Draw(composed)
    draw.rectangle(crop_box, outline=(0, 160, 255, 255), width=3)
    composed.convert("RGB").save(path)


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = sorted({key for row in rows for key in row})
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    successes = [row for row in rows if row.get("status") == "succeeded"]
    dice_values = [float(row["dice"]) for row in successes]
    iou_values = [float(row["iou"]) for row in successes]
    return {
        "schema_version": "thyroid.nnunet_detector_roi_validation.v1",
        "total_cases": len(rows),
        "succeeded": len(successes),
        "failed": len(rows) - len(successes),
        "mean_dice": round(float(np.mean(dice_values)), 6) if dice_values else None,
        "median_dice": round(float(np.median(dice_values)), 6) if dice_values else None,
        "min_dice": round(float(np.min(dice_values)), 6) if dice_values else None,
        "mean_iou": round(float(np.mean(iou_values)), 6) if iou_values else None,
        "median_iou": round(float(np.median(iou_values)), 6) if iou_values else None,
        "min_iou": round(float(np.min(iou_values)), 6) if iou_values else None,
        "dice_ge_090": sum(1 for value in dice_values if value >= 0.90),
        "dice_ge_095": sum(1 for value in dice_values if value >= 0.95),
    }


def write_contact_sheet(path: Path, rows: list[dict[str, Any]]) -> None:
    selected = [row for row in rows if row.get("status") == "succeeded" and row.get("overlay_path")]
    selected = sorted(selected, key=lambda row: float(row["dice"]))[:20]
    if not selected:
        return
    thumbs = []
    for row in selected:
        with Image.open(row["overlay_path"]) as image:
            thumb = image.convert("RGB")
            thumb.thumbnail((260, 180))
            canvas = Image.new("RGB", (260, 210), "white")
            canvas.paste(thumb, ((260 - thumb.width) // 2, 0))
            draw = ImageDraw.Draw(canvas)
            draw.text((8, 184), f"{row['image_id']} Dice={float(row['dice']):.3f}", fill=(0, 0, 0))
            thumbs.append(canvas)
    columns = 4
    rows_count = math.ceil(len(thumbs) / columns)
    sheet = Image.new("RGB", (columns * 260, rows_count * 210), "white")
    for index, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((index % columns) * 260, (index // columns) * 210))
    sheet.save(path)


def write_report(path: Path, rows: list[dict[str, Any]], summary: dict[str, Any], pred_dir: Path) -> None:
    worst = [row for row in rows if row.get("status") == "succeeded"]
    worst = sorted(worst, key=lambda row: float(row["dice"]))[:10]
    lines = [
        "# nnU-Net Tight ROI Detector-Prompt Validation",
        "",
        "## Run",
        "",
        f"- Predictions: `{pred_dir}`",
        "- Input prompt: YOLO detector bbox expanded as tight ROI crop.",
        "- Evaluation: ROI prediction pasted back to full image, compared with full-size TN3K test mask.",
        "",
        "## Summary",
        "",
        f"- Total cases: {summary['total_cases']}",
        f"- Succeeded: {summary['succeeded']}",
        f"- Failed/skipped: {summary['failed']}",
        f"- Mean Dice: {summary['mean_dice']}",
        f"- Median Dice: {summary['median_dice']}",
        f"- Min Dice: {summary['min_dice']}",
        f"- Mean IoU: {summary['mean_iou']}",
        f"- Dice >= 0.90: {summary['dice_ge_090']}",
        f"- Dice >= 0.95: {summary['dice_ge_095']}",
        "",
        "## Lowest Dice Cases",
        "",
        "| image_id | nnU-Net Dice | SAM2 Dice | area_ratio |",
        "|---|---:|---:|---:|",
    ]
    for row in worst:
        lines.append(
            f"| {row['image_id']} | {float(row['dice']):.6f} | {row.get('source_sam2_dice') or ''} | {row.get('area_ratio') or ''} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
