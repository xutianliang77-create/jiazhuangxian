from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse


JsonDict = dict[str, Any]
MODEL_DEVICE_ENV = "JZX_MODEL_DEVICE"
MEDSAM_WEIGHTS_ENV = "JZX_MEDSAM_WEIGHTS"
MEDSAM_MODEL_TYPE_ENV = "JZX_MEDSAM_MODEL_TYPE"
UNET_WEIGHTS_ENV = "JZX_UNET_SEGMENTER_WEIGHTS"
UNET_INPUT_SIZE_ENV = "JZX_UNET_SEGMENTER_INPUT_SIZE"
UNET_THRESHOLD_ENV = "JZX_UNET_SEGMENTER_THRESHOLD"
NNUNET_RESULTS_ENV = "JZX_NNUNET_RESULTS"
NNUNET_RAW_ENV = "JZX_NNUNET_RAW"
NNUNET_PREPROCESSED_ENV = "JZX_NNUNET_PREPROCESSED"
NNUNET_PREDICT_BIN_ENV = "JZX_NNUNET_PREDICT_BIN"
NNUNET_DATASET_ENV = "JZX_NNUNET_DATASET"
NNUNET_CONFIGURATION_ENV = "JZX_NNUNET_CONFIGURATION"
NNUNET_TRAINER_ENV = "JZX_NNUNET_TRAINER"
NNUNET_PLANS_ENV = "JZX_NNUNET_PLANS"
NNUNET_FOLDS_ENV = "JZX_NNUNET_FOLDS"
NNUNET_CHECKPOINT_ENV = "JZX_NNUNET_CHECKPOINT"
NNUNET_ROI_SIZE_ENV = "JZX_NNUNET_ROI_SIZE"
NNUNET_ROI_MARGIN_RATIO_ENV = "JZX_NNUNET_ROI_MARGIN_RATIO"
NNUNET_MIN_CROP_SIZE_ENV = "JZX_NNUNET_MIN_CROP_SIZE"
NNUNET_TIMEOUT_SECONDS_ENV = "JZX_NNUNET_TIMEOUT_SECONDS"
MEDSAM2_WEIGHTS_ENV = "JZX_MEDSAM2_WEIGHTS"
SAM2_WEIGHTS_ENV = "JZX_SAM2_WEIGHTS"
MEDSAM2_CONFIG_ENV = "JZX_MEDSAM2_CONFIG"
SAM2_IMAGE_CONFIG_ENV = "JZX_SAM2_IMAGE_CONFIG"
SAM2_CONFIG_ENV = "JZX_SAM2_VIDEO_CONFIG"


@dataclass(frozen=True)
class NoduleTarget:
    nodule_id: str | None = None
    nodule_index: int | None = None
    bbox: list[float] | None = None
    mask_uri: str | None = None
    contour: list[list[float]] | None = None
    confidence: float | None = None


@dataclass(frozen=True)
class VideoTarget:
    nodule_id: str | None = None
    track_id: str | None = None
    prompt_frame_index: int = 0
    bbox: list[float] | None = None
    mask_uri: str | None = None
    confidence: float | None = None
    prompt_source: str | None = None


@dataclass(frozen=True)
class FrameRange:
    start: int = 0
    end: int | None = None
    stride: int = 1


@dataclass(frozen=True)
class SegmentRequest:
    study_id: str
    image_id: str
    image_uri: str
    targets: list[NoduleTarget] = field(default_factory=list)
    allow_bbox_fallback: bool = True
    return_mask: bool = True
    metadata: JsonDict = field(default_factory=dict)
    trace_id: str | None = None


@dataclass(frozen=True)
class MeasureRequest:
    study_id: str
    image_id: str
    image_uri: str | None = None
    targets: list[NoduleTarget] = field(default_factory=list)
    pixel_spacing: JsonDict | list[float] | None = None
    metadata: JsonDict = field(default_factory=dict)
    trace_id: str | None = None


@dataclass(frozen=True)
class SegmentVideoRequest:
    study_id: str
    video_id: str
    video_uri: str
    frame_manifest_uri: str | None = None
    targets: list[VideoTarget] = field(default_factory=list)
    frame_range: FrameRange = field(default_factory=FrameRange)
    allow_framewise_fallback: bool = True
    return_masks: bool = True
    metadata: JsonDict = field(default_factory=dict)
    trace_id: str | None = None


@dataclass(frozen=True)
class MeasureVideoRequest:
    study_id: str
    video_id: str
    segmentation_uri: str
    pixel_spacing: JsonDict | list[float] | None = None
    measurement_policy: str = "max_long_axis_high_confidence"
    metadata: JsonDict = field(default_factory=dict)
    trace_id: str | None = None


def build_segment_request(job: Mapping[str, Any]) -> SegmentRequest:
    payload = parse_json_object(job.get("input_json"))
    return SegmentRequest(
        study_id=required_payload_string(payload, "study_id"),
        image_id=required_payload_string(payload, "image_id"),
        image_uri=required_payload_string(payload, "image_uri"),
        targets=target_list(payload),
        allow_bbox_fallback=bool(payload.get("allow_bbox_fallback", True)),
        return_mask=bool(payload.get("return_mask", True)),
        metadata=parse_json_object(payload.get("metadata")),
        trace_id=string_or_none(payload.get("trace_id")),
    )


def build_measure_request(job: Mapping[str, Any]) -> MeasureRequest:
    payload = parse_json_object(job.get("input_json"))
    return MeasureRequest(
        study_id=required_payload_string(payload, "study_id"),
        image_id=required_payload_string(payload, "image_id"),
        image_uri=string_or_none(payload.get("image_uri")),
        targets=target_list(payload),
        pixel_spacing=payload.get("pixel_spacing"),
        metadata=parse_json_object(payload.get("metadata")),
        trace_id=string_or_none(payload.get("trace_id")),
    )


def build_segment_video_request(job: Mapping[str, Any]) -> SegmentVideoRequest:
    payload = parse_json_object(job.get("input_json"))
    return SegmentVideoRequest(
        study_id=required_payload_string(payload, "study_id"),
        video_id=required_payload_string(payload, "video_id"),
        video_uri=required_payload_string(payload, "video_uri"),
        frame_manifest_uri=string_or_none(payload.get("frame_manifest_uri")),
        targets=video_target_list(payload),
        frame_range=frame_range_from_payload(parse_json_object(payload.get("frame_range"))),
        allow_framewise_fallback=bool(payload.get("allow_framewise_fallback", True)),
        return_masks=bool(payload.get("return_masks", True)),
        metadata=parse_json_object(payload.get("metadata")),
        trace_id=string_or_none(payload.get("trace_id")),
    )


def build_measure_video_request(job: Mapping[str, Any]) -> MeasureVideoRequest:
    payload = parse_json_object(job.get("input_json"))
    return MeasureVideoRequest(
        study_id=required_payload_string(payload, "study_id"),
        video_id=required_payload_string(payload, "video_id"),
        segmentation_uri=required_payload_string(payload, "segmentation_uri"),
        pixel_spacing=payload.get("pixel_spacing"),
        measurement_policy=string_or_none(payload.get("measurement_policy")) or "max_long_axis_high_confidence",
        metadata=parse_json_object(payload.get("metadata")),
        trace_id=string_or_none(payload.get("trace_id")),
    )


