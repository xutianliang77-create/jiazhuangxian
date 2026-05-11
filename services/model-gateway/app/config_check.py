from __future__ import annotations

import argparse
import importlib.metadata
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping

from .detectors import MODEL_DEVICE_ENV, RfDetrDetectorAdapter, RtDetrDetectorAdapter, YoloV11DetectorAdapter
from .segmentation import (
    MEDSAM2_CONFIG_ENV,
    MEDSAM2_WEIGHTS_ENV,
    MEDSAM_WEIGHTS_ENV,
    NNUNET_PREPROCESSED_ENV,
    NNUNET_PREDICT_BIN_ENV,
    NNUNET_RAW_ENV,
    NNUNET_RESULTS_ENV,
    SAM2_IMAGE_CONFIG_ENV,
    SAM2_CONFIG_ENV,
    SAM2_WEIGHTS_ENV,
    UNET_WEIGHTS_ENV,
)
from .store import default_db_path


JsonDict = dict[str, Any]

BASE_PACKAGES = (
    ("pydantic", "pydantic"),
    ("numpy", "numpy"),
    ("cv2", "opencv-python"),
    ("PIL", "pillow"),
)

DETECTOR_SPECS = (
    {
        "model_family": YoloV11DetectorAdapter.model_family,
        "adapter": YoloV11DetectorAdapter.adapter_name,
        "required_env": YoloV11DetectorAdapter.required_env,
        "runtime_packages": (("ultralytics", "ultralytics"), ("torch", "torch")),
    },
    {
        "model_family": RtDetrDetectorAdapter.model_family,
        "adapter": RtDetrDetectorAdapter.adapter_name,
        "required_env": RtDetrDetectorAdapter.required_env,
        "runtime_packages": (("ultralytics", "ultralytics"), ("torch", "torch")),
    },
    {
        "model_family": RfDetrDetectorAdapter.model_family,
        "adapter": RfDetrDetectorAdapter.adapter_name,
        "required_env": RfDetrDetectorAdapter.required_env,
        "runtime_packages": (("rfdetr", "rfdetr"), ("torch", "torch")),
    },
)

VIDEO_SEGMENTER_SPECS = (
    {
        "model_family": "sam2-video",
        "adapter": "sam2-video-predictor",
        "required_weights_env": (MEDSAM2_WEIGHTS_ENV, SAM2_WEIGHTS_ENV),
        "required_config_env": (MEDSAM2_CONFIG_ENV, SAM2_CONFIG_ENV),
        "runtime_packages": (("sam2", "sam2"), ("torch", "torch"), ("numpy", "numpy"), ("cv2", "opencv-python")),
    },
)

SEGMENTER_SPECS = (
    {
        "model_family": "medsam",
        "adapter": "medsam-sam-predictor",
        "required_weights_env": (MEDSAM_WEIGHTS_ENV,),
        "runtime_packages": (("segment_anything", "segment-anything"), ("torch", "torch"), ("numpy", "numpy"), ("PIL", "pillow")),
    },
    {
        "model_family": "sam2-static",
        "adapter": "sam2-image-predictor",
        "required_weights_env": (MEDSAM2_WEIGHTS_ENV, SAM2_WEIGHTS_ENV),
        "required_config_env": (SAM2_IMAGE_CONFIG_ENV, MEDSAM2_CONFIG_ENV, SAM2_CONFIG_ENV),
        "runtime_packages": (("sam2", "sam2"), ("torch", "torch"), ("numpy", "numpy"), ("PIL", "pillow")),
    },
    {
        "model_family": "unet",
        "adapter": "torchscript-unet",
        "required_weights_env": (UNET_WEIGHTS_ENV,),
        "runtime_packages": (("torch", "torch"), ("numpy", "numpy"), ("PIL", "pillow")),
    },
    {
        "model_family": "nnunet-tight-roi",
        "adapter": "nnunetv2-detector-roi",
        "required_dir_env": (NNUNET_RESULTS_ENV, "nnUNet_results"),
        "optional_dir_env": (NNUNET_RAW_ENV, "nnUNet_raw", NNUNET_PREPROCESSED_ENV, "nnUNet_preprocessed"),
        "required_executable_env": NNUNET_PREDICT_BIN_ENV,
        "default_executable": "nnUNetv2_predict",
        "runtime_packages": (("nnunetv2", "nnunetv2"), ("numpy", "numpy"), ("PIL", "pillow")),
    },
)


