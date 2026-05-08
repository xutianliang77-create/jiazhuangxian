from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .schemas import (
    ImageRequest,
    OutputImageRequest,
    PreprocessUltrasoundRequest,
    RenderPreviewRequest,
    WorkerResponse,
    error,
    ok,
)


PHI_TAGS = (
    "PatientName",
    "PatientID",
    "PatientBirthDate",
    "PatientSex",
    "PatientAge",
    "PatientAddress",
    "PatientTelephoneNumbers",
    "ReferringPhysicianName",
    "InstitutionName",
)


def dependency_status() -> dict[str, bool]:
    return {
        "pydantic": _has_module("pydantic"),
        "pydicom": _has_module("pydicom"),
        "opencv": _has_module("cv2"),
        "pillow": _has_module("PIL"),
        "numpy": _has_module("numpy"),
    }


def parse_dicom(request: ImageRequest, artifact_root: Path) -> WorkerResponse:
    if not _has_module("pydicom"):
        return error(
            "dependency_missing",
            "pydicom is required to parse DICOM files",
            trace_id=request.trace_id,
            detail={"dependency": "pydicom"},
        )

    path = resolve_uri(request.image_uri, artifact_root)
    if not path.exists():
        return _file_not_found(request, path)

    import pydicom  # type: ignore[import-not-found]

    dataset = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
    metadata = {
        "study_instance_uid": _dicom_value(dataset, "StudyInstanceUID"),
        "series_instance_uid": _dicom_value(dataset, "SeriesInstanceUID"),
        "sop_instance_uid": _dicom_value(dataset, "SOPInstanceUID"),
        "modality": _dicom_value(dataset, "Modality"),
        "body_part": _dicom_value(dataset, "BodyPartExamined"),
        "manufacturer": _dicom_value(dataset, "Manufacturer"),
        "rows": _dicom_value(dataset, "Rows"),
        "columns": _dicom_value(dataset, "Columns"),
        "pixel_spacing": _dicom_value(dataset, "PixelSpacing"),
    }
    metadata = {key: value for key, value in metadata.items() if value not in (None, "")}
    return ok(
        {
            "study_id": request.study_id,
            "image_id": request.image_id,
            "metadata": metadata,
            "phi_removed_from_response": True,
        },
        trace_id=request.trace_id,
    )


def deidentify_dicom(request: OutputImageRequest, artifact_root: Path) -> WorkerResponse:
    if not _has_module("pydicom"):
        return error(
            "dependency_missing",
            "pydicom is required to deidentify DICOM files",
            trace_id=request.trace_id,
            detail={"dependency": "pydicom"},
        )
    if not request.output_uri:
        return error("invalid_request", "output_uri is required", trace_id=request.trace_id)

    source = resolve_uri(request.image_uri, artifact_root)
    target = resolve_uri(request.output_uri, artifact_root)
    if not source.exists():
        return _file_not_found(request, source)

    import pydicom  # type: ignore[import-not-found]

    dataset = pydicom.dcmread(str(source), force=True)
    dataset.remove_private_tags()
    for tag in PHI_TAGS:
        if tag in dataset:
            dataset.data_element(tag).value = ""
    target.parent.mkdir(parents=True, exist_ok=True)
    dataset.save_as(str(target))
    return ok({"output_uri": request.output_uri, "removed_tags": list(PHI_TAGS)}, trace_id=request.trace_id)


def render_preview(request: RenderPreviewRequest, artifact_root: Path) -> WorkerResponse:
    source = resolve_uri(request.image_uri, artifact_root)
    if not source.exists():
        return _file_not_found(request, source)
    if not request.output_uri:
        return error("invalid_request", "output_uri is required", trace_id=request.trace_id)

    target = resolve_uri(request.output_uri, artifact_root)
    image = _load_raster_image(source, request.trace_id)
    if isinstance(image, WorkerResponse):
        return image

    image.thumbnail((request.max_size, request.max_size))
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    return ok(
        {
            "output_uri": request.output_uri,
            "width": image.width,
            "height": image.height,
            "format": target.suffix.lstrip(".").lower() or "png",
        },
        trace_id=request.trace_id,
    )


def preprocess_ultrasound(request: PreprocessUltrasoundRequest, artifact_root: Path) -> WorkerResponse:
    source = resolve_uri(request.image_uri, artifact_root)
    if not source.exists():
        return _file_not_found(request, source)
    if not request.output_uri:
        return error("invalid_request", "output_uri is required", trace_id=request.trace_id)

    target = resolve_uri(request.output_uri, artifact_root)
    image = _load_raster_image(source, request.trace_id)
    if isinstance(image, WorkerResponse):
        return image

    from PIL import ImageOps

    processed = ImageOps.grayscale(image)
    if request.normalize:
        processed = ImageOps.autocontrast(processed)
    processed.thumbnail((request.target_size, request.target_size))
    target.parent.mkdir(parents=True, exist_ok=True)
    processed.save(target)
    return ok(
        {
            "output_uri": request.output_uri,
            "width": processed.width,
            "height": processed.height,
            "preprocessing": {
                "grayscale": True,
                "autocontrast": request.normalize,
                "target_size": request.target_size,
            },
        },
        trace_id=request.trace_id,
    )