def run_segment_job(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> JsonDict:
    request = build_segment_request(job)
    requested_model = model_metadata(job, fallback_name="bbox-fallback-segmenter", fallback_version="validation-bbox-fallback")
    warnings: list[str] = []

    source_env = os.environ if env is None else env
    adapter: StaticSegmenter | None = None
    if is_medsam_static_model(requested_model["name"]):
        adapter = MedSamSegmenter(requested_model, source_env)
    elif is_nnunet_static_model(requested_model["name"]):
        adapter = NnUnetTightRoiSegmenter(requested_model, source_env)
    elif is_sam2_static_model(requested_model["name"]):
        adapter = Sam2ImageSegmenter(requested_model, source_env)
    elif is_unet_static_model(requested_model["name"]):
        adapter = TorchScriptUnetSegmenter(requested_model, source_env)

    if adapter is not None:
        issues = adapter.config_issues()
        if not issues:
            try:
                return adapter.segment(request)
            except Exception as exc:
                warnings.append(f"{adapter.issue_prefix}_inference_failed:{exc}")
        else:
            warnings.extend(issues)

        if not request.allow_bbox_fallback:
            return {
                "segmentations": [],
                "model": requested_model,
                "warnings": sorted(set([*warnings, "segmentation_model_unavailable:fallback_disabled"])),
            }

    fallback_model = (
        requested_model
        if requested_model["name"] == "bbox-fallback-segmenter"
        else {
            "name": "bbox-fallback-segmenter",
            "version": "validation-bbox-fallback",
            "weights_hash": None,
            "fallback_for": requested_model,
        }
    )
    return bbox_fallback_segmentation_output(request, fallback_model, warnings)


def bbox_fallback_segmentation_output(
    request: SegmentRequest,
    model: JsonDict,
    inherited_warnings: list[str] | None = None,
) -> JsonDict:
    warnings: list[str] = list(inherited_warnings or [])
    segmentations: list[JsonDict] = []
    for index, target in enumerate(request.targets, start=1):
        bbox = normalize_bbox(target.bbox)
        if bbox is None:
            warnings.append(f"segmentation_target_missing_bbox:{target_label(target, index)}")
            continue
        if not request.allow_bbox_fallback:
            warnings.append(f"segmentation_model_not_configured:{target_label(target, index)}")
            continue
        contour = bbox_to_contour(bbox)
        segmentations.append(
            {
                "nodule_id": target.nodule_id,
                "nodule_index": target.nodule_index or index,
                "bbox": bbox,
                "contour": contour,
                "confidence": target.confidence if target.confidence is not None else 0.5,
                "segmentation_source": "bbox_fallback",
                "model_name": model["name"],
                "model_version": model["version"],
                "requires_doctor_review": True,
            }
        )
    if segmentations:
        warnings.append("bbox_fallback_segmentation_used")
    return {
        "segmentations": segmentations,
        "model": model,
        "warnings": sorted(set(warnings)),
    }


class StaticSegmenter:
    issue_prefix = "static_segmenter"

    def config_issues(self) -> list[str]:
        raise NotImplementedError

    def segment(self, request: SegmentRequest) -> JsonDict:
        raise NotImplementedError


class MedSamSegmenter(StaticSegmenter):
    issue_prefix = "medsam_static"

    def __init__(self, model: JsonDict, env: Mapping[str, str]) -> None:
        self.model = model
        self.env = env

    def config_issues(self) -> list[str]:
        issues: list[str] = []
        weights = self.weights_path()
        if weights is None:
            issues.append(f"medsam_weights_env_missing:{MEDSAM_WEIGHTS_ENV}")
        elif not weights.exists():
            issues.append(f"medsam_weights_path_missing:{weights}")
        elif not weights.is_file():
            issues.append(f"medsam_weights_path_not_file:{weights}")

        if importlib.util.find_spec("segment_anything") is None:
            issues.append("medsam_runtime_package_missing:segment-anything")
        return issues

    def segment(self, request: SegmentRequest) -> JsonDict:
        import numpy as np  # type: ignore[import-not-found]
        import torch  # type: ignore[import-not-found]

        sam_module = importlib.import_module("segment_anything")
        registry = getattr(sam_module, "sam_model_registry")
        predictor_cls = getattr(sam_module, "SamPredictor")
        weights = self.weights_path()
        if weights is None:
            raise RuntimeError("MedSAM weights must be configured before inference")

        image = load_rgb_image_array(request.image_uri, self.env)
        model_type = (self.env.get(MEDSAM_MODEL_TYPE_ENV) or "vit_b").strip() or "vit_b"
        if model_type not in registry:
            raise RuntimeError(f"unsupported_medsam_model_type:{model_type}")
        sam = registry[model_type](checkpoint=str(weights))
        sam.to(device=self.device())
        sam.eval()
        predictor = predictor_cls(sam)
        predictor.set_image(image)

        segmentations: list[JsonDict] = []
        warnings: list[str] = []
        for index, target in enumerate(request.targets, start=1):
            bbox = normalize_bbox(target.bbox)
            if bbox is None:
                warnings.append(f"segmentation_target_missing_bbox:{target_label(target, index)}")
                continue
            with torch.inference_mode():
                masks, scores, _ = predictor.predict(
                    box=np.asarray(bbox, dtype=np.float32),
                    multimask_output=False,
                )
            if len(masks) == 0:
                warnings.append(f"medsam_empty_mask:{target_label(target, index)}")
                continue
            confidence = float(scores[0]) if len(scores) else target.confidence if target.confidence is not None else 0.5
            segmentation = segmentation_from_mask(
                masks[0].astype(bool),
                target,
                index,
                self.model,
                source="medsam_bbox_prompt",
                confidence=round(confidence, 4),
                warnings=warnings,
            )
            if segmentation:
                segmentations.append(segmentation)
        return {
            "segmentations": segmentations,
            "model": self.model,
            "warnings": sorted(set(warnings)),
        }

    def weights_path(self) -> Path | None:
        raw = self.env.get(MEDSAM_WEIGHTS_ENV)
        return Path(raw).expanduser() if raw else None

    def device(self) -> str:
        return torch_device(self.env)


class Sam2ImageSegmenter(StaticSegmenter):
    issue_prefix = "sam2_static"

    def __init__(self, model: JsonDict, env: Mapping[str, str]) -> None:
        self.model = model
        self.env = env

    def config_issues(self) -> list[str]:
        issues: list[str] = []
        weights = self.weights_path()
        if weights is None:
            issues.append(f"sam2_weights_env_missing:{MEDSAM2_WEIGHTS_ENV}|{SAM2_WEIGHTS_ENV}")
        elif not weights.exists():
            issues.append(f"sam2_weights_path_missing:{weights}")
        elif not weights.is_file():
            issues.append(f"sam2_weights_path_not_file:{weights}")

        config = self.config_path()
        if not config:
            issues.append(f"sam2_config_env_missing:{SAM2_IMAGE_CONFIG_ENV}|{MEDSAM2_CONFIG_ENV}|{SAM2_CONFIG_ENV}")
        elif looks_like_file_path(config) and not Path(config).expanduser().exists():
            issues.append(f"sam2_config_path_missing:{config}")

        if importlib.util.find_spec("sam2") is None:
            issues.append("sam2_runtime_package_missing:sam2")
        return issues

    def segment(self, request: SegmentRequest) -> JsonDict:
        import numpy as np  # type: ignore[import-not-found]
        import torch  # type: ignore[import-not-found]

        build_module = importlib.import_module("sam2.build_sam")
        predictor_module = importlib.import_module("sam2.sam2_image_predictor")
        build_sam2 = getattr(build_module, "build_sam2")
        predictor_cls = getattr(predictor_module, "SAM2ImagePredictor")
        weights = self.weights_path()
        config = self.config_path()
        if weights is None or config is None:
            raise RuntimeError("SAM2 weights and config must be configured before inference")

        image = load_rgb_image_array(request.image_uri, self.env)
        sam2_model = build_sam2(sam2_builder_config(config), str(weights), device=self.device())
        predictor = predictor_cls(sam2_model)
        predictor.set_image(image)

        segmentations: list[JsonDict] = []
        warnings: list[str] = []
        for index, target in enumerate(request.targets, start=1):
            bbox = normalize_bbox(target.bbox)
            if bbox is None:
                warnings.append(f"segmentation_target_missing_bbox:{target_label(target, index)}")
                continue
            with torch.inference_mode():
                masks, scores, _ = predictor.predict(
                    box=np.asarray(bbox, dtype=np.float32),
                    multimask_output=False,
                )
            if len(masks) == 0:
                warnings.append(f"sam2_empty_mask:{target_label(target, index)}")
                continue
            confidence = float(scores[0]) if len(scores) else target.confidence if target.confidence is not None else 0.5
            segmentation = segmentation_from_mask(
                np.asarray(masks[0]).astype(bool),
                target,
                index,
                self.model,
                source="sam2_bbox_prompt",
                confidence=round(confidence, 4),
                warnings=warnings,
            )
            if segmentation:
                segmentations.append(segmentation)
        return {
            "segmentations": segmentations,
            "model": self.model,
            "warnings": sorted(set(warnings)),
        }

    def weights_path(self) -> Path | None:
        raw = self.env.get(MEDSAM2_WEIGHTS_ENV) or self.env.get(SAM2_WEIGHTS_ENV)
        return Path(raw).expanduser() if raw else None

    def config_path(self) -> str | None:
        raw = self.env.get(SAM2_IMAGE_CONFIG_ENV) or self.env.get(MEDSAM2_CONFIG_ENV) or self.env.get(SAM2_CONFIG_ENV)
        return raw.strip() if raw and raw.strip() else None

    def device(self) -> str:
        return torch_device(self.env)


class TorchScriptUnetSegmenter(StaticSegmenter):
    issue_prefix = "unet_static"

    def __init__(self, model: JsonDict, env: Mapping[str, str]) -> None:
        self.model = model
        self.env = env

    def config_issues(self) -> list[str]:
        issues: list[str] = []
        weights = self.weights_path()
        if weights is None:
            issues.append(f"unet_weights_env_missing:{UNET_WEIGHTS_ENV}")
        elif not weights.exists():
            issues.append(f"unet_weights_path_missing:{weights}")
        elif not weights.is_file():
            issues.append(f"unet_weights_path_not_file:{weights}")

        for import_name, package_name in (("torch", "torch"), ("numpy", "numpy"), ("PIL", "pillow")):
            if importlib.util.find_spec(import_name) is None:
                issues.append(f"unet_runtime_package_missing:{package_name}")
        return issues

    def segment(self, request: SegmentRequest) -> JsonDict:
        import numpy as np  # type: ignore[import-not-found]
        import torch  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]

        weights = self.weights_path()
        if weights is None:
            raise RuntimeError("U-Net weights must be configured before inference")
        image_path = resolve_artifact_uri(request.image_uri, artifact_root(self.env))
        if not image_path.exists():
            raise RuntimeError(f"image_path_missing:{image_path}")

        input_size = self.input_size()
        with Image.open(image_path) as img:
            original = img.convert("L")
            original_width, original_height = original.size
            resized = original.resize((input_size, input_size), Image.Resampling.BILINEAR)
            array = np.asarray(resized, dtype=np.float32) / 255.0

        tensor = torch.from_numpy(array).unsqueeze(0).unsqueeze(0).to(self.device())
        model = torch.jit.load(str(weights), map_location=self.device())
        model.eval()
        with torch.inference_mode():
            logits = model(tensor)
            if isinstance(logits, (list, tuple)):
                logits = logits[0]
            probabilities = torch.sigmoid(logits).detach().cpu().numpy()[0, 0]

        mask_small = probabilities >= self.threshold()
        mask_image = Image.fromarray(mask_small.astype("uint8") * 255)
        mask_full = mask_image.resize((original_width, original_height), Image.Resampling.NEAREST)
        full_mask = np.asarray(mask_full) > 0

        segmentations: list[JsonDict] = []
        warnings: list[str] = []
        if not request.targets:
            warnings.append("segmentation_target_missing")
        for index, target in enumerate(request.targets, start=1):
            restricted = restrict_mask_to_target(full_mask, target)
            if not restricted.any():
                warnings.append(f"unet_empty_mask:{target_label(target, index)}")
                continue
            confidence = target.confidence if target.confidence is not None else mask_confidence(probabilities)
            segmentation = segmentation_from_mask(
                restricted,
                target,
                index,
                self.model,
                source="unet_torchscript",
                confidence=confidence,
                warnings=warnings,
            )
            if segmentation:
                segmentations.append(segmentation)
        return {
            "segmentations": segmentations,
            "model": self.model,
            "warnings": sorted(set(warnings)),
        }

    def weights_path(self) -> Path | None:
        raw = self.env.get(UNET_WEIGHTS_ENV)
        return Path(raw).expanduser() if raw else None

    def device(self) -> str:
        return torch_device(self.env)

    def input_size(self) -> int:
        raw = self.env.get(UNET_INPUT_SIZE_ENV)
        return max(64, integer_or_none(raw) or 256)

    def threshold(self) -> float:
        raw = number_or_none(self.env.get(UNET_THRESHOLD_ENV))
        if raw is None:
            return 0.5
        return min(max(raw, 0.05), 0.95)