def build_config_report(
    *,
    env: Mapping[str, str] | None = None,
    db_path: Path | None = None,
) -> JsonDict:
    source_env = os.environ if env is None else env
    base_packages = [package_status(import_name, package_name) for import_name, package_name in BASE_PACKAGES]
    detectors = [detector_status(spec, source_env) for spec in DETECTOR_SPECS]
    segmenters = [segmenter_status(spec, source_env) for spec in SEGMENTER_SPECS]
    video_segmenters = [video_segmenter_status(spec, source_env) for spec in VIDEO_SEGMENTER_SPECS]
    gpu = gpu_status()
    ready_detectors = [item for item in detectors if item["ready"]]
    ready_segmenters = [item for item in segmenters if item["ready"]]
    ready_video_segmenters = [item for item in video_segmenters if item["ready"]]
    pipeline = pipeline_status(detectors, segmenters, video_segmenters, source_env)
    missing_base = [item for item in base_packages if item["required"] and not item["installed"]]
    warnings: list[str] = []
    if not ready_detectors:
        warnings.append("no_detector_ready")
    if not ready_segmenters:
        warnings.append("no_segmenter_ready")
    if not ready_video_segmenters:
        warnings.append("no_video_segmenter_ready")
    if not gpu["cuda_available"]:
        warnings.append("cuda_unavailable")
    if missing_base:
        warnings.append("base_runtime_missing")

    return {
        "status": "ready" if ready_detectors and not missing_base else "degraded",
        "service": "model-gateway",
        "runtime": {
            "python": {
                "version": sys.version.split()[0],
                "executable": sys.executable,
                "platform": platform.platform(),
            },
            "packages": base_packages,
            "gpu": gpu,
            "inference_device": inference_device_status(source_env),
        },
        "storage": {
            "data_db": str(db_path or Path(source_env.get("JZX_DATA_DB", default_db_path()))),
            "artifact_root": str(Path(source_env.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser()),
        },
        "detectors": detectors,
        "segmenters": segmenters,
        "video_segmenters": video_segmenters,
        "ready_detectors": [item["model_family"] for item in ready_detectors],
        "ready_segmenters": [item["model_family"] for item in ready_segmenters],
        "ready_video_segmenters": [item["model_family"] for item in ready_video_segmenters],
        "pipeline": pipeline,
        "warnings": warnings,
    }


def pipeline_status(
    detectors: list[JsonDict],
    segmenters: list[JsonDict],
    video_segmenters: list[JsonDict],
    env: Mapping[str, str],
) -> JsonDict:
    detector_by_family = {str(item["model_family"]): item for item in detectors}
    segmenter_by_family = {str(item["model_family"]): item for item in segmenters}
    video_by_family = {str(item["model_family"]): item for item in video_segmenters}
    strict_real_inference = (env.get("JZX_MEDICAL_REAL_INFERENCE") or "").strip() == "1"
    rfdetr_ready = bool(detector_by_family.get("rf-detr", {}).get("ready"))
    yolo_ready = bool(detector_by_family.get("yolov11", {}).get("ready"))
    nnunet_ready = bool(segmenter_by_family.get("nnunet-tight-roi", {}).get("ready"))
    sam2_static_ready = bool(segmenter_by_family.get("sam2-static", {}).get("ready"))
    medsam_ready = bool(segmenter_by_family.get("medsam", {}).get("ready"))
    sam2_video_ready = bool(video_by_family.get("sam2-video", {}).get("ready"))
    static_warnings: list[str] = []
    if not rfdetr_ready:
        static_warnings.append("primary_detector_not_ready:rf-detr")
    if not yolo_ready:
        static_warnings.append("comparator_detector_not_ready:yolov11")
    if not nnunet_ready:
        static_warnings.append("primary_segmenter_not_ready:nnunet-tight-roi")
    if not (sam2_static_ready or medsam_ready):
        static_warnings.append("review_segmenter_not_ready:sam2-or-medsam")
    video_warnings = [] if sam2_video_ready else ["video_segmenter_not_ready:sam2-video"]
    return {
        "policy_version": "thyroid-gpu-pipeline-v1",
        "strict_real_inference": strict_real_inference,
        "static_image_chain": {
            "status": "ready" if rfdetr_ready and yolo_ready and nnunet_ready else "degraded",
            "detector": {
                "primary": "rf-detr",
                "comparator": "yolov11",
                "consensus_iou_threshold": 0.5,
                "primary_ready": rfdetr_ready,
                "comparator_ready": yolo_ready,
            },
            "segmenter": {
                "primary": "nnunet-tight-roi",
                "review_options": ["sam2-static", "medsam"],
                "primary_ready": nnunet_ready,
                "review_ready": sam2_static_ready or medsam_ready,
                "bbox_fallback_default": not strict_real_inference,
            },
            "measurement": {
                "primary": "mask-measurement-worker",
                "requires_pixel_spacing_for_mm": True,
            },
            "warnings": static_warnings,
        },
        "video_chain": {
            "status": "ready" if sam2_video_ready else "degraded",
            "segmenter": {
                "primary": "sam2-video",
                "primary_ready": sam2_video_ready,
                "framewise_fallback_default": not strict_real_inference,
            },
            "measurement": {
                "primary": "video-mask-measurement-worker",
                "requires_pixel_spacing_for_mm": True,
            },
            "warnings": video_warnings,
        },
    }


def inference_device_status(env: Mapping[str, str]) -> JsonDict:
    raw = env.get(MODEL_DEVICE_ENV)
    value = raw.strip() if raw else None
    return {
        "env": MODEL_DEVICE_ENV,
        "configured": bool(value),
        "value": value,
        "effective": value or "auto",
    }


def detector_status(spec: Mapping[str, Any], env: Mapping[str, str]) -> JsonDict:
    packages = [package_status(import_name, package_name) for import_name, package_name in spec["runtime_packages"]]
    weights = weights_status(spec["required_env"], env)
    issues: list[JsonDict] = []
    if not weights["configured"]:
        issues.append({"code": "weights_env_missing", "required_env": list(spec["required_env"])})
    elif not weights["exists"]:
        issues.append({"code": "weights_path_missing", "path": weights["path"]})
    elif not weights["is_file"]:
        issues.append({"code": "weights_path_not_file", "path": weights["path"]})
    elif not weights["readable"]:
        issues.append({"code": "weights_not_readable", "path": weights["path"]})

    for package in packages:
        if not package["installed"]:
            issues.append({"code": "runtime_package_missing", "package": package["package"]})

    return {
        "model_family": spec["model_family"],
        "adapter": spec["adapter"],
        "ready": len(issues) == 0,
        "status": "ready" if len(issues) == 0 else "not_ready",
        "required_env": list(spec["required_env"]),
        "weights": weights,
        "runtime_packages": packages,
        "issues": issues,
    }


def segmenter_status(spec: Mapping[str, Any], env: Mapping[str, str]) -> JsonDict:
    packages = [package_status(import_name, package_name) for import_name, package_name in spec["runtime_packages"]]
    weights = weights_status(spec["required_weights_env"], env) if "required_weights_env" in spec else None
    directory = directory_status(spec["required_dir_env"], env) if "required_dir_env" in spec else None
    optional_directories = [directory_status((key,), env) for key in spec.get("optional_dir_env", ())]
    executable = executable_status(
        env_name=spec.get("required_executable_env"),
        default_name=spec.get("default_executable"),
        env=env,
    ) if spec.get("default_executable") else None
    required_config_env = tuple(spec.get("required_config_env", ()))
    config = config_path_status(required_config_env, env) if required_config_env else None
    issues: list[JsonDict] = []
    if weights is not None and not weights["configured"]:
        issues.append({"code": "weights_env_missing", "required_env": list(spec["required_weights_env"])})
    elif weights is not None and not weights["exists"]:
        issues.append({"code": "weights_path_missing", "path": weights["path"]})
    elif weights is not None and not weights["is_file"]:
        issues.append({"code": "weights_path_not_file", "path": weights["path"]})
    elif weights is not None and not weights["readable"]:
        issues.append({"code": "weights_not_readable", "path": weights["path"]})

    if directory is not None:
        if not directory["configured"]:
            issues.append({"code": "directory_env_missing", "required_env": list(spec["required_dir_env"])})
        elif not directory["exists"]:
            issues.append({"code": "directory_path_missing", "path": directory["path"]})
        elif not directory["is_dir"]:
            issues.append({"code": "directory_path_not_dir", "path": directory["path"]})

    if executable is not None and not executable["available"]:
        issues.append({"code": "executable_missing", "name": executable["name"], "env": executable["env"]})

    if config is not None:
        if not config["configured"]:
            issues.append({"code": "config_env_missing", "required_env": list(required_config_env)})
        elif config["path_like"] and not config["exists"]:
            issues.append({"code": "config_path_missing", "path": config["value"]})

    for package in packages:
        if not package["installed"]:
            issues.append({"code": "runtime_package_missing", "package": package["package"]})

    status = {
        "model_family": spec["model_family"],
        "adapter": spec["adapter"],
        "ready": len(issues) == 0,
        "status": "ready" if len(issues) == 0 else "not_ready",
        "runtime_packages": packages,
        "issues": issues,
    }
    if weights is not None:
        status["required_weights_env"] = list(spec["required_weights_env"])
        status["weights"] = weights
    if directory is not None:
        status["required_dir_env"] = list(spec["required_dir_env"])
        status["directory"] = directory
    if optional_directories:
        status["optional_directories"] = optional_directories
    if executable is not None:
        status["executable"] = executable
    if config is not None:
        status["required_config_env"] = list(required_config_env)
        status["config"] = config
    return status


def video_segmenter_status(spec: Mapping[str, Any], env: Mapping[str, str]) -> JsonDict:
    packages = [package_status(import_name, package_name) for import_name, package_name in spec["runtime_packages"]]
    weights = weights_status(spec["required_weights_env"], env)
    config = config_path_status(spec["required_config_env"], env)
    issues: list[JsonDict] = []
    if not weights["configured"]:
        issues.append({"code": "weights_env_missing", "required_env": list(spec["required_weights_env"])})
    elif not weights["exists"]:
        issues.append({"code": "weights_path_missing", "path": weights["path"]})
    elif not weights["is_file"]:
        issues.append({"code": "weights_path_not_file", "path": weights["path"]})
    elif not weights["readable"]:
        issues.append({"code": "weights_not_readable", "path": weights["path"]})

    if not config["configured"]:
        issues.append({"code": "config_env_missing", "required_env": list(spec["required_config_env"])})
    elif config["path_like"] and not config["exists"]:
        issues.append({"code": "config_path_missing", "path": config["value"]})

    for package in packages:
        if not package["installed"]:
            issues.append({"code": "runtime_package_missing", "package": package["package"]})

    return {
        "model_family": spec["model_family"],
        "adapter": spec["adapter"],
        "ready": len(issues) == 0,
        "status": "ready" if len(issues) == 0 else "not_ready",
        "required_weights_env": list(spec["required_weights_env"]),
        "required_config_env": list(spec["required_config_env"]),
        "weights": weights,
        "config": config,
        "runtime_packages": packages,
        "issues": issues,
    }


def weights_status(required_env: tuple[str, ...], env: Mapping[str, str]) -> JsonDict:
    for key in required_env:
        raw = env.get(key)
        if not raw:
            continue
        path = Path(raw).expanduser()
        exists = path.exists()
        is_file = path.is_file()
        readable = False
        size_bytes: int | None = None
        if exists and is_file:
            try:
                with path.open("rb"):
                    readable = True
                size_bytes = path.stat().st_size
            except OSError:
                readable = False
        return {
            "configured": True,
            "env": key,
            "path": str(path),
            "exists": exists,
            "is_file": is_file,
            "readable": readable,
            "size_bytes": size_bytes,
        }
    return {
        "configured": False,
        "env": None,
        "path": None,
        "exists": False,
        "is_file": False,
        "readable": False,
        "size_bytes": None,
    }


def directory_status(required_env: tuple[str, ...], env: Mapping[str, str]) -> JsonDict:
    for key in required_env:
        raw = env.get(key)
        if not raw:
            continue
        path = Path(raw).expanduser()
        return {
            "configured": True,
            "env": key,
            "path": str(path),
            "exists": path.exists(),
            "is_dir": path.is_dir(),
            "readable": os.access(path, os.R_OK) if path.exists() else False,
        }
    return {
        "configured": False,
        "env": None,
        "path": None,
        "exists": False,
        "is_dir": False,
        "readable": False,
    }


def executable_status(*, env_name: str | None, default_name: str | None, env: Mapping[str, str]) -> JsonDict:
    raw = env.get(env_name) if env_name else None
    name = raw.strip() if raw else default_name
    path = None
    if name:
        candidate = Path(name).expanduser()
        if candidate.exists():
            path = str(candidate)
        else:
            path = shutil.which(name)
    return {
        "env": env_name,
        "configured": bool(raw and raw.strip()),
        "name": name,
        "path": path,
        "available": bool(path),
    }


def config_path_status(required_env: tuple[str, ...], env: Mapping[str, str]) -> JsonDict:
    for key in required_env:
        raw = env.get(key)
        if not raw:
            continue
        value = raw.strip()
        if not value:
            continue
        path_like = "/" in value or "\\" in value or value.endswith((".yaml", ".yml"))
        path = Path(value).expanduser() if path_like else None
        return {
            "configured": True,
            "env": key,
            "value": value,
            "path_like": path_like,
            "exists": bool(path.exists()) if path else None,
        }
    return {
        "configured": False,
        "env": None,
        "value": None,
        "path_like": False,
        "exists": False,
    }


def package_status(import_name: str, package_name: str, *, required: bool = True) -> JsonDict:
    installed = importlib.util.find_spec(import_name) is not None
    version: str | None = None
    if installed:
        try:
            version = importlib.metadata.version(package_name)
        except importlib.metadata.PackageNotFoundError:
            version = None
    return {
        "package": package_name,
        "import_name": import_name,
        "installed": installed,
        "version": version,
        "required": required,
    }


def gpu_status() -> JsonDict:
    nvidia = nvidia_smi_status()
    if importlib.util.find_spec("torch") is None:
        return {
            "torch_installed": False,
            "torch_version": None,
            "torch_cuda_version": None,
            "cuda_available": False,
            "device_count": 0,
            "devices": [],
            "nvidia_smi": nvidia,
            "reason": "torch_not_installed",
        }
    try:
        import torch  # type: ignore[import-not-found]

        cuda_available = bool(torch.cuda.is_available())
        device_count = int(torch.cuda.device_count()) if cuda_available else 0
        devices = []
        for index in range(device_count):
            props = torch.cuda.get_device_properties(index)
            devices.append(
                {
                    "index": index,
                    "name": props.name,
                    "total_memory_mb": int(props.total_memory // (1024 * 1024)),
                    "capability": ".".join(str(item) for item in torch.cuda.get_device_capability(index)),
                }
            )
        return {
            "torch_installed": True,
            "torch_version": getattr(torch, "__version__", None),
            "torch_cuda_version": getattr(getattr(torch, "version", None), "cuda", None),
            "cuda_available": cuda_available,
            "device_count": device_count,
            "devices": devices,
            "nvidia_smi": nvidia,
        }
    except Exception as exc:
        return {
            "torch_installed": True,
            "torch_version": None,
            "torch_cuda_version": None,
            "cuda_available": False,
            "device_count": 0,
            "devices": [],
            "nvidia_smi": nvidia,
            "reason": str(exc),
        }


def nvidia_smi_status() -> JsonDict:
    executable = shutil.which("nvidia-smi")
    if executable is None:
        return {
            "available": False,
            "executable": None,
            "gpus": [],
            "driver_version": None,
            "cuda_version": None,
            "reason": "nvidia_smi_not_found",
        }
    try:
        query = subprocess.run(
            [
                executable,
                "--query-gpu=index,name,memory.total,driver_version",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        gpus = []
        driver_version = None
        for raw_line in query.stdout.splitlines():
            parts = [part.strip() for part in raw_line.split(",")]
            if len(parts) < 4:
                continue
            index, name, memory_total, driver_version = parts[:4]
            gpus.append(
                {
                    "index": int(index),
                    "name": name,
                    "memory_total_mb": int(float(memory_total)),
                    "driver_version": driver_version,
                }
            )
        summary = subprocess.run(
            [executable],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {
            "available": True,
            "executable": executable,
            "gpus": gpus,
            "driver_version": driver_version,
            "cuda_version": parse_nvidia_smi_cuda_version(summary.stdout),
        }
    except Exception as exc:
        return {
            "available": False,
            "executable": executable,
            "gpus": [],
            "driver_version": None,
            "cuda_version": None,
            "reason": str(exc),
        }


def parse_nvidia_smi_cuda_version(output: str) -> str | None:
    marker = "CUDA Version:"
    if marker not in output:
        return None
    tail = output.split(marker, 1)[1].strip()
    return tail.split()[0] if tail else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check model-gateway detector runtime configuration.")
    parser.add_argument("--db", default=os.environ.get("JZX_DATA_DB"), help="SQLite database path to report")
    parser.add_argument("--strict", action="store_true", help="exit non-zero unless at least one detector is ready")
    args = parser.parse_args(argv)

    report = build_config_report(db_path=Path(args.db) if args.db else None)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if args.strict and report["status"] != "ready" else 0


if __name__ == "__main__":
    raise SystemExit(main())
