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
SEGMENTATION_SCHEMA_VERSION = "thyroid.segmentation.output.v1"
SEGMENTATION_ARTIFACT_KIND = "thyroid_nodule_segmentation"
MEASUREMENT_SCHEMA_VERSION = "thyroid.measurement.output.v1"
MEASUREMENT_ARTIFACT_KIND = "thyroid_nodule_measurement"
VIDEO_SEGMENTATION_SCHEMA_VERSION = "thyroid.video_segmentation.output.v1"
VIDEO_SEGMENTATION_ARTIFACT_KIND = "thyroid_nodule_video_segmentation"
VIDEO_MEASUREMENT_SCHEMA_VERSION = "thyroid.video_measurement.output.v1"
VIDEO_MEASUREMENT_ARTIFACT_KIND = "thyroid_nodule_video_measurement"


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
    comparison_uri = write_comparison_artifact(out_dir, rel_dir, artifact)
    if comparison_uri:
        artifact["artifacts"]["model_comparison_json"] = comparison_uri
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


def write_segmentation_artifact(
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
        "thyroid-segment-nodule",
        safe_segment(job.get("study_id")),
        safe_segment(job.get("image_id")),
        safe_segment(job.get("id")),
    )
    out_dir = root / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact_uri = f"artifact://{(rel_dir / 'segmentation.json').as_posix()}"
    artifact = build_segmentation_artifact(job, output, worker_id=worker_id)
    artifact["artifacts"]["segmentation_json"] = artifact_uri
    mask_warnings = write_segmentation_masks(root, rel_dir, artifact)
    artifact["warnings"] = sorted(set([*artifact["warnings"], *mask_warnings]))
    artifact_path = out_dir / "segmentation.json"
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "artifact_uri": artifact_uri,
        "artifact_path": str(artifact_path),
        "artifact": artifact,
    }


def build_segmentation_artifact(job: Mapping[str, Any], output: Mapping[str, Any], *, worker_id: str) -> JsonDict:
    input_payload = parse_json_object(job.get("input_json"))
    segmentations = normalize_segmentations(output.get("segmentations"))
    warnings = output.get("warnings", []) if isinstance(output.get("warnings"), list) else []
    model = output.get("model") if isinstance(output.get("model"), dict) else {}
    return {
        "schema_version": SEGMENTATION_SCHEMA_VERSION,
        "artifact_kind": SEGMENTATION_ARTIFACT_KIND,
        "created_at": int(time.time() * 1000),
        "created_by_worker": worker_id,
        "study_id": string_or_none(job.get("study_id")),
        "image_id": string_or_none(job.get("image_id")),
        "agent_task_id": string_or_none(job.get("agent_task_id")),
        "model_job_id": string_or_none(job.get("id")),
        "job_type": string_or_none(job.get("job_type")),
        "source_image_uri": string_or_none(input_payload.get("image_uri")),
        "coordinate_system": {
            "type": "pixel_xy",
            "origin": "top_left",
            "unit": "pixel",
        },
        "model": model,
        "evaluation": segmentation_artifact_evaluation(segmentations, warnings, model),
        "artifacts": {
            "segmentation_json": None,
            "mask_images": [],
        },
        "segmentations": segmentations,
        "warnings": warnings,
        "raw_output": dict(output),
    }


def write_measurement_artifact(
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
        "thyroid-measure-nodule",
        safe_segment(job.get("study_id")),
        safe_segment(job.get("image_id")),
        safe_segment(job.get("id")),
    )
    out_dir = root / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact_uri = f"artifact://{(rel_dir / 'measurements.json').as_posix()}"
    artifact = {
        "schema_version": MEASUREMENT_SCHEMA_VERSION,
        "artifact_kind": MEASUREMENT_ARTIFACT_KIND,
        "created_at": int(time.time() * 1000),
        "created_by_worker": worker_id,
        "study_id": string_or_none(job.get("study_id")),
        "image_id": string_or_none(job.get("image_id")),
        "agent_task_id": string_or_none(job.get("agent_task_id")),
        "model_job_id": string_or_none(job.get("id")),
        "job_type": string_or_none(job.get("job_type")),
        "coordinate_system": {
            "type": "pixel",
            "origin": "top_left",
            "unit": "pixel",
        },
        "artifacts": {"measurements_json": artifact_uri},
        "measurements": output.get("measurements", []) if isinstance(output.get("measurements"), list) else [],
        "pixel_spacing": output.get("pixel_spacing") if isinstance(output.get("pixel_spacing"), dict) else {},
        "evaluation": measurement_artifact_evaluation(output),
        "warnings": output.get("warnings", []) if isinstance(output.get("warnings"), list) else [],
        "raw_output": dict(output),
    }
    artifact_path = out_dir / "measurements.json"
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "artifact_uri": artifact_uri,
        "artifact_path": str(artifact_path),
        "artifact": artifact,
    }


