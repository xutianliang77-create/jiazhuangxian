#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python}"

echo "== System =="
uname -a
command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi || echo "nvidia-smi: not found"

echo "== Python runtime =="
"$PYTHON_BIN" --version
"$PYTHON_BIN" - <<'PY'
import importlib.util
import json
import sys

payload = {
    "executable": sys.executable,
    "packages": {},
    "torch": None,
}
for name in ["pydantic", "numpy", "cv2", "PIL", "ultralytics", "torch", "rfdetr"]:
    payload["packages"][name] = importlib.util.find_spec(name) is not None
try:
    import torch
    payload["torch"] = {
        "version": torch.__version__,
        "cuda_runtime": getattr(torch.version, "cuda", None),
        "cuda_available": torch.cuda.is_available(),
        "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "devices": [],
    }
    if torch.cuda.is_available():
        for index in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(index)
            payload["torch"]["devices"].append({
                "index": index,
                "name": props.name,
                "total_memory_mb": props.total_memory // (1024 * 1024),
                "capability": ".".join(str(x) for x in torch.cuda.get_device_capability(index)),
            })
except Exception as exc:
    payload["torch"] = {"error": str(exc)}
print(json.dumps(payload, ensure_ascii=False, indent=2))
PY

echo "== model-gateway =="
JZX_DATA_DB="${JZX_DATA_DB:-$ROOT_DIR/data/artifacts/medical/data.db}" \
JZX_ARTIFACT_ROOT="${JZX_ARTIFACT_ROOT:-$ROOT_DIR/data/artifacts}" \
npm run model-gateway:check