class NnUnetTightRoiSegmenter(StaticSegmenter):
    issue_prefix = "nnunet_tight_roi"

    def __init__(self, model: JsonDict, env: Mapping[str, str]) -> None:
        self.model = model
        self.env = env

    def config_issues(self) -> list[str]:
        issues: list[str] = []
        results = self.results_dir()
        if results is None:
            issues.append(f"nnunet_results_env_missing:{NNUNET_RESULTS_ENV}|nnUNet_results")
        elif not results.exists():
            issues.append(f"nnunet_results_path_missing:{results}")
        elif not results.is_dir():
            issues.append(f"nnunet_results_path_not_dir:{results}")

        executable = self.predict_executable()
        if not executable:
            issues.append(f"nnunet_predict_executable_missing:{NNUNET_PREDICT_BIN_ENV}|nnUNetv2_predict")

        for import_name, package_name in (("numpy", "numpy"), ("PIL", "pillow")):
            if importlib.util.find_spec(import_name) is None:
                issues.append(f"nnunet_runtime_package_missing:{package_name}")
        return issues

    def segment(self, request: SegmentRequest) -> JsonDict:
        import numpy as np  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]

        image_path = resolve_artifact_uri(request.image_uri, artifact_root(self.env))
        if not image_path.exists():
            raise RuntimeError(f"image_path_missing:{image_path}")

        targets = list(request.targets)
        warnings: list[str] = []
        if not targets:
            warnings.append("segmentation_target_missing")
            return {"segmentations": [], "model": self.model, "warnings": warnings}

        input_size = self.roi_size()
        prepared: list[JsonDict] = []
        with Image.open(image_path) as image:
            grayscale = image.convert("L")
            original_width, original_height = grayscale.size
            with tempfile.TemporaryDirectory(prefix="jzx-nnunet-roi-") as tmp:
                tmp_dir = Path(tmp)
                input_dir = tmp_dir / "images"
                output_dir = tmp_dir / "predictions"
                input_dir.mkdir()
                output_dir.mkdir()
                for index, target in enumerate(targets, start=1):
                    bbox = normalize_bbox(target.bbox)
                    if bbox is None:
                        warnings.append(f"segmentation_target_missing_bbox:{target_label(target, index)}")
                        continue
                    crop_box = expanded_square_crop_box(
                        bbox,
                        (original_width, original_height),
                        margin_ratio=self.roi_margin_ratio(),
                        min_crop_size=self.min_crop_size(),
                    )
                    case_id = f"nodule_{index:03d}"
                    roi_path = input_dir / f"{case_id}_0000.png"
                    grayscale.crop(crop_box).resize((input_size, input_size), Image.Resampling.BILINEAR).save(roi_path)
                    prepared.append(
                        {
                            "case_id": case_id,
                            "index": index,
                            "target": target,
                            "bbox": bbox,
                            "crop_box": crop_box,
                        }
                    )

                if prepared:
                    self.run_predict(input_dir, output_dir)

                segmentations: list[JsonDict] = []
                for item in prepared:
                    prediction_path = output_dir / f"{item['case_id']}.png"
                    if not prediction_path.exists():
                        warnings.append(f"nnunet_prediction_missing:{target_label(item['target'], item['index'])}")
                        continue
                    with Image.open(prediction_path) as pred_roi:
                        crop_box = item["crop_box"]
                        crop_width = crop_box[2] - crop_box[0]
                        crop_height = crop_box[3] - crop_box[1]
                        pred_crop = pred_roi.convert("L").resize((crop_width, crop_height), Image.Resampling.NEAREST)
                        full_mask_image = Image.new("L", (original_width, original_height), 0)
                        full_mask_image.paste(pred_crop.point(lambda value: 255 if value > 0 else 0), crop_box)
                        full_mask = largest_component(np.asarray(full_mask_image) > 0)
                    confidence = item["target"].confidence if item["target"].confidence is not None else 0.9
                    segmentation = segmentation_from_mask(
                        full_mask,
                        item["target"],
                        item["index"],
                        self.model,
                        source="nnunet_tight_roi",
                        confidence=confidence,
                        warnings=warnings,
                        metadata={
                            "prompt_bbox": item["bbox"],
                            "crop_box_xyxy": list(item["crop_box"]),
                            "roi_size": [input_size, input_size],
                            "full_size_paste": True,
                            "model_family": "nnunet",
                            "dataset": self.dataset(),
                            "configuration": self.configuration(),
                            "trainer": self.trainer(),
                            "plans": self.plans(),
                            "folds": self.folds(),
                            "checkpoint": self.checkpoint(),
                        },
                    )
                    if segmentation:
                        segmentations.append(segmentation)

        return {
            "segmentations": segmentations,
            "model": self.model,
            "warnings": sorted(set(warnings)),
        }

    def run_predict(self, input_dir: Path, output_dir: Path) -> None:
        executable = self.predict_executable()
        if not executable:
            raise RuntimeError("nnUNetv2_predict executable is not available")

        command = [
            executable,
            "-i",
            str(input_dir),
            "-o",
            str(output_dir),
            "-d",
            self.dataset(),
            "-c",
            self.configuration(),
            "-tr",
            self.trainer(),
            "-p",
            self.plans(),
            "-chk",
            self.checkpoint(),
            "--disable_progress_bar",
            "-npp",
            "1",
            "-nps",
            "1",
            "-device",
            nnunet_device_arg(self.env),
        ]
        folds = self.folds()
        if folds:
            command.extend(["-f", *folds])

        run_env = dict(os.environ)
        run_env.update({key: value for key, value in self.env.items() if isinstance(value, str)})
        results = self.results_dir()
        if results is not None:
            run_env["nnUNet_results"] = str(results)
        raw_dir = self.raw_dir()
        if raw_dir is not None:
            run_env["nnUNet_raw"] = str(raw_dir)
        preprocessed_dir = self.preprocessed_dir()
        if preprocessed_dir is not None:
            run_env["nnUNet_preprocessed"] = str(preprocessed_dir)

        cuda_visible = nnunet_cuda_visible_devices(self.env)
        if cuda_visible is not None:
            run_env["CUDA_VISIBLE_DEVICES"] = cuda_visible

        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds(),
            env=run_env,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()[-2000:]
            raise RuntimeError(f"nnunet_predict_failed:{completed.returncode}:{detail}")

    def predict_executable(self) -> str | None:
        raw = self.env.get(NNUNET_PREDICT_BIN_ENV)
        if raw and raw.strip():
            path = Path(raw).expanduser()
            if path.exists():
                return str(path)
            return shutil.which(raw.strip())
        return shutil.which("nnUNetv2_predict")

    def results_dir(self) -> Path | None:
        return env_path(self.env, NNUNET_RESULTS_ENV, "nnUNet_results")

    def raw_dir(self) -> Path | None:
        return env_path(self.env, NNUNET_RAW_ENV, "nnUNet_raw")

    def preprocessed_dir(self) -> Path | None:
        return env_path(self.env, NNUNET_PREPROCESSED_ENV, "nnUNet_preprocessed")

    def dataset(self) -> str:
        return (self.env.get(NNUNET_DATASET_ENV) or "503").strip() or "503"

    def configuration(self) -> str:
        return (self.env.get(NNUNET_CONFIGURATION_ENV) or "2d").strip() or "2d"

    def trainer(self) -> str:
        return (self.env.get(NNUNET_TRAINER_ENV) or "nnUNetTrainer_100epochs").strip() or "nnUNetTrainer_100epochs"

    def plans(self) -> str:
        return (self.env.get(NNUNET_PLANS_ENV) or "nnUNetPlans").strip() or "nnUNetPlans"

    def folds(self) -> list[str]:
        raw = (self.env.get(NNUNET_FOLDS_ENV) or "0 1 2 3 4").replace(",", " ")
        return [part for part in raw.split() if part]

    def checkpoint(self) -> str:
        return (self.env.get(NNUNET_CHECKPOINT_ENV) or "checkpoint_best.pth").strip() or "checkpoint_best.pth"

    def roi_size(self) -> int:
        raw = integer_or_none_string(self.env.get(NNUNET_ROI_SIZE_ENV))
        return max(64, raw or 384)

    def roi_margin_ratio(self) -> float:
        raw = number_or_none_string(self.env.get(NNUNET_ROI_MARGIN_RATIO_ENV))
        return min(max(raw if raw is not None else 0.15, 0.0), 1.0)

    def min_crop_size(self) -> int:
        raw = integer_or_none_string(self.env.get(NNUNET_MIN_CROP_SIZE_ENV))
        return max(16, raw or 80)

    def timeout_seconds(self) -> int:
        raw = integer_or_none_string(self.env.get(NNUNET_TIMEOUT_SECONDS_ENV))
        return max(10, raw or 600)


