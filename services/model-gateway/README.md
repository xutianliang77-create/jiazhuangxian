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