def write_video_segmentation_artifact(
    job: Mapping[str, Any],
    output: Mapping[str, Any],
    *,
    worker_id: str,
    env: Mapping[str, str] | None = None,
) -> JsonDict:
    source_env = os.environ if env is None else env
    root = Path(source_env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()
    input_payload = parse_json_object(job.get("input_json"))
    video_id = string_or_none(input_payload.get("video_id")) or string_or_none(job.get("image_id")) or "unknown"
    rel_dir = Path(
        "model-output",
        "thyroid-segment-video-nodule",
        safe_segment(job.get("study_id")),
        safe_segment(video_id),
        safe_segment(job.get("id")),
    )
    out_dir = root / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact_uri = f"artifact://{(rel_dir / 'video_segmentation.json').as_posix()}"
    artifact = build_video_segmentation_artifact(job, output, worker_id=worker_id)
    artifact["artifacts"]["video_segmentation_json"] = artifact_uri
    mask_warnings = write_video_segmentation_masks(root, rel_dir, artifact)
    artifact["warnings"] = sorted(set([*artifact["warnings"], *mask_warnings]))
    artifact_path = out_dir / "video_segmentation.json"
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "artifact_uri": artifact_uri,
        "artifact_path": str(artifact_path),
        "artifact": artifact,
    }


def build_video_segmentation_artifact(job: Mapping[str, Any], output: Mapping[str, Any], *, worker_id: str) -> JsonDict:
    input_payload = parse_json_object(job.get("input_json"))
    tracks = normalize_video_tracks(output.get("tracks"))
    warnings = output.get("warnings", []) if isinstance(output.get("warnings"), list) else []
    model = output.get("model") if isinstance(output.get("model"), dict) else {}
    return {
        "schema_version": VIDEO_SEGMENTATION_SCHEMA_VERSION,
        "artifact_kind": VIDEO_SEGMENTATION_ARTIFACT_KIND,
        "created_at": int(time.time() * 1000),
        "created_by_worker": worker_id,
        "study_id": string_or_none(job.get("study_id")),
        "video_id": string_or_none(input_payload.get("video_id")) or string_or_none(job.get("image_id")),
        "agent_task_id": string_or_none(job.get("agent_task_id")),
        "model_job_id": string_or_none(job.get("id")),
        "job_type": string_or_none(job.get("job_type")),
        "source_video_uri": string_or_none(input_payload.get("video_uri")),
        "frame_manifest_uri": string_or_none(input_payload.get("frame_manifest_uri")),
        "coordinate_system": {
            "type": "pixel_xy",
            "origin": "top_left",
            "unit": "pixel",
        },
        "model": model,
        "video": output.get("video") if isinstance(output.get("video"), dict) else {},
        "evaluation": video_segmentation_artifact_evaluation(tracks, warnings, model),
        "artifacts": {
            "video_segmentation_json": None,
            "mask_images": [],
        },
        "tracks": tracks,
        "warnings": warnings,
        "raw_output": dict(output),
    }


