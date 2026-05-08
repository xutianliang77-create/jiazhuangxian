from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Mapping


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
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "artifact_uri": artifact_uri,
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
