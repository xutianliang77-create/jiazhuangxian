from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Protocol


JsonDict = dict[str, Any]
MODEL_DEVICE_ENV = "JZX_MODEL_DEVICE"
DEFAULT_PRIMARY_DETECTOR = "rf-detr-medium-thyroid-detector"
DEFAULT_COMPARATOR_DETECTOR = "yolov11-thyroid-detector"
RFDETR_RESOLUTION_ENV = "JZX_RFDETR_RESOLUTION"
DETECTOR_CONFIDENCE_ENV = "JZX_DETECTOR_CONFIDENCE"


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
                "device": self.model_device() or "auto",
            },
            "warnings": [],
        }

    def model_device(self) -> str | None:
        raw = self.env.get(MODEL_DEVICE_ENV)
        if raw is None:
            return None
        stripped = raw.strip()
        return stripped or None

    def predict_options(self) -> JsonDict:
        options: JsonDict = {"verbose": False}
        device = self.model_device()
        if device:
            options["device"] = device
        return options

    def confidence_threshold(self, request: DetectorRequest) -> float:
        raw = request.metadata.get("confidence_threshold")
        if raw is None:
            raw = self.env.get(DETECTOR_CONFIDENCE_ENV)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return 0.25
        return min(max(value, 0.0), 1.0)

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
        results = model.predict(str(image_path), **self.predict_options())
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
        results = model.predict(str(image_path), **self.predict_options())
        return self.common_output(format_ultralytics_boxes(results, self.model_name, self.model_version))


class RfDetrDetectorAdapter(BaseDetectorAdapter):
    adapter_name = "rf-detr"
    model_family = "rf-detr"
    required_env = ("JZX_RFDETR_WEIGHTS",)

    def detect(self, request: DetectorRequest) -> JsonDict:
        weights = self.weights_path()
        image_path = self.resolve_image_path(request.image_uri)
        try:
            import rfdetr  # type: ignore[import-not-found]
        except ImportError as exc:
            raise runtime_unavailable(self, "rfdetr", weights, image_path) from exc

        model_class = getattr(rfdetr, "RFDETRMedium", None)
        if model_class is None:
            raise runtime_unavailable(self, "rfdetr", weights, image_path)
        resolution = self.rfdetr_resolution()
        model = model_class(
            pretrain_weights=str(weights),
            num_classes=1,
            resolution=resolution,
            device=self.rfdetr_device(),
        )
        predict_path, cleanup_path = rgb_compatible_image_path(image_path)
        try:
            detections = model.predict(
                str(predict_path),
                threshold=self.confidence_threshold(request),
                shape=(resolution, resolution),
            )
            return self.common_output(format_rfdetr_boxes(detections, self.model_name, self.model_version))
        finally:
            if cleanup_path is not None:
                cleanup_path.unlink(missing_ok=True)

    def rfdetr_resolution(self) -> int:
        raw = self.env.get(RFDETR_RESOLUTION_ENV)
        try:
            value = int(raw) if raw else 576
        except ValueError:
            value = 576
        return value if value > 0 else 576

    def rfdetr_device(self) -> str:
        device = self.model_device()
        if device is None:
            return "cuda"
        if device.isdigit():
            return f"cuda:{device}"
        return device