def write_video_measurement_artifact(
    job: Mapping[str, Any],
    output: Mapping[str, Any],
    *,
    worker_id: str,
    env: Mapping[str, str] | None = None,
) -> JsonDict:
    source_env = os.environ if env is None else env
    root = Path(source_env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()
    input_payload = parse_json_object(job.get("input_json"))
    video_id = string_or_none(input_payload.get("video_id")) or string_or_none(job.get("image_id")) or "unknown"
    rel_dir = Path(
        "model-output",
        "thyroid-measure-video-nodule",
        safe_segment(job.get("study_id")),
        safe_segment(video_id),
        safe_segment(job.get("id")),
    )
    out_dir = root / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact_uri = f"artifact://{(rel_dir / 'video_measurement.json').as_posix()}"
    artifact = {
        "schema_version": VIDEO_MEASUREMENT_SCHEMA_VERSION,
        "artifact_kind": VIDEO_MEASUREMENT_ARTIFACT_KIND,
        "created_at": int(time.time() * 1000),
        "created_by_worker": worker_id,
        "study_id": string_or_none(job.get("study_id")),
        "video_id": video_id,
        "agent_task_id": string_or_none(job.get("agent_task_id")),
        "model_job_id": string_or_none(job.get("id")),
        "job_type": string_or_none(job.get("job_type")),
        "coordinate_system": {
            "type": "pixel",
            "origin": "top_left",
            "unit": "pixel",
        },
        "artifacts": {"video_measurement_json": artifact_uri},
        "measurements": output.get("measurements", []) if isinstance(output.get("measurements"), list) else [],
        "pixel_spacing": output.get("pixel_spacing") if isinstance(output.get("pixel_spacing"), dict) else {},
        "measurement_policy": string_or_none(output.get("measurement_policy")),
        "evaluation": measurement_artifact_evaluation(output, protocol="thyroid.video_measurement.evaluation.v1"),
        "warnings": output.get("warnings", []) if isinstance(output.get("warnings"), list) else [],
        "raw_output": dict(output),
    }
    artifact_path = out_dir / "video_measurement.json"
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
    llm_evaluation = output.get("llm_evaluation") if isinstance(output.get("llm_evaluation"), dict) else None
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
        "evaluation": detector_artifact_evaluation(comparison, detections),
        "artifacts": {
            "detections_json": None,
            "overlay_image": overlay_uri,
            "model_comparison_json": None,
        },
        "llm_evaluation": llm_evaluation,
        "detections": detections,
        "warnings": output.get("warnings", []) if isinstance(output.get("warnings"), list) else [],
        "raw_output": dict(output),
    }