def is_medsam_static_model(model_name: str | None) -> bool:
    normalized = (model_name or "").lower()
    return "medsam" in normalized and "medsam2" not in normalized


def is_nnunet_static_model(model_name: str | None) -> bool:
    normalized = (model_name or "").lower()
    return "nnunet" in normalized or "nn-unet" in normalized


def is_unet_static_model(model_name: str | None) -> bool:
    normalized = (model_name or "").lower()
    return "unet" in normalized and "video" not in normalized


def is_sam2_static_model(model_name: str | None) -> bool:
    normalized = (model_name or "").lower()
    return ("sam2" in normalized or "medsam2" in normalized) and "video" not in normalized


def load_rgb_image_array(image_uri: str, env: Mapping[str, str]) -> Any:
    import numpy as np  # type: ignore[import-not-found]
    from PIL import Image  # type: ignore[import-not-found]

    image_path = resolve_artifact_uri(image_uri, artifact_root(env))
    if not image_path.exists():
        raise RuntimeError(f"image_path_missing:{image_path}")
    with Image.open(image_path) as image:
        return np.asarray(image.convert("RGB"))


def segmentation_from_mask(
    mask: Any,
    target: NoduleTarget,
    index: int,
    model: JsonDict,
    *,
    source: str,
    confidence: float,
    warnings: list[str],
    metadata: JsonDict | None = None,
) -> JsonDict | None:
    bbox = bbox_from_mask(mask)
    contour = contour_from_mask(mask) if bbox else None
    if bbox is None or contour is None:
        warnings.append(f"segmentation_empty_mask:{target_label(target, index)}")
        return None
    rounded_confidence = round(float(confidence), 4)
    result = {
        "nodule_id": target.nodule_id,
        "nodule_index": target.nodule_index or index,
        "bbox": bbox,
        "contour": contour,
        "confidence": rounded_confidence,
        "segmentation_source": source,
        "model_name": model["name"],
        "model_version": model["version"],
        "requires_doctor_review": rounded_confidence < 0.5,
    }
    if metadata:
        result["metadata"] = metadata
    return result


def restrict_mask_to_target(mask: Any, target: NoduleTarget) -> Any:
    import numpy as np  # type: ignore[import-not-found]

    bbox = normalize_bbox(target.bbox)
    if bbox is None:
        return mask
    height, width = mask.shape[:2]
    x1, y1, x2, y2 = bbox
    pad_x = max(2.0, (x2 - x1) * 0.25)
    pad_y = max(2.0, (y2 - y1) * 0.25)
    left = max(0, int(x1 - pad_x))
    top = max(0, int(y1 - pad_y))
    right = min(width, int(x2 + pad_x))
    bottom = min(height, int(y2 + pad_y))
    restricted = np.zeros_like(mask, dtype=bool)
    restricted[top:bottom, left:right] = mask[top:bottom, left:right]
    return largest_component(restricted)


