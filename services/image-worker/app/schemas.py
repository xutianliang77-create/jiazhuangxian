from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


JsonDict = dict[str, Any]


class ImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_id: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    image_uri: str = Field(min_length=1)
    metadata: JsonDict = Field(default_factory=dict)
    trace_id: str | None = None


class OutputImageRequest(ImageRequest):
    output_uri: str | None = None


class RenderPreviewRequest(OutputImageRequest):
    max_size: int = Field(default=1024, ge=128, le=4096)


class PreprocessUltrasoundRequest(OutputImageRequest):
    target_size: int = Field(default=1024, ge=128, le=4096)
    normalize: bool = True


class WorkerError(BaseModel):
    code: str
    message: str
    detail: JsonDict = Field(default_factory=dict)


class WorkerResponse(BaseModel):
    status: Literal["ok", "error"]
    result: JsonDict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    trace_id: str | None = None
    error: WorkerError | None = None


def ok(result: JsonDict, *, trace_id: str | None = None, warnings: list[str] | None = None) -> WorkerResponse:
    return WorkerResponse(status="ok", result=result, warnings=warnings or [], trace_id=trace_id)


def error(
    code: str,
    message: str,
    *,
    trace_id: str | None = None,
    detail: JsonDict | None = None,
    warnings: list[str] | None = None,
) -> WorkerResponse:
    return WorkerResponse(
        status="error",
        result={},
        warnings=warnings or [],
        trace_id=trace_id,
        error=WorkerError(code=code, message=message, detail=detail or {}),
    )
