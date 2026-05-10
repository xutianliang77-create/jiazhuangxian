#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_GATEWAY_ROOT = REPO_ROOT / "services" / "model-gateway"
sys.path.insert(0, str(MODEL_GATEWAY_ROOT))

from app.schemas import DetectNodulesRequest, SegmentNoduleRequest  # noqa: E402
from app.store import ModelJobStore  # noqa: E402
from app.worker import run_once  # noqa: E402


@dataclass(frozen=True)
class CaseInput:
    image_id: str
    image_path: Path
    mask_path: Path
    bbox: list[float]
    width: int | None
    height: int | None
    split: str


@dataclass(frozen=True)
class MaskMetrics:
    dice: float
    iou: float
    pred_area: int
    gt_area: int
    intersection: int
    union: int
    area_ratio: float | None


def main() -> int:
    parser = argparse.ArgumentParser(description="Run SAM2 static detector-prompt validation through model-worker.")
    parser.add_argument(
        "--annotations",
        default="data/artifacts/datasets/tn3k/derived/detection/annotations/test.jsonl",
        help="TN3K detection JSONL manifest with image_path, mask_path, and bbox_xyxy.",
    )
    parser.add_argument("--limit", type=int, default=20, help="Number of cases to run.")
    parser.add_argument("--offset", type=int, default=0, help="Start offset within the annotation file.")
    parser.add_argument("--artifact-root", default="data/artifacts", help="Artifact root used by model-gateway.")
    parser.add_argument(
        "--output-dir",
        default="data/artifacts/reports/sam2-static-chain-validation-20260510",
        help="Directory for metrics, overlays, and report.",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="SQLite model_job DB. Default: <output-dir>/model-gateway.db",
    )
    parser.add_argument("--prompt-source", choices=("gt_bbox", "detector"), default="gt_bbox", help="Use GT-derived bbox or model detector bbox as SAM2 prompt.")
    parser.add_argument("--detector-model", default="rf-detr-medium-thyroid-detector", help="Detector model name when --prompt-source detector is used.")
    parser.add_argument("--detector-model-version", default="tn5000-rfdetr-medium-validation", help="Detector model version stored on detection jobs.")
    parser.add_argument("--detector-confidence", type=float, default=0.25, help="Detector confidence threshold passed in metadata.")
    parser.add_argument("--detector-selection", choices=("highest_confidence", "best_iou_gt"), default="highest_confidence", help="Detection selection policy when multiple boxes are returned.")
    parser.add_argument("--model", default="sam2-thyroid-segmenter", help="SAM2 model name stored on the segmentation job.")
    parser.add_argument(
        "--model-version",
        default="sam2.1-large-official-detector-prompt",
        help="Model version stored on the model job.",
    )
    parser.add_argument("--bbox-padding-ratio", type=float, default=0.0, help="Optional bbox padding before prompting SAM2.")
    parser.add_argument("--force", action="store_true", help="Remove an existing output DB before running.")
    args = parser.parse_args()

    artifact_root = resolve_repo_path(args.artifact_root)
    output_dir = resolve_repo_path(args.output_dir)
    db_path = resolve_repo_path(args.db) if args.db else output_dir / "model-gateway.db"
    annotations = resolve_repo_path(args.annotations)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "overlays").mkdir(parents=True, exist_ok=True)
    if args.force and db_path.exists():
        db_path.unlink()

    cases = load_cases(annotations, limit=args.limit, offset=args.offset)
    store = ModelJobStore(db_path)
    rows: list[dict[str, Any]] = []
    for index, case in enumerate(cases, start=1):
        prompt = build_prompt(case, store, artifact_root, args)
        if prompt["status"] != "ok":
            row = {
                "index": index,
                "image_id": case.image_id,
                "status": prompt["status"],
                "image_path": str(case.image_path),
                "mask_path": str(case.mask_path),
                "gt_bbox": json.dumps(case.bbox),
                "error": prompt.get("error"),
            }
            rows.append(row)
            print(json.dumps({"case": case.image_id, "status": row["status"]}, ensure_ascii=False), flush=True)
            continue
        bbox = pad_bbox(prompt["bbox"], args.bbox_padding_ratio, case.width, case.height)
        job = store.enqueue_segment_nodule(
            SegmentNoduleRequest(
                study_id="TN3K_SAM2_STATIC_CHAIN",
                image_id=case.image_id,
                image_uri=path_to_artifact_uri(case.image_path, artifact_root),
                nodule_id=f"{case.image_id}_nodule_1",
                bbox=bbox,
                model=args.model,
                model_version=args.model_version,
                allow_bbox_fallback=False,
                return_mask=True,
                metadata={
                    "dataset": "TN3K",
                    "split": case.split,
                    "prompt_source": prompt["source"],
                    "gt_mask_path": str(case.mask_path),
                    "detector_job_id": prompt.get("detector_job_id"),
                    "detector_artifact_uri": prompt.get("detector_artifact_uri"),
                },
            )
        )
        result = run_once(store, worker_id="sam2-static-chain-validation")
        row = evaluate_result(index, case, bbox, job, result, artifact_root, output_dir)
        row.update({key: value for key, value in prompt.items() if key not in {"status", "bbox"}})
        rows.append(row)
        print(json.dumps({"case": case.image_id, "status": row["status"], "dice": row.get("dice"), "iou": row.get("iou")}, ensure_ascii=False), flush=True)

    summary = summarize(rows, args)
    write_csv(output_dir / "case_metrics.csv", rows)
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_contact_sheet(output_dir, rows)
    write_markdown_report(output_dir / "SAM2_STATIC_CHAIN_VALIDATION_REPORT.md", rows, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["succeeded"] == summary["total_cases"] else 2


def build_prompt(case: CaseInput, store: ModelJobStore, artifact_root: Path, args: argparse.Namespace) -> dict[str, Any]:
    if args.prompt_source == "gt_bbox":
        return {
            "status": "ok",
            "bbox": case.bbox,
            "source": "tn3k_mask_bbox_detector_prompt_proxy",
            "gt_bbox": json.dumps(case.bbox),
        }

    image_uri = path_to_artifact_uri(case.image_path, artifact_root)
    job = store.enqueue_detect_nodules(
        DetectNodulesRequest(
            study_id="TN3K_SAM2_STATIC_CHAIN",
            image_id=case.image_id,
            image_uri=image_uri,
            model=args.detector_model,
            model_version=args.detector_model_version,
            return_overlay=True,
            metadata={
                "confidence_threshold": args.detector_confidence,
                "validation_case": case.image_id,
                "prompt_source": "detector",
            },
        )
    )
    result = run_once(store, worker_id="sam2-static-chain-validation-detector")
    if result.get("status") != "succeeded":
        return {
            "status": "detector_failed",
            "source": "detector",
            "detector_job_id": job.get("id"),
            "error": json.dumps(result.get("error"), ensure_ascii=False),
        }
    artifact_uri = str(result.get("artifact_uri"))
    artifact_path = artifact_uri_to_path(artifact_uri, artifact_root)
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    detections = artifact.get("detections") if isinstance(artifact.get("detections"), list) else []
    selected = select_detection(detections, case.bbox, args.detector_selection)
    if selected is None:
        return {
            "status": "detector_empty",
            "source": "detector",
            "detector_job_id": job.get("id"),
            "detector_artifact_uri": artifact_uri,
            "detector_warnings": json.dumps(artifact.get("warnings", []), ensure_ascii=False),
        }
    bbox = [float(value) for value in selected["bbox"]]
    return {
        "status": "ok",
        "bbox": bbox,
        "source": "detector_bbox",
        "gt_bbox": json.dumps(case.bbox),
        "detector_job_id": job.get("id"),
        "detector_artifact_uri": artifact_uri,
        "detector_model": selected.get("model_name"),
        "detector_model_version": selected.get("model_version"),
        "detector_confidence": selected.get("confidence"),
        "detector_bbox": json.dumps(bbox),
        "detector_bbox_iou_gt": round(bbox_iou(bbox, case.bbox), 6),
        "detector_selection": args.detector_selection,
        "detector_detection_count": len(detections),
        "detector_comparison_uri": artifact.get("artifacts", {}).get("model_comparison_json") if isinstance(artifact.get("artifacts"), dict) else None,
    }


def select_detection(detections: list[Any], gt_bbox: list[float], selection: str) -> dict[str, Any] | None:
    valid = [item for item in detections if isinstance(item, dict) and isinstance(item.get("bbox"), list)]
    if not valid:
        return None
    if selection == "best_iou_gt":
        return max(valid, key=lambda item: bbox_iou([float(value) for value in item["bbox"]], gt_bbox))
    return max(valid, key=lambda item: float(item.get("confidence") or 0.0))


def load_cases(path: Path, *, limit: int, offset: int) -> list[CaseInput]:
    cases: list[CaseInput] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_index, raw_line in enumerate(handle):
            if line_index < offset:
                continue
            if len(cases) >= limit:
                break
            payload = json.loads(raw_line)
            image_path = resolve_repo_path(payload["image_path"])
            mask_path = resolve_repo_path(payload["mask_path"])
            bbox = [float(value) for value in payload["bbox_xyxy"]]
            cases.append(
                CaseInput(
                    image_id=str(payload["image_id"]),
                    image_path=image_path,
                    mask_path=mask_path,
                    bbox=bbox,
                    width=int(payload["width"]) if payload.get("width") is not None else None,
                    height=int(payload["height"]) if payload.get("height") is not None else None,
                    split=str(payload.get("split") or "unknown"),
                )
            )
    return cases


def evaluate_result(
    index: int,
    case: CaseInput,
    prompt_bbox: list[float],
    job: dict[str, Any],
    result: dict[str, Any],
    artifact_root: Path,
    output_dir: Path,
) -> dict[str, Any]:
    base = {
        "index": index,
        "image_id": case.image_id,
        "status": result.get("status"),
        "job_id": job.get("id"),
        "artifact_uri": result.get("artifact_uri"),
        "image_path": str(case.image_path),
        "mask_path": str(case.mask_path),
        "prompt_bbox": json.dumps(prompt_bbox),
    }
    if result.get("status") != "succeeded":
        return {**base, "error": json.dumps(result.get("error"), ensure_ascii=False)}

    artifact_path = artifact_uri_to_path(str(result["artifact_uri"]), artifact_root)
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    segmentations = artifact.get("segmentations") if isinstance(artifact.get("segmentations"), list) else []
    if not segmentations:
        return {**base, "status": "empty", "warnings": json.dumps(artifact.get("warnings", []), ensure_ascii=False)}

    segmentation = segmentations[0]
    mask_uri = segmentation.get("mask_uri")
    if not mask_uri:
        return {**base, "status": "mask_missing", "warnings": json.dumps(artifact.get("warnings", []), ensure_ascii=False)}

    pred_mask = load_binary_mask(artifact_uri_to_path(str(mask_uri), artifact_root))
    gt_mask = load_binary_mask(case.mask_path)
    if pred_mask.shape != gt_mask.shape:
        gt_mask = resize_mask(gt_mask, pred_mask.shape)
    metrics = mask_metrics(pred_mask, gt_mask)
    pred_bbox = bbox_from_mask(pred_mask)
    gt_bbox = bbox_from_mask(gt_mask)
    overlay_path = output_dir / "overlays" / f"{case.image_id}_overlay.png"
    write_overlay(case.image_path, gt_mask, pred_mask, prompt_bbox, pred_bbox, overlay_path)
    return {
        **base,
        "status": "succeeded",
        "segmentation_source": segmentation.get("segmentation_source"),
        "confidence": segmentation.get("confidence"),
        "requires_doctor_review": segmentation.get("requires_doctor_review"),
        "mask_uri": mask_uri,
        "dice": round(metrics.dice, 6),
        "iou": round(metrics.iou, 6),
        "pred_area": metrics.pred_area,
        "gt_area": metrics.gt_area,
        "area_ratio": round(metrics.area_ratio, 6) if metrics.area_ratio is not None else None,
        "pred_bbox": json.dumps(pred_bbox),
        "gt_bbox": json.dumps(gt_bbox),
        "bbox_iou": round(bbox_iou(pred_bbox, gt_bbox), 6) if pred_bbox and gt_bbox else None,
        "warnings": json.dumps(artifact.get("warnings", []), ensure_ascii=False),
        "overlay_path": str(overlay_path),
    }


def mask_metrics(pred: np.ndarray, gt: np.ndarray) -> MaskMetrics:
    pred_bool = pred.astype(bool)
    gt_bool = gt.astype(bool)
    intersection = int(np.logical_and(pred_bool, gt_bool).sum())
    pred_area = int(pred_bool.sum())
    gt_area = int(gt_bool.sum())
    union = int(np.logical_or(pred_bool, gt_bool).sum())
    dice = 1.0 if pred_area + gt_area == 0 else (2.0 * intersection) / float(pred_area + gt_area)
    iou = 1.0 if union == 0 else intersection / float(union)
    area_ratio = None if gt_area == 0 else pred_area / float(gt_area)
    return MaskMetrics(dice=dice, iou=iou, pred_area=pred_area, gt_area=gt_area, intersection=intersection, union=union, area_ratio=area_ratio)


def summarize(rows: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any]:
    succeeded = [row for row in rows if row.get("status") == "succeeded" and row.get("dice") is not None]
    dice_values = [float(row["dice"]) for row in succeeded]
    iou_values = [float(row["iou"]) for row in succeeded]
    return {
        "schema_version": "thyroid.sam2_static_chain_validation.v1",
        "total_cases": len(rows),
        "succeeded": len(succeeded),
        "failed": len(rows) - len(succeeded),
        "model": args.model,
        "model_version": args.model_version,
        "prompt_source": args.prompt_source,
        "detector_model": args.detector_model if args.prompt_source == "detector" else None,
        "detector_selection": args.detector_selection if args.prompt_source == "detector" else None,
        "mean_dice": round(float(np.mean(dice_values)), 6) if dice_values else None,
        "median_dice": round(float(np.median(dice_values)), 6) if dice_values else None,
        "min_dice": round(float(np.min(dice_values)), 6) if dice_values else None,
        "mean_iou": round(float(np.mean(iou_values)), 6) if iou_values else None,
        "median_iou": round(float(np.median(iou_values)), 6) if iou_values else None,
        "min_iou": round(float(np.min(iou_values)), 6) if iou_values else None,
        "dice_ge_090": sum(value >= 0.90 for value in dice_values),
        "dice_ge_095": sum(value >= 0.95 for value in dice_values),
        "annotations": args.annotations,
        "limit": args.limit,
        "offset": args.offset,
        "bbox_padding_ratio": args.bbox_padding_ratio,
    }


def write_markdown_report(path: Path, rows: list[dict[str, Any]], summary: dict[str, Any]) -> None:
    lines = [
        "# SAM2 静态 detector-prompt 链条验证报告",
        "",
        "## 结论",
        "",
        f"- 样本数：{summary['total_cases']}",
        f"- 成功数：{summary['succeeded']}",
        f"- Mean Dice：{summary['mean_dice']}",
        f"- Median Dice：{summary['median_dice']}",
        f"- Mean IoU：{summary['mean_iou']}",
        f"- Dice >= 0.90：{summary['dice_ge_090']}",
        f"- Dice >= 0.95：{summary['dice_ge_095']}",
        "",
        prompt_note(summary),
        "",
        "## 样本结果",
        "",
        "| # | image_id | status | Dice | IoU | confidence | bbox_iou | detector_conf | detector_bbox_iou_gt | overlay |",
        "|---:|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in rows:
        overlay = Path(str(row.get("overlay_path", ""))).name if row.get("overlay_path") else ""
        overlay_link = f"[{overlay}](overlays/{overlay})" if overlay else ""
        lines.append(
            "| {index} | {image_id} | {status} | {dice} | {iou} | {confidence} | {bbox_iou} | {detector_confidence} | {detector_bbox_iou_gt} | {overlay} |".format(
                index=row.get("index"),
                image_id=row.get("image_id"),
                status=row.get("status"),
                dice=row.get("dice", ""),
                iou=row.get("iou", ""),
                confidence=row.get("confidence", ""),
                bbox_iou=row.get("bbox_iou", ""),
                detector_confidence=row.get("detector_confidence", ""),
                detector_bbox_iou_gt=row.get("detector_bbox_iou_gt", ""),
                overlay=overlay_link,
            )
        )
    lines.extend(
        [
            "",
            "## 输出文件",
            "",
            "- `summary.json`",
            "- `case_metrics.csv`",
            "- `overlays/*.png`",
            "- `contact_sheet.png`",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def prompt_note(summary: dict[str, Any]) -> str:
    if summary.get("prompt_source") == "detector":
        return (
            f"说明：本轮验证先运行 `{summary.get('detector_model')}` 生成真实检测框，再把检测框作为 SAM2 bbox prompt。"
            "这用于评估完整 `detect_nodules -> segment_nodule -> artifact` 链路。"
        )
    return "说明：本轮验证使用 TN3K mask 派生 bbox 作为 detector-prompt 代理，目的是验证 SAM2 静态分割在正式 `thyroid.segment_nodule -> model-worker -> segmentation artifact` 链路中能真实运行。下一轮应替换为 RF-DETR/YOLO 实际检测框。"


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_overlay(image_path: Path, gt_mask: np.ndarray, pred_mask: np.ndarray, prompt_bbox: list[float], pred_bbox: list[float] | None, out_path: Path) -> None:
    base = Image.open(image_path).convert("RGBA")
    if base.size != (pred_mask.shape[1], pred_mask.shape[0]):
        base = base.resize((pred_mask.shape[1], pred_mask.shape[0]), Image.Resampling.BILINEAR)
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gt_layer = Image.fromarray((gt_mask.astype(np.uint8) * 95), mode="L")
    pred_layer = Image.fromarray((pred_mask.astype(np.uint8) * 115), mode="L")
    overlay.paste((0, 255, 0, 95), mask=gt_layer)
    overlay.paste((255, 0, 0, 115), mask=pred_layer)
    composed = Image.alpha_composite(base, overlay)
    draw = ImageDraw.Draw(composed)
    draw.rectangle(tuple(prompt_bbox), outline=(255, 220, 0, 255), width=2)
    if pred_bbox:
        draw.rectangle(tuple(pred_bbox), outline=(255, 0, 0, 255), width=2)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    composed.convert("RGB").save(out_path)


def write_contact_sheet(output_dir: Path, rows: list[dict[str, Any]]) -> None:
    overlay_paths = [Path(str(row["overlay_path"])) for row in rows if row.get("overlay_path") and Path(str(row["overlay_path"])).exists()]
    if not overlay_paths:
        return
    thumbs = []
    for path in overlay_paths:
        img = Image.open(path).convert("RGB")
        img.thumbnail((240, 180))
        tile = Image.new("RGB", (240, 210), (255, 255, 255))
        tile.paste(img, ((240 - img.width) // 2, 0))
        draw = ImageDraw.Draw(tile)
        draw.text((8, 184), path.stem.replace("_overlay", ""), fill=(0, 0, 0))
        thumbs.append(tile)
    cols = 4
    rows_count = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 240, rows_count * 210), (245, 245, 245))
    for idx, tile in enumerate(thumbs):
        sheet.paste(tile, ((idx % cols) * 240, (idx // cols) * 210))
    sheet.save(output_dir / "contact_sheet.png")


def load_binary_mask(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("L")) > 0


def resize_mask(mask: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255)
    resized = image.resize((shape[1], shape[0]), Image.Resampling.NEAREST)
    return np.asarray(resized) > 0


def bbox_from_mask(mask: np.ndarray) -> list[float] | None:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return [float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)]


def bbox_iou(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b:
        return 0.0
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - intersection
    return 0.0 if union <= 0 else intersection / union


def pad_bbox(bbox: list[float], ratio: float, width: int | None, height: int | None) -> list[float]:
    if ratio <= 0:
        return bbox
    x1, y1, x2, y2 = bbox
    pad_x = (x2 - x1) * ratio
    pad_y = (y2 - y1) * ratio
    max_x = float(width) if width else x2 + pad_x
    max_y = float(height) if height else y2 + pad_y
    return [max(0.0, x1 - pad_x), max(0.0, y1 - pad_y), min(max_x, x2 + pad_x), min(max_y, y2 + pad_y)]


def path_to_artifact_uri(path: Path, artifact_root: Path) -> str:
    resolved = path.resolve()
    root = artifact_root.resolve()
    try:
        rel = resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"path is not under artifact root: {path}") from exc
    return f"artifact://{rel.as_posix()}"


def artifact_uri_to_path(uri: str, artifact_root: Path) -> Path:
    if not uri.startswith("artifact://"):
        raise ValueError(f"unsupported artifact uri: {uri}")
    return artifact_root / uri.removeprefix("artifact://")


def resolve_repo_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else REPO_ROOT / path


if __name__ == "__main__":
    raise SystemExit(main())
