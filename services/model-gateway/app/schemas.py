from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


JsonDict = dict[str, Any]


class DetectNodulesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_id: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    image_uri: str = Field(min_length=1)
    agent_task_id: str | None = None
    model: str = "rf-detr-medium-thyroid-detector"
    model_version: str = "validation-placeholder"
    weights_hash: str | None = None
    return_overlay: bool = True
    priority: int = Field(default=100, ge=0, le=1000)
    max_attempts: int = Field(default=1, ge=1, le=5)
    metadata: JsonDict = Field(default_factory=dict)
    trace_id: str | None = None


class NoduleTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodule_id: str | None = None
    nodule_index: int | None = Field(default=None, ge=1)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    mask_uri: str | None = None
    contour: list[list[float]] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class VideoNoduleTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodule_id: str | None = None
    track_id: str | None = None
    prompt_frame_index: int = Field(default=0, ge=0)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    mask_uri: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    prompt_source: str | None = None


class VideoFrameRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: int = Field(default=0, ge=0)
    end: int | None = Field(default=None, ge=0)
    stride: int = Field(default=1, ge=1)


class SegmentNoduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_id: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    image_uri: str = Field(min_length=1)
    agent_task_id: str | None = None
    nodule_id: str | None = None
    nodule_index: int | None = Field(default=None, ge=1)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    nodules: list[NoduleTarget] = Field(default_factory=list)
    model: str = "nnunet-tight-roi-segmenter"
    model_version: str = "tn3k-tight-roi-5fold-best"
    weights_hash: str | None = None
    allow_bbox_fallback: bool = True
    return_mask: bool = True
    priority: int = Field(default=110, ge=0, le=1000)
    max_attempts: int = Field(default=1, ge=1, le=5)
    metadata: JsonDict = Field(default_factory=dict)
    trace_id: str | None = None


class SegmentVideoNoduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_id: str = Field(min_length=1)
    video_id: str = Field(min_length=1)
    video_uri: str = Field(min_length=1)
    frame_manifest_uri: str | None = None
    agent_task_id: str | None = None
    targets: list[VideoNoduleTarget] = Field(default_factory=list)
    frame_range: VideoFrameRange = Field(default_factory=VideoFrameRange)
    model: str = "video-bbox-fallback-segmenter"
    model_version: str = "validation-video-bbox-fallback"
    weights_hash: str | None = None
    allow_framewise_fallback: bool = True
    return_masks: bool = True
    priority: int = Field(default=115, ge=0, le=1000)
    max_attempts: int = Field(default=1, ge=1, le=5)
    metadata: JsonDict = Field(default_factory=dict)
    trace_id: str | None = None


class MeasureNoduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_id: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    image_uri: str | None = None
    agent_task_id: str | None = None
    nodule_id: str | None = None
    nodule_index: int | None = Field(default=None, ge=1)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    mask_uri: str | None = None
    contour: list[list[float]] | None = None
    nodules: list[NoduleTarget] = Field(default_factory=list)
    pixel_spacing: JsonDict | list[float] | None = None
    model: str = "mask-measurement-worker"
    model_version: str = "validation-measurement-v1"
    weights_hash: str | None = None
    priority: int = Field(default=120, ge=0, le=1000)
    max_attempts: int = Field(default=1, ge=1, le=5)
    metadata: JsonDict = Field(default_factory=dict)
    trace_id: str | None = None


class MeasureVideoNoduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_id: str = Field(min_length=1)
    video_id: str = Field(min_length=1)
    segmentation_uri: str = Field(min_length=1)
    agent_task_id: str | None = None
    pixel_spacing: JsonDict | list[float] | None = None
    measurement_policy: str = "max_long_axis_high_confidence"
    model: str = "video-mask-measurement-worker"
    model_version: str = "validation-video-measurement-v1"
    weights_hash: str | None = None
    priority: int = Field(default=125, ge=0, le=1000)
    max_attempts: int = Field(default=1, ge=1, le=5)
    metadata: JsonDict = Field(default_factory=dict)
    trace_id: str | None = None


class GatewayError(BaseModel):
    code: str
    message: str
    detail: JsonDict = Field(default_factory=dict)


class GatewayResponse(BaseModel):
    status: Literal["ok", "error"]
    result: JsonDict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    trace_id: str | None = None
    error: GatewayError | None = None


def ok(result: JsonDict, *, trace_id: str | None = None, warnings: list[str] | None = None) -> GatewayResponse:
    return GatewayResponse(status="ok", result=result, warnings=warnings or [], trace_id=trace_id)


def error(
    code: str,
    message: str,
    *,
    trace_id: str | None = None,
    detail: JsonDict | None = None,
    warnings: list[str] | None = None,
) -> GatewayResponse:
    return GatewayResponse(
        status="error",
        result={},
        warnings=warnings or [],
        trace_id=trace_id,
        error=GatewayError(code=code, message=message, detail=detail or {}),
    )
