from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse


JsonDict = dict[str, Any]

DETECTION_SCHEMA_VERSION = "thyroid.detector.output.v1"
DETECTION_ARTIFACT_KIND = "thyroid_nodule_detection"


def write_detector_artifact(
    job: Mapping[str, Any],
    output: Mapping[str, Any],
    *,
    worker_id: str,
    env: Mapping[str, str] | None = None,
) -> JsonDict:
    source_env = os.environ if env is None else env
    root = Path(source_env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()
    rel_dir = Path(
        "model-output",
        "thyroid-detect-nodules",
        safe_segment(job.get("study_id")),
        safe_segment(job.get("image_id")),
        safe_segment(job.get("id")),
    )
    out_dir = root / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    artifact_path = out_dir / "detections.json"
    artifact_uri = f"artifact://{(rel_dir / 'detections.json').as_posix()}"
    artifact = build_detector_artifact(job, output, worker_id=worker_id)
    artifact["artifacts"]["detections_json"] = artifact_uri
    if not artifact["artifacts"]["overlay_image"] and wants_overlay(job):
        overlay = write_overlay_image(root, rel_dir, artifact)
        if overlay["overlay_uri"]:
            artifact["artifacts"]["overlay_image"] = overlay["overlay_uri"]
        if overlay["warning"]:
            artifact["warnings"].append(overlay["warning"])
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "artifact_uri": artifact_uri,
        "overlay_uri": artifact["artifacts"]["overlay_image"],
        "artifact_path": str(artifact_path),
        "artifact": artifact,
    }


def build_detector_artifact(job: Mapping[str, Any], output: Mapping[str, Any], *, worker_id: str) -> JsonDict:
    input_payload = parse_json_object(job.get("input_json"))
    detections = normalize_detections(output.get("nodules"))
    primary_model = output.get("model") if isinstance(output.get("model"), dict) else {}
    comparison = output.get("comparison") if isinstance(output.get("comparison"), dict) else {}
    overlay_uri = string_or_none(output.get("overlay_uri"))
    return {
        "schema_version": DETECTION_SCHEMA_VERSION,
        "artifact_kind": DETECTION_ARTIFACT_KIND,
        "created_at": int(time.time() * 1000),
        "created_by_worker": worker_id,
        "study_id": string_or_none(job.get("study_id")),
        "image_id": string_or_none(job.get("image_id")),
        "agent_task_id": string_or_none(job.get("agent_task_id")),
        "model_job_id": string_or_none(job.get("id")),
        "job_type": string_or_none(job.get("job_type")),
        "source_image_uri": string_or_none(input_payload.get("image_uri")),
        "coordinate_system": {
            "type": "pixel_xyxy",
            "origin": "top_left",
            "unit": "pixel",
        },
        "primary_model": primary_model,
        "detectors": {
            "primary": primary_model,
            "comparators": comparison.get("comparators", []),
            "consensus": comparison.get("consensus", {"status": "single_model_only"}),
        },
        "artifacts": {
            "detections_json": None,
            "overlay_image": overlay_uri,
            "model_comparison_json": None,
        },
        "detections": detections,
        "warnings": output.get("warnings", []) if isinstance(output.get("warnings"), list) else [],
        "raw_output": dict(output),
    }


