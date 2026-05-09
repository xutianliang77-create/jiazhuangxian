# 远程 RTX 5090 GPU 推理环境配置

本文档用于把远程 RTX 5090 节点配置成验证版 `model-gateway` / `model-worker` 推理环境。当前仓库所在 Mac 可以开发和调度，但不能运行 CUDA 版 PyTorch；真实检测推理应在远程 5090 主机上执行。

## 目标

- Python：推荐 3.12。
- CUDA：优先使用 PyTorch CUDA 12.8 wheel。
- 检测主线：YOLOv11 / Ultralytics。
- 检测对照：RT-DETR / Ultralytics。
- RF-DETR：保留可选安装，等包版本和权重确认后启用。
- 权重不入 Git，统一通过环境变量传入。

## 远程主机要求

```bash
nvidia-smi
python3.12 --version
node --version
npm --version
git --version
```

`nvidia-smi` 必须能看到 RTX 5090 和可用显存。若 `nvidia-smi` 不存在，先安装或修复 NVIDIA driver/CUDA runtime。

## 安装

在远程 5090 主机的项目目录中运行：

```bash
cd /path/to/jiazhuangxian
bash scripts/setup-remote-5090-gpu.sh
```

如果 Python 3.12 路径不是 `python3.12`：

```bash
bash scripts/setup-remote-5090-gpu.sh --python /usr/bin/python3.12
```

如果远程节点访问 `download.pytorch.org` 很慢，可使用 wheel 镜像和固定版本。当前 5090 节点已验证这组版本可用：

```bash
bash scripts/setup-remote-5090-gpu.sh \
  --torch-find-links https://mirrors.aliyun.com/pytorch-wheels/cu128/ \
  --torch-version 2.11.0+cu128
```

脚本会创建：

```text
.venv-model-gateway-gpu/
```

并安装：

- CUDA PyTorch：`torch`、`torchvision`、`torchaudio`
- 模型网关基础依赖：`pydantic`、`numpy`、`opencv-python`、`Pillow`
- 检测运行时：`ultralytics`

## 权重配置

推荐目录：

```text
data/artifacts/model-weights/
  yolo/
    yolov11-thyroid.pt
  rtdetr/
    rtdetr-thyroid.pt
  rfdetr/
    rfdetr-thyroid.pt
```

环境变量：

```bash
source .venv-model-gateway-gpu/bin/activate
export JZX_DATA_DB=/path/to/jiazhuangxian/data/artifacts/medical/data.db
export JZX_ARTIFACT_ROOT=/path/to/jiazhuangxian/data/artifacts
export JZX_YOLOV11_WEIGHTS=/path/to/jiazhuangxian/data/artifacts/model-weights/yolo/yolov11-thyroid.pt
export JZX_RTDETR_WEIGHTS=/path/to/jiazhuangxian/data/artifacts/model-weights/rtdetr/rtdetr-thyroid.pt
export JZX_MODEL_DEVICE=0
```

如果只先验证 YOLOv11，`JZX_RTDETR_WEIGHTS` 可以暂时不设。

`JZX_MODEL_DEVICE` 传给 Ultralytics `predict(device=...)`。单卡 5090 验证环境推荐设为 `0`；不设置时使用 Ultralytics 自动设备选择。

## 检查

```bash
bash scripts/check-remote-5090-gpu.sh
npm run model-gateway:check
npm run model-gateway:check -- --strict
```

`--strict` 需要至少一个 detector ready；如果没有设置权重，会返回非 0。

成功时应看到：

```text
runtime.gpu.cuda_available = true
runtime.gpu.device_count >= 1
ready_detectors includes "yolov11" or "rt-detr"
```

## 启动推理服务

终端 1：

```bash
source .venv-model-gateway-gpu/bin/activate
export JZX_DATA_DB=/path/to/jiazhuangxian/data/artifacts/medical/data.db
export JZX_ARTIFACT_ROOT=/path/to/jiazhuangxian/data/artifacts
export JZX_YOLOV11_WEIGHTS=/path/to/jiazhuangxian/data/artifacts/model-weights/yolo/yolov11-thyroid.pt
export JZX_MODEL_DEVICE=0
npm run model-gateway
```

终端 2：

```bash
source .venv-model-gateway-gpu/bin/activate
export JZX_DATA_DB=/path/to/jiazhuangxian/data/artifacts/medical/data.db
export JZX_ARTIFACT_ROOT=/path/to/jiazhuangxian/data/artifacts
export JZX_YOLOV11_WEIGHTS=/path/to/jiazhuangxian/data/artifacts/model-weights/yolo/yolov11-thyroid.pt
export JZX_MODEL_DEVICE=0
npm run model-worker
```

## 与医疗 Agent 联动

Web、`medical-agent-worker`、`model-gateway`、`model-worker` 必须共用同一个：

```bash
JZX_DATA_DB
JZX_ARTIFACT_ROOT
```

否则医生工作台创建的病例、图像和 agent task 与 GPU worker 消费的 `model_job` 不在同一个 SQLite 库中。

## 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `nvidia-smi: not found` | 远程主机 NVIDIA driver 未配置 | 先修复驱动/CUDA runtime |
| `cuda_available=false` | PyTorch wheel、驱动或容器 GPU 映射不匹配 | 重新安装 CUDA PyTorch，检查容器 `--gpus all` |
| `weights_env_missing` | 未设置权重环境变量 | 设置 `JZX_YOLOV11_WEIGHTS` 或 `JZX_RTDETR_WEIGHTS` |
| `weights_path_missing` | 环境变量路径不存在 | 把权重放到对应目录，或修正路径 |
| `runtime_package_missing` | venv 未激活或依赖未安装 | `source .venv-model-gateway-gpu/bin/activate` 后重试 |
| `detector_not_configured` | worker 能运行但没有权重 | 配置权重后重新执行 model-worker |
