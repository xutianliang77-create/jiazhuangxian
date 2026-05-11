#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv-model-gateway-gpu}"
MODE="${1:-gateway}"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "GPU virtualenv not found: $VENV_DIR" >&2
  echo "Run scripts/setup-remote-5090-gpu.sh on the 5090 host first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

export JZX_MODEL_GATEWAY_HOST="${JZX_MODEL_GATEWAY_HOST:-0.0.0.0}"
export JZX_MODEL_GATEWAY_PORT="${JZX_MODEL_GATEWAY_PORT:-8766}"
export JZX_DATA_DB="${JZX_DATA_DB:-$ROOT_DIR/data/artifacts/medical/data.db}"
export JZX_ARTIFACT_ROOT="${JZX_ARTIFACT_ROOT:-$ROOT_DIR/data/artifacts}"
export JZX_MODEL_DEVICE="${JZX_MODEL_DEVICE:-0}"

export JZX_RFDETR_WEIGHTS="${JZX_RFDETR_WEIGHTS:-$ROOT_DIR/data/artifacts/model-training/tn5000-rfdetr/runs/tn5000-clean-rfdetr-medium-80-20-e40-r576-b4x4-target90/checkpoint_best_ema.pth}"
export JZX_RFDETR_RESOLUTION="${JZX_RFDETR_RESOLUTION:-576}"
export JZX_YOLOV11_WEIGHTS="${JZX_YOLOV11_WEIGHTS:-$ROOT_DIR/runs/detect/data/artifacts/model-training/tn5000-yolo/runs/tn5000-clean-yolo11m-80-20-e150-i896-b16-target90/weights/best.pt}"
export JZX_RTDETR_WEIGHTS="${JZX_RTDETR_WEIGHTS:-$ROOT_DIR/runs/detect/data/artifacts/model-training/tn5000-rtdetr/runs/tn5000-clean-rtdetr-l-80-20-e120-i896-b8-target90/weights/best.pt}"

export JZX_NNUNET_RESULTS="${JZX_NNUNET_RESULTS:-$ROOT_DIR/data/nnunet/nnUNet_results}"
export JZX_NNUNET_RAW="${JZX_NNUNET_RAW:-$ROOT_DIR/data/nnunet/nnUNet_raw}"
export JZX_NNUNET_PREPROCESSED="${JZX_NNUNET_PREPROCESSED:-$ROOT_DIR/data/nnunet/nnUNet_preprocessed}"
export JZX_NNUNET_PREDICT_BIN="${JZX_NNUNET_PREDICT_BIN:-$VENV_DIR/bin/nnUNetv2_predict}"
export JZX_NNUNET_DATASET="${JZX_NNUNET_DATASET:-503}"
export JZX_NNUNET_CONFIGURATION="${JZX_NNUNET_CONFIGURATION:-2d}"
export JZX_NNUNET_TRAINER="${JZX_NNUNET_TRAINER:-nnUNetTrainer_100epochs}"
export JZX_NNUNET_PLANS="${JZX_NNUNET_PLANS:-nnUNetPlans}"
export JZX_NNUNET_FOLDS="${JZX_NNUNET_FOLDS:-0 1 2 3 4}"
export JZX_NNUNET_CHECKPOINT="${JZX_NNUNET_CHECKPOINT:-checkpoint_best.pth}"

export JZX_MEDSAM2_WEIGHTS="${JZX_MEDSAM2_WEIGHTS:-$ROOT_DIR/data/models/segmentation/medsam2/sam2.1_hiera_large.pt}"
export JZX_MEDSAM2_CONFIG="${JZX_MEDSAM2_CONFIG:-$ROOT_DIR/data/models/segmentation/medsam2/sam2.1_hiera_l.yaml}"
export JZX_SAM2_IMAGE_CONFIG="${JZX_SAM2_IMAGE_CONFIG:-$JZX_MEDSAM2_CONFIG}"

cd "$ROOT_DIR/services/model-gateway"

case "$MODE" in
  gateway)
    exec python -m app
    ;;
  worker)
    exec python -m app.worker
    ;;
  check)
    exec python -m app.config_check --strict
    ;;
  *)
    echo "Usage: $0 [gateway|worker|check]" >&2
    exit 2
    ;;
esac