def normalize_detections(value: Any) -> list[JsonDict]:
    if not isinstance(value, list):
        return []
    detections: list[JsonDict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        detections.append(
            {
                "nodule_index": int(item.get("nodule_index") or index),
                "bbox": normalize_bbox(item.get("bbox")),
                "confidence": number_or_none(item.get("confidence")),
                "class_id": int(item["class_id"]) if isinstance(item.get("class_id"), (int, float)) else None,
                "source": string_or_none(item.get("source")) or "ai",
                "model_name": string_or_none(item.get("model_name")),
                "model_version": string_or_none(item.get("model_version")),
            }
        )
    return detections


def normalize_bbox(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    coords: list[float] = []
    for item in value:
        number = number_or_none(item)
        if number is None:
            return None
        coords.append(number)
    return coords


def wants_overlay(job: Mapping[str, Any]) -> bool:
    input_payload = parse_json_object(job.get("input_json"))
    return bool(input_payload.get("return_overlay", True))


def write_overlay_image(root: Path, rel_dir: Path, artifact: Mapping[str, Any]) -> JsonDict:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return {"overlay_uri": None, "warning": "overlay_unavailable:pillow_missing"}

    source_uri = string_or_none(artifact.get("source_image_uri"))
    if not source_uri:
        return {"overlay_uri": None, "warning": "overlay_unavailable:source_image_missing"}

    try:
        source_path = resolve_image_uri(source_uri, root)
    except ValueError as exc:
        return {"overlay_uri": None, "warning": f"overlay_unavailable:{exc}"}

    if not source_path.exists():
        return {"overlay_uri": None, "warning": "overlay_unavailable:source_image_not_found"}

    try:
        image = Image.open(source_path).convert("RGB")
    except Exception:
        return {"overlay_uri": None, "warning": "overlay_unavailable:unsupported_image"}

    draw = ImageDraw.Draw(image)
    detections = artifact.get("detections") if isinstance(artifact.get("detections"), list) else []
    line_width = max(2, min(image.width, image.height) // 220)
    for detection in detections:
        if not isinstance(detection, dict):
            continue
        bbox = normalize_bbox(detection.get("bbox"))
        if not bbox:
            continue
        x1, y1, x2, y2 = clamp_bbox(bbox, image.width, image.height)
        color = overlay_color(int(detection.get("nodule_index") or 1))
        draw.rectangle([x1, y1, x2, y2], outline=color, width=line_width)
        label = overlay_label(detection)
        if label:
            label_box = draw.textbbox((x1, y1), label)
            label_height = label_box[3] - label_box[1]
            label_width = label_box[2] - label_box[0]
            label_y = max(0, y1 - label_height - 4)
            draw.rectangle([x1, label_y, x1 + label_width + 6, label_y + label_height + 4], fill=color)
            draw.text((x1 + 3, label_y + 2), label, fill=(0, 0, 0))

    overlay_rel = rel_dir / "overlay.png"
    overlay_path = root / overlay_rel
    overlay_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(overlay_path)
    return {"overlay_uri": f"artifact://{overlay_rel.as_posix()}", "warning": None}


def resolve_image_uri(uri: str, root: Path) -> Path:
    if uri.startswith("artifact://"):
        relative = uri.removeprefix("artifact://").lstrip("/")
        if not relative:
            raise ValueError("source_image_empty")
        resolved_root = root.expanduser().resolve()
        path = (resolved_root / relative).resolve()
        if not path.is_relative_to(resolved_root):
            raise ValueError("source_image_outside_artifact_root")
        return path
    if uri.startswith("file://"):
        return Path(urlparse(uri).path).expanduser()
    return Path(uri).expanduser()


def clamp_bbox(bbox: list[float], width: int, height: int) -> list[float]:
    x1 = min(max(bbox[0], 0.0), float(max(0, width - 1)))
    y1 = min(max(bbox[1], 0.0), float(max(0, height - 1)))
    x2 = min(max(bbox[2], 0.0), float(max(0, width - 1)))
    y2 = min(max(bbox[3], 0.0), float(max(0, height - 1)))
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    return [x1, y1, x2, y2]


def overlay_color(index: int) -> tuple[int, int, int]:
    colors = (
        (255, 214, 10),
        (64, 221, 255),
        (255, 107, 107),
        (120, 255, 120),
        (220, 160, 255),
    )
    return colors[(max(1, index) - 1) % len(colors)]


def overlay_label(detection: Mapping[str, Any]) -> str:
    index = int(detection.get("nodule_index") or 1)
    confidence = number_or_none(detection.get("confidence"))
    return f"N{index} {confidence:.2f}" if confidence is not None else f"N{index}"


def safe_segment(value: Any) -> str:
    raw = string_or_none(value) or "unknown"
    sanitized = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw).strip("._-")
    return (sanitized or "unknown")[:80]


def parse_json_object(value: Any) -> JsonDict:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def string_or_none(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def number_or_none(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None
