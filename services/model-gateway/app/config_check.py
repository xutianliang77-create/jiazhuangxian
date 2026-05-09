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


def build_config_report(
    *,
    env: Mapping[str, str] | None = None,
    db_path: Path | None = None,
) -> JsonDict:
    source_env = os.environ if env is None else env
    base_packages = [package_status(import_name, package_name) for import_name, package_name in BASE_PACKAGES]
    detectors = [detector_status(spec, source_env) for spec in DETECTOR_SPECS]
    gpu = gpu_status()
    ready_detectors = [item for item in detectors if item["ready"]]
    missing_base = [item for item in base_packages if item["required"] and not item["installed"]]
    warnings: list[str] = []
    if not ready_detectors:
        warnings.append("no_detector_ready")
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
        "ready_detectors": [item["model_family"] for item in ready_detectors],
        "warnings": warnings,
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
