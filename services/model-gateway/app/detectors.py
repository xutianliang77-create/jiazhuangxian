from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Protocol


JsonDict = dict[str, Any]


@dataclass(frozen=True)
class DetectorRequest:
    study_id: str
    image_id: str
    image_uri: str
    return_overlay: bool = True
    metadata: JsonDict = field(default_factory=dict)
    trace_id: str | None = None


class DetectorAdapter(Protocol):
    adapter_name: str
    model_family: str
    required_env: tuple[str, ...]

    def detect(self, request: DetectorRequest) -> JsonDict:
        ...


class DetectorAdapterError(Exception):
    def __init__(self, code: str, message: str, *, detail: JsonDict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def to_error(self, *, worker_id: str) -> JsonDict:
        return {
            "code": self.code,
            "message": self.message,
            "detail": {
                "worker_id": worker_id,
                **self.detail,
            },
        }


class BaseDetectorAdapter:
    adapter_name = "base-detector"
    model_family = "unknown"
    required_env: tuple[str, ...] = ()

    def __init__(
        self,
        *,
        model_name: str | None,
        model_version: str | None,
        weights_hash: str | None,
        env: Mapping[str, str] | None = None,
    ) -> None:
        self.model_name = model_name or self.model_family
        self.model_version = model_version or "validation-placeholder"
        self.weights_hash = weights_hash
        self.env = os.environ if env is None else env

    def weights_path(self) -> Path:
        for key in self.required_env:
            raw = self.env.get(key)
            if raw:
                return Path(raw).expanduser()
        raise DetectorAdapterError(
            "detector_not_configured",
            f"{self.model_family} detector weights are not configured",
            detail={
                "adapter": self.adapter_name,
                "model_family": self.model_family,
                "model_name": self.model_name,
                "model_version": self.model_version,
                "required_env": list(self.required_env),
            },
        )

    def common_output(self, detections: list[JsonDict]) -> JsonDict:
        return {
            "nodules": detections,
            "model": {
                "adapter": self.adapter_name,
                "family": self.model_family,
                "name": self.model_name,
                "version": self.model_version,
                "weights_hash": self.weights_hash,
            },
            "warnings": [],
        }

    def resolve_image_path(self, image_uri: str) -> Path:
        if image_uri.startswith("artifact://"):
            artifact_root = Path(self.env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()
            return artifact_root / image_uri.removeprefix("artifact://")
        if image_uri.startswith("file://"):
            return Path(image_uri.removeprefix("file://")).expanduser()
        return Path(image_uri).expanduser()


class YoloV11DetectorAdapter(BaseDetectorAdapter):
    adapter_name = "yolov11-ultralytics"
    model_family = "yolov11"
    required_env = ("JZX_YOLOV11_WEIGHTS",)

    def detect(self, request: DetectorRequest) -> JsonDict:
        weights = self.weights_path()
        image_path = self.resolve_image_path(request.image_uri)
        try:
            from ultralytics import YOLO  # type: ignore[import-not-found]
        except ImportError as exc:
            raise runtime_unavailable(self, "ultralytics", weights, image_path) from exc

        model = YOLO(str(weights))
        results = model.predict(str(image_path), verbose=False)
        return self.common_output(format_ultralytics_boxes(results, self.model_name, self.model_version))


class RtDetrDetectorAdapter(BaseDetectorAdapter):
    adapter_name = "rtdetr-ultralytics"
    model_family = "rt-detr"
    required_env = ("JZX_RTDETR_WEIGHTS",)

    def detect(self, request: DetectorRequest) -> JsonDict:
        weights = self.weights_path()
        image_path = self.resolve_image_path(request.image_uri)
        try:
            from ultralytics import RTDETR  # type: ignore[import-not-found]
        except ImportError as exc:
            raise runtime_unavailable(self, "ultralytics", weights, image_path) from exc

        model = RTDETR(str(weights))
        results = model.predict(str(image_path), verbose=False)
        return self.common_output(format_ultralytics_boxes(results, self.model_name, self.model_version))


class RfDetrDetectorAdapter(BaseDetectorAdapter):
    adapter_name = "rf-detr"
    model_family = "rf-detr"
    required_env = ("JZX_RFDETR_WEIGHTS",)

    def detect(self, request: DetectorRequest) -> JsonDict:
        weights = self.weights_path()
        image_path = self.resolve_image_path(request.image_uri)
        raise DetectorAdapterError(
            "detector_runtime_unavailable",
            "RF-DETR runtime is not installed in the validation worker",
            detail={
                "adapter": self.adapter_name,
                "model_family": self.model_family,
                "model_name": self.model_name,
                "model_version": self.model_version,
                "weights_path": str(weights),
                "image_path": str(image_path),
                "required_package": "rfdetr",
            },
        )


def select_detector_adapter(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> DetectorAdapter:
    model_name = str(job.get("model_name") or "yolov11-thyroid-detector")
    normalized = model_name.lower().replace("_", "-")
    kwargs = {
        "model_name": model_name,
        "model_version": string_or_none(job.get("model_version")),
        "weights_hash": string_or_none(job.get("weights_hash")),
        "env": env,
    }
    if "rf-detr" in normalized or "rfdetr" in normalized:
        return RfDetrDetectorAdapter(**kwargs)
    if "rt-detr" in normalized or "rtdetr" in normalized:
        return RtDetrDetectorAdapter(**kwargs)
    return YoloV11DetectorAdapter(**kwargs)


def build_detector_request(job: Mapping[str, Any]) -> DetectorRequest:
    payload = parse_json_object(job.get("input_json"))
    return DetectorRequest(
        study_id=required_payload_string(payload, "study_id"),
        image_id=required_payload_string(payload, "image_id"),
        image_uri=required_payload_string(payload, "image_uri"),
        return_overlay=bool(payload.get("return_overlay", True)),
        metadata=parse_json_object(payload.get("metadata")),
        trace_id=string_or_none(payload.get("trace_id")),
    )


def run_detector_job(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> JsonDict:
    adapter = select_detector_adapter(job, env)
    request = build_detector_request(job)
    return adapter.detect(request)


def format_ultralytics_boxes(results: Any, model_name: str, model_version: str) -> list[JsonDict]:
    detections: list[JsonDict] = []
    for result in results:
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            continue
        xyxy = tensor_to_list(getattr(boxes, "xyxy", []))
        conf = tensor_to_list(getattr(boxes, "conf", []))
        cls = tensor_to_list(getattr(boxes, "cls", []))
        for index, coords in enumerate(xyxy):
            if len(coords) != 4:
                continue
            detections.append(
                {
                    "nodule_index": len(detections) + 1,
                    "bbox": [float(value) for value in coords],
                    "confidence": float(conf[index]) if index < len(conf) else None,
                    "class_id": int(cls[index]) if index < len(cls) else None,
                    "source": "ai",
                    "model_name": model_name,
                    "model_version": model_version,
                }
            )
    return detections


def runtime_unavailable(
    adapter: BaseDetectorAdapter,
    package_name: str,
    weights: Path,
    image_path: Path,
) -> DetectorAdapterError:
    return DetectorAdapterError(
        "detector_runtime_unavailable",
        f"{package_name} is required to run the {adapter.model_family} detector",
        detail={
            "adapter": adapter.adapter_name,
            "model_family": adapter.model_family,
            "model_name": adapter.model_name,
            "model_version": adapter.model_version,
            "weights_path": str(weights),
            "image_path": str(image_path),
            "required_package": package_name,
        },
    )


def tensor_to_list(value: Any) -> list[Any]:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "tolist"):
        listed = value.tolist()
        return listed if isinstance(listed, list) else [listed]
    return value if isinstance(value, list) else []


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


def required_payload_string(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise DetectorAdapterError(
            "invalid_detector_input",
            f"detector input is missing {key}",
            detail={"missing_field": key},
        )
    return value


def string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None
