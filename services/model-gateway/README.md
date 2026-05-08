# model-gateway

Python 模型服务入口，负责模型路由、SQLite `model_job` 队列和本地推理 worker 调度。

验证版定位：

- 接收 MCP/HTTP 推理请求。
- 写入 SQLite `model_job` 队列并返回 `job_id`。
- 暂不加载真实模型权重；真实 GPU worker 后续消费 `model_job`。
- 记录模型名、版本、权重 hash、输入 JSON、状态、重试次数和 artifact URI。

当前接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 服务健康检查 |
| `POST` | `/model/v1/infer/thyroid/detect-nodules` | 创建甲状腺结节检测任务 |
| `GET` | `/model/v1/jobs/{job_id}` | 查询模型任务 |
| `GET` | `/model/v1/config/check` | 检查检测模型权重、运行时包和 GPU/CUDA 状态 |

当前 worker：

- `python3 -m app.worker --once`：claim 一条 `queued` 任务并退出。
- `python3 -m app.worker`：循环消费队列，空闲时按 `JZX_MODEL_WORKER_INTERVAL_MS` 休眠。
- `thyroid.detect_nodules` 会根据 `model_name` 选择检测 adapter，HTTP 入队接口和 SQLite 队列表保持不变。
- 默认主模型 adapter：YOLOv11 / Ultralytics YOLO，权重路径通过 `JZX_YOLOV11_WEIGHTS` 配置。
- Transformer 对照 adapter：RT-DETR / Ultralytics RTDETR，权重路径通过 `JZX_RTDETR_WEIGHTS` 配置。
- RF-DETR adapter 边界已保留，权重路径为 `JZX_RFDETR_WEIGHTS`，运行时包接入后补齐执行逻辑。
- 未配置权重时任务会被标记为 `failed`，错误码为 `detector_not_configured`，并返回缺失的环境变量。

计划能力：

- 甲状腺结节检测：YOLOv11 主模型，RT-DETR/RF-DETR 对照
- 结节分割测量：MedSAM/MedSAM2、nnU-Net、Swin U-Net
- TI-RADS 特征识别：ResNet50、ViT/TC-ViT、多模态融合
- 报告与复核模型 endpoint：Qwen3.6、MedGemma
- 模型版本、权重 hash、推理参数和 artifact URI 记录

## 本地启动

```bash
cd services/model-gateway
python3 -m pip install -r requirements.txt
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db python3 -m app
```

处理一条队列任务：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db python3 -m app.worker --once
```

配置 YOLOv11 检测 adapter：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db \
JZX_ARTIFACT_ROOT=../../data/artifacts \
JZX_YOLOV11_WEIGHTS=/absolute/path/to/yolov11-thyroid.pt \
python3 -m app.worker --once
```

检查模型网关配置：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db \
JZX_ARTIFACT_ROOT=../../data/artifacts \
JZX_YOLOV11_WEIGHTS=/absolute/path/to/yolov11-thyroid.pt \
python3 -m app.config_check
```

根目录也提供了同等命令：

```bash
npm run model-gateway:check -- --db data/artifacts/medical/data.db
```

配置检查会报告：

- Python 版本、可执行路径和平台。
- `pydantic`、`numpy`、`opencv-python`、`pillow` 等基础包。
- `ultralytics`、`torch`、`rfdetr` 等检测运行时包。
- YOLOv11、RT-DETR、RF-DETR 权重环境变量、路径存在性、是否可读和文件大小。
- Torch/CUDA 是否可用、GPU 数量、设备名称和显存。

配置 RT-DETR 对照 adapter：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db \
JZX_ARTIFACT_ROOT=../../data/artifacts \
JZX_RTDETR_WEIGHTS=/absolute/path/to/rtdetr-thyroid.pt \
python3 -m app.worker --once
```

默认监听：

```text
http://127.0.0.1:8766
```

## 请求示例

```bash
curl -s http://127.0.0.1:8766/health
```

```bash
curl -s http://127.0.0.1:8766/model/v1/infer/thyroid/detect-nodules \
  -H 'content-type: application/json' \
  -d '{
    "study_id": "S1",
    "image_id": "IMG1",
    "image_uri": "artifact://model-ready/S1/IMG1.png",
    "model": "yolov11-thyroid-detector",
    "model_version": "validation-placeholder",
    "trace_id": "TRACE1"
  }'
```

## 测试

```bash
python3 -m unittest discover services/model-gateway/tests
```