def select_detector_adapter(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> DetectorAdapter:
    model_name = str(job.get("model_name") or DEFAULT_PRIMARY_DETECTOR)
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
    source_env = os.environ if env is None else env
    adapter = select_detector_adapter(job, env)
    request = build_detector_request(job)
    primary_output = adapter.detect(request)
    if adapter.model_family != "rf-detr":
        return primary_output
    return with_yolo_comparator(primary_output, job, request, source_env)


def with_yolo_comparator(
    primary_output: JsonDict,
    job: Mapping[str, Any],
    request: DetectorRequest,
    env: Mapping[str, str],
) -> JsonDict:
    comparator_job = {
        **job,
        "model_name": DEFAULT_COMPARATOR_DETECTOR,
        "model_version": "validation-comparator",
        "weights_hash": None,
    }
    try:
        comparator_output = YoloV11DetectorAdapter(
            model_name=DEFAULT_COMPARATOR_DETECTOR,
            model_version="validation-comparator",
            weights_hash=None,
            env=env,
        ).detect(request)
    except DetectorAdapterError as exc:
        warnings = list_warnings(primary_output)
        warnings.append(f"comparator_unavailable:yolov11:{exc.code}")
        return {
            **primary_output,
            "warnings": warnings,
            "comparison": build_detection_comparison(
                primary_output,
                None,
                warning=exc.to_error(worker_id="model-worker"),
            ),
            "llm_evaluation": build_llm_evaluation_pack(
                primary_output,
                None,
                build_detection_comparison(primary_output, None, warning=exc.to_error(worker_id="model-worker")),
            ),
        }

    comparison = build_detection_comparison(primary_output, comparator_output)
    return {
        **primary_output,
        "warnings": list_warnings(primary_output),
        "comparison": comparison,
        "llm_evaluation": build_llm_evaluation_pack(primary_output, comparator_output, comparison),
        "comparator_output": comparator_output,
        "comparator_job": {
            "model_name": comparator_job["model_name"],
            "model_version": comparator_job["model_version"],
        },
    }


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


def format_rfdetr_boxes(detections: Any, model_name: str, model_version: str) -> list[JsonDict]:
    if isinstance(detections, list):
        if not detections:
            return []
        detections = detections[0]
    xyxy = tensor_to_list(getattr(detections, "xyxy", []))
    confidence = tensor_to_list(getattr(detections, "confidence", []))
    class_id = tensor_to_list(getattr(detections, "class_id", []))
    data = getattr(detections, "data", {})
    class_names = tensor_to_list(data.get("class_name", [])) if isinstance(data, dict) else []
    formatted: list[JsonDict] = []
    for index, coords in enumerate(xyxy):
        if len(coords) != 4:
            continue
        item: JsonDict = {
            "nodule_index": len(formatted) + 1,
            "bbox": [float(value) for value in coords],
            "confidence": float(confidence[index]) if index < len(confidence) else None,
            "class_id": int(class_id[index]) if index < len(class_id) else None,
            "source": "ai",
            "model_name": model_name,
            "model_version": model_version,
        }
        if index < len(class_names):
            item["class_name"] = str(class_names[index])
        formatted.append(item)
    return formatted


def build_detection_comparison(
    primary_output: Mapping[str, Any],
    comparator_output: Mapping[str, Any] | None,
    *,
    warning: JsonDict | None = None,
) -> JsonDict:
    primary = normalize_comparison_detections(primary_output.get("nodules"))
    comparator = normalize_comparison_detections(comparator_output.get("nodules")) if comparator_output else []
    matches: list[JsonDict] = []
    matched_primary: set[int] = set()
    matched_comparator: set[int] = set()
    for primary_index, primary_detection in enumerate(primary):
        best_index: int | None = None
        best_iou = 0.0
        for comparator_index, comparator_detection in enumerate(comparator):
            if comparator_index in matched_comparator:
                continue
            iou = bbox_iou(primary_detection["bbox"], comparator_detection["bbox"])
            if iou > best_iou:
                best_iou = iou
                best_index = comparator_index
        if best_index is not None and best_iou >= 0.5:
            matched_primary.add(primary_index)
            matched_comparator.add(best_index)
            matches.append(
                {
                    "primary_detection_id": detection_id("primary", primary_index),
                    "comparator_detection_id": detection_id("yolo", best_index),
                    "iou": round(best_iou, 4),
                    "status": "matched",
                }
            )

    primary_only = [
        {
            "primary_detection_id": detection_id("primary", index),
            "bbox": detection["bbox"],
            "confidence": detection.get("confidence"),
            "status": "primary_only",
        }
        for index, detection in enumerate(primary)
        if index not in matched_primary
    ]
    comparator_only = [
        {
            "comparator_detection_id": detection_id("yolo", index),
            "bbox": detection["bbox"],
            "confidence": detection.get("confidence"),
            "status": "comparator_only",
        }
        for index, detection in enumerate(comparator)
        if index not in matched_comparator
    ]
    status = consensus_status(primary, comparator, matches, primary_only, comparator_only, warning)
    consensus = {
        "status": status,
        "matched_count": len(matches),
        "primary_only_count": len(primary_only),
        "comparator_only_count": len(comparator_only),
        "primary_count": len(primary),
        "comparator_count": len(comparator),
    }
    return {
        "evaluation_protocol": "thyroid.detector.dual_model_consensus.v1",
        "comparators": [comparator_output.get("model")] if comparator_output and isinstance(comparator_output.get("model"), dict) else [],
        "matches": matches,
        "primary_only": primary_only,
        "comparator_only": comparator_only,
        "consensus": consensus,
        "quality_gate": detection_quality_gate(consensus, warning),
        "warning": warning,
    }


def build_llm_evaluation_pack(
    primary_output: Mapping[str, Any],
    comparator_output: Mapping[str, Any] | None,
    comparison: Mapping[str, Any],
) -> JsonDict:
    consensus = comparison.get("consensus") if isinstance(comparison.get("consensus"), dict) else {}
    status = consensus.get("status")
    if status == "matched":
        assessment = "consistent"
    elif status in {"conflict", "primary_only", "comparator_only"}:
        assessment = "needs_review"
    else:
        assessment = "needs_review"
    return {
        "status": "pending_llm",
        "intended_model": "qwen3.6",
        "overall_assessment": assessment,
        "primary_model": primary_output.get("model"),
        "comparator_model": comparator_output.get("model") if comparator_output else None,
        "comparison_summary": consensus,
        "doctor_review_focus": doctor_review_focus(comparison),
        "constraints": [
            "LLM must not create, delete, or move bbox coordinates.",
            "LLM must explain conflicts from structured detector and ImageQC evidence only.",
            "Final bbox acceptance remains a doctor action.",
        ],
    }


def doctor_review_focus(comparison: Mapping[str, Any]) -> list[str]:
    focus: list[str] = []
    consensus = comparison.get("consensus") if isinstance(comparison.get("consensus"), dict) else {}
    if consensus.get("primary_only_count"):
        focus.append("Review RF-DETR primary-only nodules for true positives and small-nodule recall.")
    if consensus.get("comparator_only_count"):
        focus.append("Review YOLO comparator-only candidates as possible missed nodules or artifacts.")
    if consensus.get("status") == "matched":
        focus.append("Matched detections can be reviewed at lower priority unless ImageQC flags risk.")
    if not focus:
        focus.append("Review detector output against the original ultrasound image before report finalization.")
    return focus


def detection_quality_gate(consensus: Mapping[str, Any], warning: JsonDict | None) -> JsonDict:
    status = str(consensus.get("status") or "unknown")
    review_reasons: list[str] = []
    if warning is not None:
        review_reasons.append("comparator_unavailable")
    if status != "matched":
        review_reasons.append(f"detector_consensus_{status}")
    if consensus.get("primary_only_count"):
        review_reasons.append("primary_only_detections")
    if consensus.get("comparator_only_count"):
        review_reasons.append("comparator_only_detections")
    if status == "no_detections":
        review_reasons.append("no_nodule_detected_verify_image")
    return {
        "status": "pass" if status == "matched" and warning is None else "review",
        "iou_match_threshold": 0.5,
        "primary_role": "main_detector_rf_detr_medium",
        "comparator_role": "yolo11m_reference_detector",
        "requires_doctor_review": True,
        "review_reasons": sorted(set(review_reasons)),
    }


def consensus_status(
    primary: list[JsonDict],
    comparator: list[JsonDict],
    matches: list[JsonDict],
    primary_only: list[JsonDict],
    comparator_only: list[JsonDict],
    warning: JsonDict | None,
) -> str:
    if warning is not None:
        return "comparator_unavailable"
    if not primary and not comparator:
        return "no_detections"
    if matches and not primary_only and not comparator_only:
        return "matched"
    if primary_only and not comparator_only:
        return "primary_only"
    if comparator_only and not primary_only:
        return "comparator_only"
    return "conflict"


def normalize_comparison_detections(value: Any) -> list[JsonDict]:
    if not isinstance(value, list):
        return []
    normalized: list[JsonDict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            coords = [float(value) for value in bbox]
        except (TypeError, ValueError):
            continue
        normalized.append({"bbox": coords, "confidence": numeric_or_none(item.get("confidence"))})
    return normalized


def bbox_iou(left: list[float], right: list[float]) -> float:
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def detection_id(prefix: str, index: int) -> str:
    return f"{prefix}_{index + 1:03d}"


def list_warnings(output: Mapping[str, Any]) -> list[str]:
    raw = output.get("warnings")
    return list(raw) if isinstance(raw, list) else []


def numeric_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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


def rgb_compatible_image_path(image_path: Path) -> tuple[Path, Path | None]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        return image_path, None

    with Image.open(image_path) as image:
        if image.mode == "RGB":
            return image_path, None
        handle = tempfile.NamedTemporaryFile(prefix="jzx-rfdetr-rgb-", suffix=".png", delete=False)
        temp_path = Path(handle.name)
        handle.close()
        image.convert("RGB").save(temp_path)
        return temp_path, temp_path


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
