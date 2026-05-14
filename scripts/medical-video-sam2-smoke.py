#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pydicom
from PIL import Image

from app.artifacts import write_video_measurement_artifact, write_video_segmentation_artifact
from app.segmentation import run_measure_video_job, run_segment_video_job


DEFAULT_CASE_ID = "final-validation-local-thyroid-case-001"
DEFAULT_STUDY_ID = "VIDEO_SAM2_SMOKE_CASE001"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run SAM2 video segmentation smoke on local thyroid DICOM videos.")
    parser.add_argument("--artifact-root", default="data/artifacts")
    parser.add_argument("--case-id", default=DEFAULT_CASE_ID)
    parser.add_argument("--study-id", default=DEFAULT_STUDY_ID)
    parser.add_argument("--output-dir", default="reports/video-sam2-smoke-case001")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact_root = Path(args.artifact_root).expanduser().resolve()
    case_id = args.case_id
    specs = [
        {
            "video_id": "Q4DDKKO8",
            "prompt_frame_index": 57,
            "bbox": [495.0, 180.0, 640.0, 320.0],
        },
        {
            "video_id": "Q4DDKKOA",
            "prompt_frame_index": 51,
            "bbox": [635.0, 245.0, 805.0, 360.0],
        },
    ]

    summary: list[dict[str, Any]] = []
    for spec in specs:
        summary.append(run_video_case(artifact_root, case_id, args.study_id, spec))

    out_dir = artifact_root / args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = out_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"SUMMARY {summary_path}", flush=True)


def run_video_case(artifact_root: Path, case_id: str, study_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    video_id = str(spec["video_id"])
    dicom_path = artifact_root / "datasets" / case_id / "dicom" / "video" / video_id
    frame_dir = artifact_root / "model-ready" / "video" / case_id / f"{video_id}_frames"
    frame_count = ensure_frame_dir(dicom_path, frame_dir)
    video_uri = "artifact://" + frame_dir.relative_to(artifact_root).as_posix()
    bbox = [float(item) for item in spec["bbox"]]
    prompt_frame_index = int(spec["prompt_frame_index"])

    segment_job = {
        "id": f"mj_video_sam2_{video_id}",
        "job_type": "thyroid.segment_video_nodule",
        "study_id": study_id,
        "image_id": video_id,
        "model_name": "sam2-video-thyroid-segmenter",
        "model_version": "sam2.1-hiera-large-bbox-prompt",
        "weights_hash": None,
        "input_json": json.dumps(
            {
                "study_id": study_id,
                "video_id": video_id,
                "video_uri": video_uri,
                "targets": [
                    {
                        "nodule_id": f"{video_id}-N1",
                        "track_id": "track_001",
                        "prompt_frame_index": prompt_frame_index,
                        "bbox": bbox,
                        "confidence": 0.7,
                        "prompt_source": "manual_mid_frame_bbox_smoke",
                    }
                ],
                "frame_range": {"start": 0, "end": frame_count - 1, "stride": 1},
                "allow_framewise_fallback": False,
                "return_masks": True,
                "metadata": {
                    "case_id": case_id,
                    "source_dicom": str(dicom_path),
                    "prompt_note": "Manual rough bbox from mid-frame preview; requires doctor review before training use.",
                },
                "trace_id": f"video-sam2-smoke-{video_id}",
            },
            ensure_ascii=False,
        ),
    }
    print(f"SEGMENT_START {video_id} frames={frame_count} uri={video_uri}", flush=True)
    segmentation_output = run_segment_video_job(segment_job)
    segmentation_artifact = write_video_segmentation_artifact(segment_job, segmentation_output, worker_id="video-sam2-smoke")
    segmentation_uri = str(segmentation_artifact["artifact_uri"])

    measure_job = {
        "id": f"mj_video_measure_{video_id}",
        "job_type": "thyroid.measure_video_nodule",
        "study_id": study_id,
        "image_id": video_id,
        "model_name": "video-mask-measurement-worker",
        "model_version": "video-measurement-v1",
        "weights_hash": None,
        "input_json": json.dumps(
            {
                "study_id": study_id,
                "video_id": video_id,
                "segmentation_uri": segmentation_uri,
                "pixel_spacing": None,
                "measurement_policy": "max_long_axis_high_confidence",
                "metadata": {"case_id": case_id},
                "trace_id": f"video-measure-smoke-{video_id}",
            },
            ensure_ascii=False,
        ),
    }
    print(f"MEASURE_START {video_id} segmentation={segmentation_uri}", flush=True)
    measurement_output = run_measure_video_job(measure_job)
    measurement_artifact = write_video_measurement_artifact(measure_job, measurement_output, worker_id="video-sam2-smoke")

    tracks = segmentation_artifact["artifact"].get("tracks", [])
    measurements = measurement_artifact["artifact"].get("measurements", [])
    result = {
        "video_id": video_id,
        "frame_count": frame_count,
        "prompt_frame_index": prompt_frame_index,
        "prompt_bbox": bbox,
        "segmentation_uri": segmentation_uri,
        "measurement_uri": measurement_artifact["artifact_uri"],
        "track_count": len(tracks),
        "segmented_frame_count": sum(len(track.get("frames", [])) for track in tracks),
        "segmentation_warnings": segmentation_artifact["artifact"].get("warnings", []),
        "measurement_count": len(measurements),
        "measurement_warnings": measurement_artifact["artifact"].get("warnings", []),
        "selected_frame_index": measurements[0].get("selected_frame_index") if measurements else None,
        "long_axis_mm": measurements[0].get("long_axis_mm") if measurements else None,
        "short_axis_mm": measurements[0].get("short_axis_mm") if measurements else None,
    }
    print("DONE " + json.dumps(result, ensure_ascii=False), flush=True)
    return result


def ensure_frame_dir(dicom_path: Path, frame_dir: Path) -> int:
    frame_dir.mkdir(parents=True, exist_ok=True)
    existing_frames = sorted(frame_dir.glob("*.jpg"))
    if existing_frames:
        return len(existing_frames)

    ds = pydicom.dcmread(str(dicom_path), force=True)
    frames = ds.pixel_array
    for index, frame in enumerate(frames):
        Image.fromarray(frame).save(frame_dir / f"{index:05d}.jpg", quality=92)
    return len(frames)


if __name__ == "__main__":
    main()
