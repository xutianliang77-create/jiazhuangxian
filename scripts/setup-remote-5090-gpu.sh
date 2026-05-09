#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv-model-gateway-gpu}"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu128}"
INSTALL_RFDETR=0

usage() {
  cat <<USAGE
Usage: bash scripts/setup-remote-5090-gpu.sh [options]

Options:
  --python PATH          Python executable to use. Default: \$PYTHON_BIN or python3.12
  --venv PATH            Virtualenv path. Default: \$VENV_DIR or .venv-model-gateway-gpu
  --torch-index URL      PyTorch CUDA wheel index. Default: $TORCH_INDEX_URL
  --install-rfdetr       Also install the optional RF-DETR runtime package
  -h, --help             Show this help

Environment after install:
  source "$VENV_DIR/bin/activate"
  export JZX_DATA_DB="$ROOT_DIR/data/artifacts/medical/data.db"
  export JZX_ARTIFACT_ROOT="$ROOT_DIR/data/artifacts"
  export JZX_YOLOV11_WEIGHTS="/absolute/path/to/yolov11-thyroid.pt"
  npm run model-gateway:check -- --strict
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --python)
      PYTHON_BIN="$2"
      shift 2
      ;;
    --venv)
      VENV_DIR="$2"
      shift 2
      ;;
    --torch-index)
      TORCH_INDEX_URL="$2"
      shift 2
      ;;
    --install-rfdetr)
      INSTALL_RFDETR=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "== Host check =="
uname -a
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi was not found. Install NVIDIA driver/CUDA runtime on the remote 5090 host first." >&2
  exit 2
fi
nvidia-smi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python executable was not found: $PYTHON_BIN" >&2
  echo "Install Python 3.12 on the remote host, then rerun with --python /path/to/python3.12." >&2
  exit 2
fi

echo "== Python =="
"$PYTHON_BIN" --version
"$PYTHON_BIN" -m venv "$VENV_DIR"
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip setuptools wheel

echo "== Install CUDA PyTorch from $TORCH_INDEX_URL =="
python -m pip install --index-url "$TORCH_INDEX_URL" torch torchvision torchaudio

echo "== Install model-gateway GPU requirements =="
python -m pip install -r "$ROOT_DIR/services/model-gateway/requirements-gpu.txt"
if [[ "$INSTALL_RFDETR" -eq 1 ]]; then
  python -m pip install rfdetr
fi

echo "== Runtime verification =="
python - <<'PY'
import json
import torch

payload = {
    "torch_version": torch.__version__,
    "torch_cuda": getattr(torch.version, "cuda", None),
    "cuda_available": torch.cuda.is_available(),
    "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
    "devices": [],
}
if torch.cuda.is_available():
    for index in range(torch.cuda.device_count()):
        props = torch.cuda.get_device_properties(index)
        payload["devices"].append({
            "index": index,
            "name": props.name,
            "total_memory_mb": props.total_memory // (1024 * 1024),
            "capability": ".".join(str(x) for x in torch.cuda.get_device_capability(index)),
        })
print(json.dumps(payload, ensure_ascii=False, indent=2))
raise SystemExit(0 if payload["cuda_available"] and payload["device_count"] > 0 else 3)
PY

echo "== model-gateway config check =="
JZX_DATA_DB="${JZX_DATA_DB:-$ROOT_DIR/data/artifacts/medical/data.db}" \
JZX_ARTIFACT_ROOT="${JZX_ARTIFACT_ROOT:-$ROOT_DIR/data/artifacts}" \
npm run model-gateway:check

cat <<DONE

GPU runtime setup finished.

Next:
  source "$VENV_DIR/bin/activate"
  export JZX_DATA_DB="$ROOT_DIR/data/artifacts/medical/data.db"
  export JZX_ARTIFACT_ROOT="$ROOT_DIR/data/artifacts"
  export JZX_YOLOV11_WEIGHTS="/absolute/path/to/yolov11-thyroid.pt"
  export JZX_RTDETR_WEIGHTS="/absolute/path/to/rtdetr-thyroid.pt"
  npm run model-gateway:check -- --strict
  npm run model-worker:once
DONE
