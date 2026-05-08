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
    model: str = "yolov11-thyroid-detector"
    model_version: str = "validation-placeholder"
    weights_hash: str | None = None
    return_overlay: bool = True
    priority: int = Field(default=100, ge=0, le=1000)
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