def write_comparison_artifact(out_dir: Path, rel_dir: Path, artifact: Mapping[str, Any]) -> str | None:
    detectors = artifact.get("detectors") if isinstance(artifact.get("detectors"), dict) else {}
    raw_output = artifact.get("raw_output") if isinstance(artifact.get("raw_output"), dict) else {}
    comparison = raw_output.get("comparison") if isinstance(raw_output.get("comparison"), dict) else None
    llm_evaluation = artifact.get("llm_evaluation") if isinstance(artifact.get("llm_evaluation"), dict) else None
    if comparison is None and llm_evaluation is None:
        return None
    comparison_payload = {
        "schema_version": "thyroid.detector.comparison.v1",
        "primary": detectors.get("primary"),
        "comparators": detectors.get("comparators", []),
        "comparison": comparison,
        "quality_gate": comparison.get("quality_gate") if isinstance(comparison, dict) else None,
        "llm_evaluation": llm_evaluation,
    }
    comparison_path = out_dir / "comparison.json"
    comparison_path.write_text(json.dumps(comparison_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"artifact://{(rel_dir / 'comparison.json').as_posix()}"


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


def detector_artifact_evaluation(comparison: Mapping[str, Any], detections: list[JsonDict]) -> JsonDict:
    quality_gate = comparison.get("quality_gate") if isinstance(comparison.get("quality_gate"), dict) else None
    consensus = comparison.get("consensus") if isinstance(comparison.get("consensus"), dict) else {}
    return {
        "protocol": "thyroid.detector.evaluation.v1",
        "status": string_or_none(quality_gate.get("status")) if quality_gate else "single_model_review",
        "consensus_status": string_or_none(consensus.get("status")) or "single_model_only",
        "detection_count": len(detections),
        "requires_doctor_review": True,
        "review_reasons": quality_gate.get("review_reasons", ["single_model_or_unavailable_comparator"]) if quality_gate else ["single_model_or_unavailable_comparator"],
    }


def normalize_segmentations(value: Any) -> list[JsonDict]:
    if not isinstance(value, list):
        return []
    segmentations: list[JsonDict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        segmentations.append(
            {
                "nodule_id": string_or_none(item.get("nodule_id")),
                "nodule_index": int(item.get("nodule_index") or index),
                "bbox": normalize_bbox(item.get("bbox")),
                "contour": normalize_contour(item.get("contour")),
                "mask_uri": string_or_none(item.get("mask_uri")),
                "confidence": number_or_none(item.get("confidence")),
                "segmentation_source": string_or_none(item.get("segmentation_source")) or "unknown",
                "model_name": string_or_none(item.get("model_name")),
                "model_version": string_or_none(item.get("model_version")),
                "requires_doctor_review": bool(item.get("requires_doctor_review", True)),
                "metadata": item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
            }
        )
    return segmentations


def segmentation_artifact_evaluation(segmentations: list[JsonDict], warnings: list[Any], model: Mapping[str, Any]) -> JsonDict:
    sources = {string_or_none(item.get("segmentation_source")) or "unknown" for item in segmentations}
    fallback_used = "bbox_fallback" in sources
    warning_text = [str(item) for item in warnings]
    if not segmentations:
        status = "blocked_real_model_unavailable" if any("fallback_disabled" in item for item in warning_text) else "no_segmentation"
    elif fallback_used:
        status = "validation_fallback_requires_review"
    else:
        status = "real_model_result_requires_review"
    return {
        "protocol": "thyroid.segmentation.evaluation.v1",
        "status": status,
        "primary_model": string_or_none(model.get("name")) or "unknown",
        "segmentation_count": len(segmentations),
        "fallback_used": fallback_used,
        "requires_doctor_review": True,
        "review_reasons": segmentation_review_reasons(segmentations, warning_text, fallback_used),
    }


def segmentation_review_reasons(segmentations: list[JsonDict], warnings: list[str], fallback_used: bool) -> list[str]:
    reasons: list[str] = []
    if not segmentations:
        reasons.append("no_segmentation_output")
    if fallback_used:
        reasons.append("bbox_fallback_mask_not_real_segmentation")
    if warnings:
        reasons.append("segmentation_warnings_present")
    if any(item.get("requires_doctor_review") for item in segmentations):
        reasons.append("segmenter_marked_doctor_review")
    return sorted(set(reasons or ["medical_result_requires_doctor_review"]))


def video_segmentation_artifact_evaluation(tracks: list[JsonDict], warnings: list[Any], model: Mapping[str, Any]) -> JsonDict:
    frame_count = sum(len(track.get("frames", [])) for track in tracks if isinstance(track.get("frames"), list))
    sources = {
        string_or_none(track.get("segmentation_source")) or "unknown"
        for track in tracks
    }
    fallback_used = any("fallback" in source for source in sources)
    warning_text = [str(item) for item in warnings]
    if not tracks:
        status = "blocked_video_model_unavailable" if any("fallback_disabled" in item for item in warning_text) else "no_video_segmentation"
    elif fallback_used:
        status = "validation_fallback_requires_review"
    else:
        status = "real_video_model_result_requires_review"
    return {
        "protocol": "thyroid.video_segmentation.evaluation.v1",
        "status": status,
        "primary_model": string_or_none(model.get("name")) or "unknown",
        "track_count": len(tracks),
        "frame_count": frame_count,
        "fallback_used": fallback_used,
        "requires_doctor_review": True,
        "review_reasons": video_segmentation_review_reasons(tracks, warning_text, fallback_used),
    }


def video_segmentation_review_reasons(tracks: list[JsonDict], warnings: list[str], fallback_used: bool) -> list[str]:
    reasons: list[str] = []
    if not tracks:
        reasons.append("no_video_segmentation_output")
    if fallback_used:
        reasons.append("framewise_or_bbox_fallback_not_real_video_propagation")
    if warnings:
        reasons.append("video_segmentation_warnings_present")
    if any(track.get("requires_doctor_review") for track in tracks):
        reasons.append("video_segmenter_marked_doctor_review")
    return sorted(set(reasons or ["medical_video_result_requires_doctor_review"]))


def measurement_artifact_evaluation(
    output: Mapping[str, Any],
    *,
    protocol: str = "thyroid.measurement.evaluation.v1",
) -> JsonDict:
    measurements = output.get("measurements") if isinstance(output.get("measurements"), list) else []
    warnings = [str(item) for item in output.get("warnings", [])] if isinstance(output.get("warnings"), list) else []
    pixel_spacing = output.get("pixel_spacing") if isinstance(output.get("pixel_spacing"), dict) else {}
    has_spacing = bool(pixel_spacing)
    has_mm = any(measurement_has_mm(item) for item in measurements if isinstance(item, dict))
    if not measurements:
        status = "no_measurement"
    elif has_mm:
        status = "mm_measurement_available"
    elif has_spacing:
        status = "measurement_missing_mm_review"
    else:
        status = "pixel_only_requires_calibration"
    return {
        "protocol": protocol,
        "status": status,
        "measurement_count": len(measurements),
        "pixel_spacing_available": has_spacing,
        "mm_measurement_available": has_mm,
        "requires_doctor_review": True,
        "review_reasons": measurement_review_reasons(measurements, warnings, has_spacing, has_mm),
    }


def measurement_has_mm(item: Mapping[str, Any]) -> bool:
    keys = ("long_axis_mm", "short_axis_mm", "ap_axis_mm", "area_mm2")
    return any(number_or_none(item.get(key)) is not None for key in keys)


def measurement_review_reasons(
    measurements: list[Any],
    warnings: list[str],
    has_spacing: bool,
    has_mm: bool,
) -> list[str]:
    reasons: list[str] = []
    if not measurements:
        reasons.append("no_measurement_output")
    if not has_spacing:
        reasons.append("pixel_spacing_missing")
    if not has_mm:
        reasons.append("mm_measurement_unavailable")
    if warnings:
        reasons.append("measurement_warnings_present")
    return sorted(set(reasons or ["medical_measurement_requires_doctor_review"]))


def normalize_video_tracks(value: Any) -> list[JsonDict]:
    if not isinstance(value, list):
        return []
    tracks: list[JsonDict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        track_id = string_or_none(item.get("track_id")) or f"track_{index:03d}"
        frames = normalize_video_frames(item.get("frames"))
        tracks.append(
            {
                "track_id": track_id,
                "nodule_id": string_or_none(item.get("nodule_id")),
                "prompt_frame_index": int(item.get("prompt_frame_index") or 0),
                "prompt_bbox": normalize_bbox(item.get("prompt_bbox")),
                "prompt_source": string_or_none(item.get("prompt_source")),
                "segmentation_source": string_or_none(item.get("segmentation_source")) or "unknown",
                "model_name": string_or_none(item.get("model_name")),
                "model_version": string_or_none(item.get("model_version")),
                "frames": frames,
                "quality": item.get("quality") if isinstance(item.get("quality"), dict) else {},
                "requires_doctor_review": bool(item.get("requires_doctor_review", True)),
            }
        )
    return tracks


def normalize_video_frames(value: Any) -> list[JsonDict]:
    if not isinstance(value, list):
        return []
    frames: list[JsonDict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        frames.append(
            {
                "frame_index": int(item.get("frame_index") or 0),
                "time_ms": number_or_none(item.get("time_ms")),
                "bbox": normalize_bbox(item.get("bbox")),
                "contour": normalize_contour(item.get("contour")),
                "mask_uri": string_or_none(item.get("mask_uri")),
                "confidence": number_or_none(item.get("confidence")),
                "segmentation_source": string_or_none(item.get("segmentation_source")) or "unknown",
                "requires_doctor_review": bool(item.get("requires_doctor_review", True)),
            }
        )
    return frames


def normalize_contour(value: Any) -> list[list[float]]:
    if not isinstance(value, list):
        return []
    contour: list[list[float]] = []
    for point in value:
        if not isinstance(point, list) or len(point) < 2:
            return []
        x = number_or_none(point[0])
        y = number_or_none(point[1])
        if x is None or y is None:
            return []
        contour.append([x, y])
    return contour if len(contour) >= 3 else []


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


def write_segmentation_masks(root: Path, rel_dir: Path, artifact: JsonDict) -> list[str]:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return ["mask_unavailable:pillow_missing"]
    source_uri = string_or_none(artifact.get("source_image_uri"))
    width, height = source_dimensions(source_uri, root)
    warnings: list[str] = []
    masks: list[str] = []
    segmentations = artifact.get("segmentations") if isinstance(artifact.get("segmentations"), list) else []
    for index, segmentation in enumerate(segmentations, start=1):
        if not isinstance(segmentation, dict):
            continue
        contour = normalize_contour(segmentation.get("contour"))
        if not contour:
            warnings.append(f"mask_unavailable:contour_missing:{index}")
            continue
        mask = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(mask)
        draw.polygon([tuple(point) for point in contour], fill=255)
        mask_rel = rel_dir / f"mask_nodule_{int(segmentation.get('nodule_index') or index)}.png"
        mask_path = root / mask_rel
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        mask.save(mask_path)
        mask_uri = f"artifact://{mask_rel.as_posix()}"
        segmentation["mask_uri"] = mask_uri
        masks.append(mask_uri)
    artifacts = artifact.get("artifacts")
    if isinstance(artifacts, dict):
        artifacts["mask_images"] = masks
    return warnings


def write_video_segmentation_masks(root: Path, rel_dir: Path, artifact: JsonDict) -> list[str]:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return ["video_mask_unavailable:pillow_missing"]
    warnings: list[str] = []
    masks: list[str] = []
    width, height = video_frame_dimensions(artifact)
    tracks = artifact.get("tracks") if isinstance(artifact.get("tracks"), list) else []
    for track_index, track in enumerate(tracks, start=1):
        if not isinstance(track, dict):
            continue
        track_id = string_or_none(track.get("track_id")) or f"track_{track_index:03d}"
        frames = track.get("frames") if isinstance(track.get("frames"), list) else []
        for frame in frames:
            if not isinstance(frame, dict):
                continue
            contour = normalize_contour(frame.get("contour"))
            frame_index = int(frame.get("frame_index") or 0)
            if not contour:
                warnings.append(f"video_mask_unavailable:contour_missing:{track_id}:{frame_index}")
                continue
            mask = Image.new("L", (width, height), 0)
            draw = ImageDraw.Draw(mask)
            draw.polygon([tuple(point) for point in contour], fill=255)
            mask_rel = rel_dir / f"track_{safe_segment(track_id)}" / f"frame_{frame_index:06d}.png"
            mask_path = root / mask_rel
            mask_path.parent.mkdir(parents=True, exist_ok=True)
            mask.save(mask_path)
            mask_uri = f"artifact://{mask_rel.as_posix()}"
            frame["mask_uri"] = mask_uri
            masks.append(mask_uri)
    artifacts = artifact.get("artifacts")
    if isinstance(artifacts, dict):
        artifacts["mask_images"] = masks
    return warnings


def video_frame_dimensions(artifact: Mapping[str, Any]) -> tuple[int, int]:
    video = artifact.get("video") if isinstance(artifact.get("video"), dict) else {}
    width = int(video.get("frame_width") or 0) if isinstance(video.get("frame_width"), (int, float)) else 0
    height = int(video.get("frame_height") or 0) if isinstance(video.get("frame_height"), (int, float)) else 0
    if width > 0 and height > 0:
        return width, height
    return 1024, 1024


def source_dimensions(source_uri: str | None, root: Path) -> tuple[int, int]:
    if not source_uri:
        return 1024, 1024
    try:
        from PIL import Image
        source_path = resolve_image_uri(source_uri, root)
        if source_path.exists():
            with Image.open(source_path) as image:
                return image.size
    except Exception:
        pass
    return 1024, 1024


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