def largest_component(mask: Any) -> Any:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]

        mask_u8 = np.asarray(mask, dtype=np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(mask_u8, 8)
        if count <= 1:
            return mask
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        return labels == largest
    except Exception:
        return mask


def mask_confidence(probabilities: Any) -> float:
    try:
        import numpy as np  # type: ignore[import-not-found]

        array = np.asarray(probabilities, dtype=float)
        positive = array[array >= 0.5]
        if positive.size == 0:
            return 0.5
        return round(float(positive.mean()), 4)
    except Exception:
        return 0.5


def run_segment_video_job(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> JsonDict:
    request = build_segment_video_request(job)
    requested_model = model_metadata(
        job,
        fallback_name="video-bbox-fallback-segmenter",
        fallback_version="validation-video-bbox-fallback",
    )
    source_env = os.environ if env is None else env
    warnings: list[str] = []
    if is_sam2_video_model(requested_model["name"]):
        adapter = Sam2VideoSegmenter(requested_model, source_env)
        issues = adapter.config_issues()
        if not issues:
            try:
                return adapter.segment(request)
            except Exception as exc:
                warnings.append(f"sam2_video_inference_failed:{exc}")
        else:
            warnings.extend(issues)
        if not request.allow_framewise_fallback:
            return empty_video_segmentation_output(
                request,
                requested_model,
                [*warnings, "video_segmentation_model_unavailable:fallback_disabled"],
            )

    fallback_model = {
        "name": "video-bbox-fallback-segmenter",
        "version": "validation-video-bbox-fallback",
        "weights_hash": None,
        "fallback_for": requested_model,
    }
    return video_bbox_fallback_output(request, fallback_model, warnings)


def video_bbox_fallback_output(request: SegmentVideoRequest, model: JsonDict, inherited_warnings: list[str] | None = None) -> JsonDict:
    warnings: list[str] = list(inherited_warnings or [])
    tracks: list[JsonDict] = []
    if not request.targets:
        warnings.append("video_segmentation_target_missing")

    for index, target in enumerate(request.targets, start=1):
        bbox = normalize_bbox(target.bbox)
        track_id = target.track_id or f"track_{index:03d}"
        if bbox is None:
            warnings.append(f"video_segmentation_target_missing_bbox:{track_id}")
            continue
        if not request.allow_framewise_fallback:
            warnings.append(f"video_segmentation_model_not_configured:{track_id}")
            continue
        contour = bbox_to_contour(bbox)
        frame_index = max(0, target.prompt_frame_index)
        confidence = target.confidence if target.confidence is not None else 0.5
        tracks.append(
            {
                "track_id": track_id,
                "nodule_id": target.nodule_id,
                "prompt_frame_index": frame_index,
                "prompt_bbox": bbox,
                "prompt_source": target.prompt_source or "bbox_prompt",
                "segmentation_source": "video_bbox_prompt_fallback",
                "model_name": model["name"],
                "model_version": model["version"],
                "frames": [
                    {
                        "frame_index": frame_index,
                        "time_ms": None,
                        "bbox": bbox,
                        "contour": contour,
                        "confidence": confidence,
                        "segmentation_source": "video_bbox_prompt_fallback",
                        "requires_doctor_review": True,
                    }
                ],
                "quality": {
                    "mean_confidence": confidence,
                    "min_confidence": confidence,
                    "mask_area_cv": 0.0,
                    "track_dropout_frames": 0,
                    "temporal_jitter_score": None,
                    "fallback_prompt_frame_only": True,
                },
                "requires_doctor_review": True,
            }
        )

    if tracks:
        warnings.append("video_bbox_fallback_segmentation_used")
    return {
        "video": {
            "video_id": request.video_id,
            "source_video_uri": request.video_uri,
            "frame_manifest_uri": request.frame_manifest_uri,
            "processed_frame_range": {
                "start": request.frame_range.start,
                "end": request.frame_range.end,
                "stride": request.frame_range.stride,
            },
        },
        "tracks": tracks,
        "model": model,
        "warnings": sorted(set(warnings)),
    }


def empty_video_segmentation_output(request: SegmentVideoRequest, model: JsonDict, warnings: list[str]) -> JsonDict:
    return {
        "video": {
            "video_id": request.video_id,
            "source_video_uri": request.video_uri,
            "frame_manifest_uri": request.frame_manifest_uri,
            "processed_frame_range": {
                "start": request.frame_range.start,
                "end": request.frame_range.end,
                "stride": request.frame_range.stride,
            },
        },
        "tracks": [],
        "model": model,
        "warnings": sorted(set(warnings)),
    }


class Sam2VideoSegmenter:
    def __init__(self, model: JsonDict, env: Mapping[str, str]) -> None:
        self.model = model
        self.env = env

    def config_issues(self) -> list[str]:
        issues: list[str] = []
        weights = self.weights_path()
        if weights is None:
            issues.append(f"sam2_weights_env_missing:{MEDSAM2_WEIGHTS_ENV}|{SAM2_WEIGHTS_ENV}")
        elif not weights.exists():
            issues.append(f"sam2_weights_path_missing:{weights}")
        elif not weights.is_file():
            issues.append(f"sam2_weights_path_not_file:{weights}")

        config = self.config_path()
        if not config:
            issues.append(f"sam2_config_env_missing:{MEDSAM2_CONFIG_ENV}|{SAM2_CONFIG_ENV}")
        elif looks_like_file_path(config) and not Path(config).expanduser().exists():
            issues.append(f"sam2_config_path_missing:{config}")

        if importlib.util.find_spec("sam2") is None:
            issues.append("sam2_runtime_package_missing:sam2")
        return issues

    def segment(self, request: SegmentVideoRequest) -> JsonDict:
        import numpy as np  # type: ignore[import-not-found]

        build_module = importlib.import_module("sam2.build_sam")
        build_predictor = getattr(build_module, "build_sam2_video_predictor")
        weights = self.weights_path()
        config = self.config_path()
        if weights is None or config is None:
            raise RuntimeError("SAM2 weights and config must be configured before inference")

        video_path = resolve_artifact_uri(request.video_uri, artifact_root(self.env))
        if not video_path.exists():
            raise RuntimeError(f"video_path_missing:{video_path}")

        predictor = build_predictor(sam2_builder_config(config), str(weights), device=self.device())
        state = predictor.init_state(video_path=str(video_path))
        obj_to_track: dict[int, VideoTarget] = {}
        for index, target in enumerate(request.targets, start=1):
            bbox = normalize_bbox(target.bbox)
            if bbox is None:
                continue
            obj_id = index
            obj_to_track[obj_id] = target
            predictor.add_new_points_or_box(
                inference_state=state,
                frame_idx=max(0, target.prompt_frame_index),
                obj_id=obj_id,
                box=np.asarray(bbox, dtype=np.float32),
            )

        tracks_by_obj = initialized_sam2_tracks(obj_to_track, self.model)
        for frame_index, out_obj_ids, out_mask_logits in predictor.propagate_in_video(state):
            if not frame_in_range(int(frame_index), request.frame_range):
                continue
            for position, obj_id in enumerate(list(out_obj_ids)):
                target = obj_to_track.get(int(obj_id))
                track = tracks_by_obj.get(int(obj_id))
                if target is None or track is None:
                    continue
                frame = sam2_frame_from_logits(int(frame_index), out_mask_logits[position], target)
                if frame is not None:
                    track["frames"].append(frame)

        tracks = finalize_sam2_tracks(list(tracks_by_obj.values()))
        warnings = []
        if not tracks:
            warnings.append("sam2_video_no_tracks")
        for track in tracks:
            if not track.get("frames"):
                warnings.append(f"sam2_video_track_empty:{track.get('track_id')}")
        return {
            "video": {
                "video_id": request.video_id,
                "source_video_uri": request.video_uri,
                "frame_manifest_uri": request.frame_manifest_uri,
                "processed_frame_range": {
                    "start": request.frame_range.start,
                    "end": request.frame_range.end,
                    "stride": request.frame_range.stride,
                },
            },
            "tracks": tracks,
            "model": self.model,
            "warnings": sorted(set(warnings)),
        }

    def weights_path(self) -> Path | None:
        raw = self.env.get(MEDSAM2_WEIGHTS_ENV) or self.env.get(SAM2_WEIGHTS_ENV)
        return Path(raw).expanduser() if raw else None

    def config_path(self) -> str | None:
        raw = self.env.get(MEDSAM2_CONFIG_ENV) or self.env.get(SAM2_CONFIG_ENV)
        return raw.strip() if raw and raw.strip() else None

    def device(self) -> str:
        return torch_device(self.env)


def is_sam2_video_model(model_name: str | None) -> bool:
    normalized = (model_name or "").lower()
    return "sam2" in normalized or "medsam2" in normalized


def looks_like_file_path(value: str) -> bool:
    return "/" in value or "\\" in value or value.endswith((".yaml", ".yml"))


def torch_device(env: Mapping[str, str]) -> str:
    raw = (env.get(MODEL_DEVICE_ENV) or "cuda").strip() or "cuda"
    return f"cuda:{raw}" if raw.isdigit() else raw


def nnunet_device_arg(env: Mapping[str, str]) -> str:
    raw = (env.get(MODEL_DEVICE_ENV) or "cuda").strip().lower() or "cuda"
    if raw.isdigit() or raw.startswith("cuda"):
        return "cuda"
    if raw.startswith("mps"):
        return "mps"
    return "cpu" if raw == "cpu" else raw


def nnunet_cuda_visible_devices(env: Mapping[str, str]) -> str | None:
    raw = (env.get(MODEL_DEVICE_ENV) or "").strip().lower()
    if raw.isdigit():
        return raw
    if raw.startswith("cuda:"):
        return raw.split(":", 1)[1] or None
    return None


def sam2_builder_config(config: str) -> str:
    path = Path(config).expanduser()
    sam2_spec = importlib.util.find_spec("sam2")
    package_locations = list(sam2_spec.submodule_search_locations or []) if sam2_spec else []
    package_root = Path(package_locations[0]).resolve() if package_locations else None
    if package_root is None or not path.exists():
        return config

    resolved = path.resolve()
    try:
        return str(resolved.relative_to(package_root))
    except ValueError:
        pass

    candidates = sorted((package_root / "configs").rglob(path.name))
    if candidates:
        return str(candidates[0].resolve().relative_to(package_root))
    return config


def artifact_root(env: Mapping[str, str]) -> Path:
    return Path(env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()


def env_path(env: Mapping[str, str], *keys: str) -> Path | None:
    for key in keys:
        raw = env.get(key)
        if raw and raw.strip():
            return Path(raw).expanduser()
    return None


def initialized_sam2_tracks(obj_to_track: Mapping[int, VideoTarget], model: JsonDict) -> dict[int, JsonDict]:
    tracks: dict[int, JsonDict] = {}
    for index, target in obj_to_track.items():
        track_id = target.track_id or f"track_{index:03d}"
        tracks[index] = {
            "track_id": track_id,
            "nodule_id": target.nodule_id,
            "prompt_frame_index": max(0, target.prompt_frame_index),
            "prompt_bbox": normalize_bbox(target.bbox),
            "prompt_source": target.prompt_source or "bbox_prompt",
            "segmentation_source": "sam2_video_prompt",
            "model_name": model["name"],
            "model_version": model["version"],
            "frames": [],
            "quality": {},
            "requires_doctor_review": False,
        }
    return tracks


def frame_in_range(frame_index: int, frame_range: FrameRange) -> bool:
    if frame_index < frame_range.start:
        return False
    if frame_range.end is not None and frame_index > frame_range.end:
        return False
    return (frame_index - frame_range.start) % frame_range.stride == 0


def sam2_frame_from_logits(frame_index: int, logits: Any, target: VideoTarget) -> JsonDict | None:
    mask = binary_mask_from_logits(logits)
    if mask is None:
        return None
    bbox = bbox_from_mask(mask)
    contour = contour_from_mask(mask) if bbox else None
    if bbox is None or contour is None:
        return None
    confidence = target.confidence if target.confidence is not None else confidence_from_logits(logits, mask)
    return {
        "frame_index": frame_index,
        "time_ms": None,
        "bbox": bbox,
        "contour": contour,
        "confidence": confidence,
        "segmentation_source": "sam2_video_prompt",
        "requires_doctor_review": confidence < 0.5,
    }


def binary_mask_from_logits(logits: Any) -> Any | None:
    try:
        import numpy as np  # type: ignore[import-not-found]

        value = logits
        if hasattr(value, "detach"):
            value = value.detach().cpu().numpy()
        array = np.asarray(value)
        array = np.squeeze(array)
        if array.ndim != 2:
            return None
        return array > 0
    except Exception:
        return None


def bbox_from_mask(mask: Any) -> list[float] | None:
    try:
        import numpy as np  # type: ignore[import-not-found]

        ys, xs = np.where(mask)
        if len(xs) == 0 or len(ys) == 0:
            return None
        return [float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)]
    except Exception:
        return None


def contour_from_mask(mask: Any) -> list[list[float]] | None:
    bbox = bbox_from_mask(mask)
    if bbox is None:
        return None
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]

        mask_u8 = np.asarray(mask, dtype=np.uint8) * 255
        contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return bbox_to_contour(bbox)
        largest = max(contours, key=cv2.contourArea)
        points: list[list[float]] = []
        for point in largest.reshape(-1, 2):
            points.append([float(point[0]), float(point[1])])
        return points if len(points) >= 3 else bbox_to_contour(bbox)
    except Exception:
        return bbox_to_contour(bbox)


def confidence_from_logits(logits: Any, mask: Any) -> float:
    try:
        import numpy as np  # type: ignore[import-not-found]

        value = logits
        if hasattr(value, "detach"):
            value = value.detach().cpu().numpy()
        array = np.squeeze(np.asarray(value, dtype=float))
        probabilities = 1.0 / (1.0 + np.exp(-array))
        selected = probabilities[mask]
        if selected.size == 0:
            return 0.5
        return round(float(selected.mean()), 4)
    except Exception:
        return 0.5


def finalize_sam2_tracks(tracks: list[JsonDict]) -> list[JsonDict]:
    for track in tracks:
        frames = track.get("frames") if isinstance(track.get("frames"), list) else []
        confidences = [number_or_none(frame.get("confidence")) for frame in frames if isinstance(frame, dict)]
        valid_confidences = [confidence for confidence in confidences if confidence is not None]
        areas = []
        for frame in frames:
            if not isinstance(frame, dict):
                continue
            contour = normalize_contour(frame.get("contour"))
            if contour:
                _, _, area = contour_dimensions(contour)
                areas.append(area)
        area_cv = coefficient_of_variation(areas)
        track["quality"] = {
            "mean_confidence": round(sum(valid_confidences) / len(valid_confidences), 4) if valid_confidences else None,
            "min_confidence": round(min(valid_confidences), 4) if valid_confidences else None,
            "mask_area_cv": round(area_cv, 4) if area_cv is not None else None,
            "track_dropout_frames": 0,
            "temporal_jitter_score": round(area_cv, 4) if area_cv is not None else None,
        }
        track["requires_doctor_review"] = any(
            bool(frame.get("requires_doctor_review")) for frame in frames if isinstance(frame, dict)
        )
    return tracks


def run_measurement_job(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> JsonDict:
    request = build_measure_request(job)
    source_env = os.environ if env is None else env
    root = Path(source_env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()
    row_spacing, column_spacing = parse_pixel_spacing(request.pixel_spacing)
    spacing_available = row_spacing is not None and column_spacing is not None
    warnings: list[str] = []
    if not spacing_available:
        warnings.append("pixel_spacing_missing:mm_measurement_unavailable")

    measurements: list[JsonDict] = []
    for index, target in enumerate(request.targets, start=1):
        pixels, source, target_warnings = pixel_measurement(target, root)
        warnings.extend(f"{warning}:{target_label(target, index)}" for warning in target_warnings)
        if pixels is None:
            continue
        long_px = pixels["long_axis_px"]
        short_px = pixels["short_axis_px"]
        area_px2 = pixels["area_px2"]
        long_mm = short_mm = area_mm2 = None
        if spacing_available:
            assert row_spacing is not None and column_spacing is not None
            long_mm, short_mm = mm_axes_from_bbox(pixels["width_px"], pixels["height_px"], row_spacing, column_spacing)
            area_mm2 = area_px2 * row_spacing * column_spacing
        aspect_ratio = long_px / short_px if short_px > 0 else None
        measurements.append(
            {
                "nodule_id": target.nodule_id,
                "nodule_index": target.nodule_index or index,
                "long_axis_mm": round(long_mm, 4) if long_mm is not None else None,
                "short_axis_mm": round(short_mm, 4) if short_mm is not None else None,
                "ap_axis_mm": None,
                "area_mm2": round(area_mm2, 4) if area_mm2 is not None else None,
                "aspect_ratio": round(aspect_ratio, 4) if aspect_ratio is not None else None,
                "pixel_measurements": {
                    "long_axis_px": round(long_px, 4),
                    "short_axis_px": round(short_px, 4),
                    "area_px2": round(area_px2, 4),
                    "width_px": round(pixels["width_px"], 4),
                    "height_px": round(pixels["height_px"], 4),
                },
                "measurement_source": source,
                "confidence": target.confidence,
                "requires_doctor_review": (not spacing_available) or source != "mask",
            }
        )
    return {
        "measurements": measurements,
        "pixel_spacing": {"row_mm": row_spacing, "column_mm": column_spacing},
        "warnings": sorted(set(warnings)),
    }


def run_measure_video_job(job: Mapping[str, Any], env: Mapping[str, str] | None = None) -> JsonDict:
    request = build_measure_video_request(job)
    source_env = os.environ if env is None else env
    root = Path(source_env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()
    row_spacing, column_spacing = parse_pixel_spacing(request.pixel_spacing)
    spacing_available = row_spacing is not None and column_spacing is not None
    warnings: list[str] = []
    if not spacing_available:
        warnings.append("pixel_spacing_missing:mm_measurement_unavailable")

    video_segmentation = load_json_artifact(request.segmentation_uri, root)
    tracks = video_segmentation.get("tracks") if isinstance(video_segmentation.get("tracks"), list) else []
    measurements: list[JsonDict] = []
    for track_index, track in enumerate(tracks, start=1):
        if not isinstance(track, dict):
            continue
        frame_measurements: list[JsonDict] = []
        frames = track.get("frames") if isinstance(track.get("frames"), list) else []
        for frame in frames:
            if not isinstance(frame, dict):
                continue
            pixels, source, target_warnings = pixel_measurement(frame_target(track, frame), root)
            track_id = string_or_none(track.get("track_id")) or f"track_{track_index:03d}"
            frame_index = integer_or_none(frame.get("frame_index")) or 0
            warnings.extend(f"{warning}:{track_id}:{frame_index}" for warning in target_warnings)
            if pixels is None:
                continue
            frame_measurements.append(
                {
                    "frame_index": frame_index,
                    "time_ms": number_or_none(frame.get("time_ms")),
                    "long_axis_px": round(pixels["long_axis_px"], 4),
                    "short_axis_px": round(pixels["short_axis_px"], 4),
                    "area_px2": round(pixels["area_px2"], 4),
                    "width_px": round(pixels["width_px"], 4),
                    "height_px": round(pixels["height_px"], 4),
                    "measurement_source": source,
                    "confidence": number_or_none(frame.get("confidence")),
                    "requires_doctor_review": bool(frame.get("requires_doctor_review", True)) or source != "mask",
                }
            )
        if not frame_measurements:
            warnings.append(f"video_measurement_no_measurable_frames:{track.get('track_id') or track_index}")
            continue
        selected = select_video_measurement_frame(frame_measurements, request.measurement_policy)
        long_mm = short_mm = area_mm2 = None
        if spacing_available:
            assert row_spacing is not None and column_spacing is not None
            long_mm, short_mm = mm_axes_from_bbox(selected["width_px"], selected["height_px"], row_spacing, column_spacing)
            area_mm2 = selected["area_px2"] * row_spacing * column_spacing
        measurements.append(
            {
                "track_id": string_or_none(track.get("track_id")) or f"track_{track_index:03d}",
                "nodule_id": string_or_none(track.get("nodule_id")),
                "selected_frame_index": selected["frame_index"],
                "selection_reason": request.measurement_policy,
                "long_axis_mm": round(long_mm, 4) if long_mm is not None else None,
                "short_axis_mm": round(short_mm, 4) if short_mm is not None else None,
                "area_mm2": round(area_mm2, 4) if area_mm2 is not None else None,
                "frame_measurements": frame_measurements,
                "temporal_summary": summarize_video_measurements(frame_measurements),
                "requires_doctor_review": (not spacing_available)
                or bool(selected.get("requires_doctor_review"))
                or "fallback" in str(selected.get("measurement_source")),
            }
        )
    return {
        "measurements": measurements,
        "pixel_spacing": {"row_mm": row_spacing, "column_mm": column_spacing},
        "measurement_policy": request.measurement_policy,
        "warnings": sorted(set(warnings)),
    }


def target_list(payload: Mapping[str, Any]) -> list[NoduleTarget]:
    targets: list[NoduleTarget] = []
    raw_targets = payload.get("nodules")
    if isinstance(raw_targets, list):
        for item in raw_targets:
            if isinstance(item, dict):
                targets.append(target_from_payload(item))
    if targets:
        return targets
    target = target_from_payload(payload)
    return [target] if target.nodule_id or target.nodule_index or target.bbox else []


def target_from_payload(payload: Mapping[str, Any]) -> NoduleTarget:
    return NoduleTarget(
        nodule_id=string_or_none(payload.get("nodule_id")),
        nodule_index=integer_or_none(payload.get("nodule_index")),
        bbox=normalize_bbox(payload.get("bbox")),
        mask_uri=string_or_none(payload.get("mask_uri")),
        contour=normalize_contour(payload.get("contour")),
        confidence=number_or_none(payload.get("confidence")),
    )


def video_target_list(payload: Mapping[str, Any]) -> list[VideoTarget]:
    targets: list[VideoTarget] = []
    raw_targets = payload.get("targets")
    if isinstance(raw_targets, list):
        for item in raw_targets:
            if isinstance(item, dict):
                targets.append(video_target_from_payload(item))
    return targets


def video_target_from_payload(payload: Mapping[str, Any]) -> VideoTarget:
    return VideoTarget(
        nodule_id=string_or_none(payload.get("nodule_id")),
        track_id=string_or_none(payload.get("track_id")),
        prompt_frame_index=max(0, integer_or_none(payload.get("prompt_frame_index")) or 0),
        bbox=normalize_bbox(payload.get("bbox")),
        mask_uri=string_or_none(payload.get("mask_uri")),
        confidence=number_or_none(payload.get("confidence")),
        prompt_source=string_or_none(payload.get("prompt_source")),
    )


def frame_range_from_payload(payload: Mapping[str, Any]) -> FrameRange:
    start = integer_or_none(payload.get("start"))
    end = integer_or_none(payload.get("end"))
    stride = integer_or_none(payload.get("stride"))
    return FrameRange(start=max(0, start or 0), end=end if end is None or end >= 0 else None, stride=max(1, stride or 1))


def frame_target(track: Mapping[str, Any], frame: Mapping[str, Any]) -> NoduleTarget:
    return NoduleTarget(
        nodule_id=string_or_none(track.get("nodule_id")),
        nodule_index=None,
        bbox=normalize_bbox(frame.get("bbox")),
        mask_uri=string_or_none(frame.get("mask_uri")),
        contour=normalize_contour(frame.get("contour")),
        confidence=number_or_none(frame.get("confidence")),
    )


def select_video_measurement_frame(frame_measurements: list[JsonDict], policy: str) -> JsonDict:
    if policy == "best_quality_frame":
        return max(frame_measurements, key=lambda item: (number_or_none(item.get("confidence")) or 0.0, item["long_axis_px"]))
    if policy == "median_stable_frame":
        ordered = sorted(frame_measurements, key=lambda item: item["long_axis_px"])
        return ordered[len(ordered) // 2]
    return max(frame_measurements, key=lambda item: item["long_axis_px"])


def summarize_video_measurements(frame_measurements: list[JsonDict]) -> JsonDict:
    long_axes = [float(item["long_axis_px"]) for item in frame_measurements]
    areas = [float(item["area_px2"]) for item in frame_measurements]
    max_long_axis = max(long_axes) if long_axes else None
    median_long_axis = median(long_axes)
    area_cv = coefficient_of_variation(areas)
    return {
        "max_long_axis_px": round(max_long_axis, 4) if max_long_axis is not None else None,
        "median_long_axis_px": round(median_long_axis, 4) if median_long_axis is not None else None,
        "area_cv": round(area_cv, 4) if area_cv is not None else None,
        "stable_frame_count": len(frame_measurements),
    }


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2.0


def coefficient_of_variation(values: list[float]) -> float | None:
    if not values:
        return None
    avg = sum(values) / len(values)
    if avg <= 0:
        return 0.0
    variance = sum((value - avg) ** 2 for value in values) / len(values)
    return (variance**0.5) / avg


def pixel_measurement(target: NoduleTarget, root: Path) -> tuple[JsonDict | None, str, list[str]]:
    if target.mask_uri:
        mask_pixels = measure_mask(target.mask_uri, root)
        if mask_pixels is not None:
            return mask_pixels, "mask", []
    if target.contour:
        width, height, area = contour_dimensions(target.contour)
        if width > 0 and height > 0:
            return axes(width, height, area), "contour", []
    bbox = normalize_bbox(target.bbox)
    if bbox:
        width = max(0.0, bbox[2] - bbox[0])
        height = max(0.0, bbox[3] - bbox[1])
        return axes(width, height, width * height), "bbox_fallback", []
    return None, "unavailable", ["measurement_target_missing_geometry"]


def measure_mask(mask_uri: str, root: Path) -> JsonDict | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        mask_path = resolve_artifact_uri(mask_uri, root)
        image = Image.open(mask_path).convert("L")
    except Exception:
        return None
    xs: list[int] = []
    ys: list[int] = []
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            if pixels[x, y] > 0:
                xs.append(x)
                ys.append(y)
    if not xs or not ys:
        return None
    width = float(max(xs) - min(xs) + 1)
    height = float(max(ys) - min(ys) + 1)
    return axes(width, height, float(len(xs)))


def axes(width: float, height: float, area: float) -> JsonDict:
    return {
        "width_px": width,
        "height_px": height,
        "long_axis_px": max(width, height),
        "short_axis_px": min(width, height),
        "area_px2": area,
    }


def contour_dimensions(contour: list[list[float]]) -> tuple[float, float, float]:
    xs = [point[0] for point in contour]
    ys = [point[1] for point in contour]
    width = max(xs) - min(xs)
    height = max(ys) - min(ys)
    area = abs(
        sum(
            contour[index][0] * contour[(index + 1) % len(contour)][1]
            - contour[(index + 1) % len(contour)][0] * contour[index][1]
            for index in range(len(contour))
        )
    ) / 2.0
    return width, height, area


def mm_axes_from_bbox(width_px: float, height_px: float, row_spacing: float, column_spacing: float) -> tuple[float, float]:
    width_mm = width_px * column_spacing
    height_mm = height_px * row_spacing
    return (max(width_mm, height_mm), min(width_mm, height_mm))


def parse_pixel_spacing(value: Any) -> tuple[float | None, float | None]:
    if isinstance(value, list) and len(value) >= 2:
        return number_or_none(value[0]), number_or_none(value[1])
    if isinstance(value, dict):
        row = first_number(value, "row_mm", "rowSpacing", "row_spacing", "row_spacing_mm", "y", "height")
        column = first_number(
            value,
            "column_mm",
            "columnSpacing",
            "column_spacing",
            "column_spacing_mm",
            "col_mm",
            "colSpacing",
            "col_spacing",
            "col_spacing_mm",
            "x",
            "width",
        )
        if row is not None and column is not None:
            return row, column
        spacing = value.get("spacing")
        if isinstance(spacing, list) and len(spacing) >= 2:
            return number_or_none(spacing[0]), number_or_none(spacing[1])
    return None, None


def first_number(value: Mapping[str, Any], *keys: str) -> float | None:
    for key in keys:
        number = number_or_none(value.get(key))
        if number is not None:
            return number
    return None


def bbox_to_contour(bbox: list[float]) -> list[list[float]]:
    x1, y1, x2, y2 = bbox
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def normalize_bbox(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    coords: list[float] = []
    for item in value:
        number = number_or_none(item)
        if number is None:
            return None
        coords.append(number)
    x1, y1, x2, y2 = coords
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    return [x1, y1, x2, y2]


def expanded_square_crop_box(
    bbox: list[float],
    image_size: tuple[int, int],
    *,
    margin_ratio: float,
    min_crop_size: int,
) -> tuple[int, int, int, int]:
    image_width, image_height = image_size
    left, top, right, bottom = bbox
    width = max(1.0, right - left)
    height = max(1.0, bottom - top)
    margin = int(round(max(width, height) * margin_ratio))
    side = int(round(max(width + 2 * margin, height + 2 * margin, float(min_crop_size))))
    side = min(side, max(image_width, image_height))
    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    crop_left = int(round(center_x - side / 2.0))
    crop_top = int(round(center_y - side / 2.0))
    crop_right = crop_left + side
    crop_bottom = crop_top + side

    if crop_left < 0:
        crop_right -= crop_left
        crop_left = 0
    if crop_top < 0:
        crop_bottom -= crop_top
        crop_top = 0
    if crop_right > image_width:
        shift = crop_right - image_width
        crop_left = max(0, crop_left - shift)
        crop_right = image_width
    if crop_bottom > image_height:
        shift = crop_bottom - image_height
        crop_top = max(0, crop_top - shift)
        crop_bottom = image_height
    return crop_left, crop_top, crop_right, crop_bottom


def normalize_contour(value: Any) -> list[list[float]] | None:
    if not isinstance(value, list):
        return None
    contour: list[list[float]] = []
    for point in value:
        if not isinstance(point, list) or len(point) < 2:
            return None
        x = number_or_none(point[0])
        y = number_or_none(point[1])
        if x is None or y is None:
            return None
        contour.append([x, y])
    return contour if len(contour) >= 3 else None


def resolve_artifact_uri(uri: str, root: Path) -> Path:
    if uri.startswith("artifact://"):
        return root / uri.removeprefix("artifact://").lstrip("/")
    if uri.startswith("file://"):
        return Path(urlparse(uri).path).expanduser()
    return Path(uri).expanduser()


def load_json_artifact(uri: str, root: Path) -> JsonDict:
    path = resolve_artifact_uri(uri, root)
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def model_metadata(job: Mapping[str, Any], *, fallback_name: str, fallback_version: str) -> JsonDict:
    return {
        "name": string_or_none(job.get("model_name")) or fallback_name,
        "version": string_or_none(job.get("model_version")) or fallback_version,
        "weights_hash": string_or_none(job.get("weights_hash")),
    }


def required_payload_string(payload: Mapping[str, Any], key: str) -> str:
    value = string_or_none(payload.get(key))
    if not value:
        raise ValueError(f"model job input missing required field: {key}")
    return value


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


def integer_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def integer_or_none_string(value: Any) -> int | None:
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return integer_or_none(value)


def number_or_none(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def number_or_none_string(value: Any) -> float | None:
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return number_or_none(value)


def target_label(target: NoduleTarget, index: int) -> str:
    return target.nodule_id or str(target.nodule_index or index)