def extract_calibration(request: ImageRequest, artifact_root: Path) -> WorkerResponse:
    pixel_spacing = request.metadata.get("pixel_spacing") or request.metadata.get("PixelSpacing")
    if pixel_spacing:
        return ok(
            {
                "pixel_spacing": pixel_spacing,
                "source": "request_metadata",
                "requires_manual_calibration": False,
            },
            trace_id=request.trace_id,
        )

    parsed = parse_dicom(request, artifact_root)
    if parsed.status == "ok":
        dicom_spacing = parsed.result.get("metadata", {}).get("pixel_spacing")
        if dicom_spacing:
            return ok(
                {
                    "pixel_spacing": dicom_spacing,
                    "source": "dicom_metadata",
                    "requires_manual_calibration": False,
                },
                trace_id=request.trace_id,
            )

    return ok(
        {
            "pixel_spacing": None,
            "source": "none",
            "requires_manual_calibration": True,
        },
        trace_id=request.trace_id,
        warnings=["pixel spacing was not found; millimeter measurements must be blocked"],
    )


def image_quality_check(request: ImageRequest, artifact_root: Path) -> WorkerResponse:
    source = resolve_uri(request.image_uri, artifact_root)
    if not source.exists():
        return _file_not_found(request, source)

    image = _load_raster_image(source, request.trace_id)
    if isinstance(image, WorkerResponse):
        return image

    score, issues = _quality_score(image)
    return ok(
        {
            "quality_score": score,
            "is_analyzable": score >= 0.55,
            "issues": issues,
            "image_type": "thyroid_ultrasound",
            "width": image.width,
            "height": image.height,
        },
        trace_id=request.trace_id,
    )


def copy_input(request: OutputImageRequest, artifact_root: Path) -> WorkerResponse:
    if not request.output_uri:
        return error("invalid_request", "output_uri is required", trace_id=request.trace_id)
    source = resolve_uri(request.image_uri, artifact_root)
    target = resolve_uri(request.output_uri, artifact_root)
    if not source.exists():
        return _file_not_found(request, source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return ok({"output_uri": request.output_uri}, trace_id=request.trace_id)


def resolve_uri(uri: str, artifact_root: Path) -> Path:
    if uri.startswith("artifact://"):
        relative = uri[len("artifact://") :].lstrip("/")
        if not relative:
            raise ValueError("artifact URI must include a path")
        root = artifact_root.expanduser().resolve()
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise ValueError("artifact URI cannot escape artifact root")
        return path
    if uri.startswith("file://"):
        return Path(urlparse(uri).path).expanduser()
    return Path(uri).expanduser()


def _file_not_found(request: ImageRequest, path: Path) -> WorkerResponse:
    return error(
        "file_not_found",
        "input image does not exist",
        trace_id=request.trace_id,
        detail={"path": str(path)},
    )


def _load_raster_image(path: Path, trace_id: str | None) -> Any | WorkerResponse:
    if not _has_module("PIL"):
        return error(
            "dependency_missing",
            "Pillow is required for raster image operations",
            trace_id=trace_id,
            detail={"dependency": "Pillow"},
        )
    try:
        from PIL import Image

        image = Image.open(path)
        image.load()
        return image.convert("RGB")
    except Exception as exc:
        return error(
            "unsupported_image",
            "image could not be opened as PNG/JPEG; DICOM rendering requires pydicom support",
            trace_id=trace_id,
            detail={"reason": str(exc)},
        )


def _quality_score(image: Any) -> tuple[float, list[str]]:
    issues: list[str] = []
    min_side = min(image.width, image.height)
    size_score = min(1.0, min_side / 512)
    if min_side < 256:
        issues.append("low_resolution")

    from PIL import ImageStat

    gray = image.convert("L")
    contrast = float(ImageStat.Stat(gray).stddev[0])
    contrast_score = min(1.0, contrast / 48)
    if contrast < 12:
        issues.append("low_contrast")

    score = round((0.45 * size_score) + (0.55 * contrast_score), 4)
    return score, issues


def _dicom_value(dataset: Any, name: str) -> Any:
    value = getattr(dataset, name, None)
    if hasattr(value, "original_string"):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return value


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None
