# model-gateway

Python 模型服务入口，负责模型路由、SQLite `model_job` 队列和本地推理 worker 调度。

验证版定位：

- 接收 MCP/HTTP 推理请求。
- 写入 SQLite `model_job` 队列并返回 `job_id`。
- HTTP 服务只负责入队；GPU worker 消费 `model_job` 并加载本地权重执行推理。
- 记录模型名、版本、权重 hash、输入 JSON、状态、重试次数和 artifact URI。

当前接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 服务健康检查 |
| `POST` | `/model/v1/infer/thyroid/detect-nodules` | 创建甲状腺结节检测任务 |
| `POST` | `/model/v1/infer/thyroid/segment-nodule` | 创建甲状腺结节分割任务 |
| `POST` | `/model/v1/infer/thyroid/measure-nodule` | 创建甲状腺结节测量任务 |
| `POST` | `/model/v1/infer/thyroid/segment-video-nodule` | 创建甲状腺结节视频分割任务 |
| `POST` | `/model/v1/infer/thyroid/measure-video-nodule` | 创建甲状腺结节视频测量任务 |
| `GET` | `/model/v1/jobs/{job_id}` | 查询模型任务 |
| `GET` | `/model/v1/config/check` | 检查检测模型权重、运行时包和 GPU/CUDA 状态 |
| `GET` | `/model/v1/artifacts?uri=artifact://...` | 只读下载 overlay、mask、JSON 等模型产物 |

当前 worker：

- `python3 -m app.worker --once`：claim 一条 `queued` 任务并退出。
- `python3 -m app.worker`：循环消费队列，空闲时按 `JZX_MODEL_WORKER_INTERVAL_MS` 休眠。
- `thyroid.detect_nodules` 会根据 `model_name` 选择检测 adapter，HTTP 入队接口和 SQLite 队列表保持不变。
- `thyroid.segment_nodule` 默认静态主路线为 `nnunet-tight-roi-segmenter`：使用检测 bbox 裁剪 tight ROI，调用 nnU-Net v2 推理，再将 ROI mask 贴回原图并记录 `crop_box_xyxy` 等审计 metadata。
- `thyroid.segment_nodule` 仍支持 `bbox-fallback-segmenter`，会显式标注 `bbox_fallback` 并生成矩形 mask，供链路验证和医生复核，不等同于真实分割模型。
- `thyroid.segment_nodule` 已接入真实静态分割 adapter：nnU-Net Tight ROI、MedSAM/SAM bbox prompt、SAM2 image predictor bbox prompt、TorchScript U-Net/导出权重。关闭 fallback 时，未配置真实权重不会生成伪 mask。
- `thyroid.measure_nodule` 会基于 mask 或 bbox 计算像素测量；只有输入 `pixel_spacing` 时才输出毫米值，否则写入 `pixel_spacing_missing:mm_measurement_unavailable`。
- `thyroid.segment_video_nodule` 当前验证版支持 `video-bbox-fallback-segmenter`，只会在 prompt 帧生成明确标记的 bbox mask，供链路验证和医生复核，不等同于 MedSAM2/SAM2 真实视频传播。
- `thyroid.segment_video_nodule` 已预留 MedSAM2/SAM2 video predictor adapter：当 `model` 包含 `medsam2`/`sam2` 且配置完整时，会尝试调用真实 SAM2 视频传播；未配置时会返回明确 warning，关闭 fallback 时不会生成伪结果。
- `thyroid.measure_video_nodule` 会读取 `video_segmentation.json`，按 `max_long_axis_high_confidence` 等策略选择关键帧并生成视频测量；只有输入 `pixel_spacing` 时才输出毫米值。
- 真实 GPU 链路统一策略为 `thyroid-gpu-pipeline-v1`：静态图像采用 RF-DETR 主检测、YOLO11m 对照、nnU-Net Tight ROI 主分割、SAM2/MedSAM 复核；视频采用 SAM2/MedSAM2 video prompt 主路线。`JZX_MEDICAL_REAL_INFERENCE=1` 时，CodeClaw 医疗 Agent 自动排队分割任务会关闭 bbox fallback。
- 默认主模型 adapter：RF-DETR-Medium，权重路径通过 `JZX_RFDETR_WEIGHTS` 配置。
- 对照模型 adapter：YOLO11m / Ultralytics YOLO，权重路径通过 `JZX_YOLOV11_WEIGHTS` 配置；主模型为 RF-DETR 时会同步运行对照模型并生成 `comparison.json`。
- Transformer 对照 adapter：RT-DETR / Ultralytics RTDETR，权重路径通过 `JZX_RTDETR_WEIGHTS` 配置。
- 未配置权重时任务会被标记为 `failed`，错误码为 `detector_not_configured`，并返回缺失的环境变量。
- 推理成功时会把标准化检测结果写入 `artifact://model-output/thyroid-detect-nodules/<study>/<image>/<job>/detections.json`，并把 `model_job.artifact_uri` 指向该 JSON；当请求 `return_overlay=true` 且源图像可读取时，还会生成同目录 `overlay.png`。

计划能力：

- 甲状腺结节检测：RF-DETR-Medium 主模型，YOLO11m 对照模型，RT-DETR 研究对照
- 静态图像结节分割测量：默认主路线为 YOLO/RF-DETR bbox -> nnU-Net Tight ROI -> full-size mask；SAM2/MedSAM 用作交互式复核和疑难病例二次分割
- 视频结节分割测量：验证版 prompt-frame bbox fallback 和 MedSAM2/SAM2 adapter 壳已接入；配置权重后输出逐帧 mask、track_id、最大径帧和时间稳定性指标
- TI-RADS 特征识别：ResNet50、ViT/TC-ViT、多模态融合
- 报告与复核模型 endpoint：Qwen3.6、MedGemma
- 模型版本、权重 hash、推理参数和 artifact URI 记录

## 本地启动

```bash
cd services/model-gateway
python3 -m pip install -r requirements.txt
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db python3 -m app
```

远程 RTX 5090 GPU 推理环境见：

```text
docs/GPU_INFERENCE_SETUP.md
```

## MedSAM2/SAM2 分割配置

SAM2 adapter 是可选依赖。没有安装 `sam2` 或没有配置权重时，系统仍可运行验证版 fallback；关闭 fallback 后会返回明确未配置 warning，不会伪造真实 mask。

5090 上接真实 MedSAM2/SAM2 静态图像和视频分割时需要：

```bash
python -m pip install sam2==1.1.0
# If PyPI is unavailable, install from the official repository instead:
# python -m pip install "git+https://github.com/facebookresearch/sam2.git"

export JZX_MEDSAM2_WEIGHTS=/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/medsam2_or_sam2.pt
export JZX_MEDSAM2_CONFIG=/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_tiny.yaml
export JZX_SAM2_IMAGE_CONFIG=$JZX_MEDSAM2_CONFIG
export JZX_MODEL_DEVICE=cuda:0
```

兼容环境变量：

```text
JZX_MEDSAM2_WEIGHTS 或 JZX_SAM2_WEIGHTS
静态图像：JZX_SAM2_IMAGE_CONFIG、JZX_MEDSAM2_CONFIG 或 JZX_SAM2_VIDEO_CONFIG
视频：JZX_MEDSAM2_CONFIG 或 JZX_SAM2_VIDEO_CONFIG
```

`GET /model/v1/config/check` 会返回 `segmenters`、`video_segmenters`、`ready_segmenters` 和 `ready_video_segmenters`，用于确认 SAM2 包、权重和 config 是否就绪。

## nnU-Net Tight ROI 分割配置

`nnunet-tight-roi-segmenter` 是当前静态图像自动分割主路线。输入必须包含结节 bbox，通常来自 `thyroid.detect_nodules` 的检测结果；adapter 会按 bbox 裁剪 ROI、调用 `nnUNetv2_predict`，再把预测 mask 贴回原图。

5090 上使用本轮最佳 Dataset503 5-fold 权重时：

```bash
export JZX_NNUNET_RESULTS=/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results
export JZX_NNUNET_RAW=/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw
export JZX_NNUNET_PREPROCESSED=/home/beelink/jiazhuangxian/data/nnunet/nnUNet_preprocessed
export JZX_NNUNET_DATASET=503
export JZX_NNUNET_CONFIGURATION=2d
export JZX_NNUNET_TRAINER=nnUNetTrainer_100epochs
export JZX_NNUNET_PLANS=nnUNetPlans
export JZX_NNUNET_FOLDS="0 1 2 3 4"
export JZX_NNUNET_CHECKPOINT=checkpoint_best.pth
export JZX_NNUNET_ROI_SIZE=384
export JZX_NNUNET_ROI_MARGIN_RATIO=0.15
export JZX_NNUNET_MIN_CROP_SIZE=80
export JZX_MODEL_DEVICE=0
```

可选：`JZX_NNUNET_PREDICT_BIN` 指向虚拟环境中的 `nnUNetv2_predict`。

处理一条队列任务：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db python3 -m app.worker --once
```

配置 RF-DETR-Medium 主检测 + YOLO11m 对照检测：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db \
JZX_ARTIFACT_ROOT=../../data/artifacts \
JZX_RFDETR_WEIGHTS=/absolute/path/to/rfdetr-medium-thyroid.pth \
JZX_YOLOV11_WEIGHTS=/absolute/path/to/yolov11-thyroid.pt \
python3 -m app.worker --once
```

检查模型网关配置：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db \
JZX_ARTIFACT_ROOT=../../data/artifacts \
JZX_RFDETR_WEIGHTS=/absolute/path/to/rfdetr-medium-thyroid.pth \
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
- RF-DETR、YOLOv11、RT-DETR 权重环境变量、路径存在性、是否可读和文件大小。
- Torch/CUDA 是否可用、GPU 数量、设备名称和显存。
- `pipeline.policy_version = thyroid-gpu-pipeline-v1`，并分别报告静态图像链路和视频链路的主模型、对照模型、fallback 策略、ready/degraded 状态和 warning。

配置 RT-DETR 对照 adapter：

```bash
cd services/model-gateway
JZX_DATA_DB=../../data/artifacts/model-gateway/model-gateway.db \
JZX_ARTIFACT_ROOT=../../data/artifacts \
JZX_RTDETR_WEIGHTS=/absolute/path/to/rtdetr-thyroid.pt \
python3 -m app.worker --once
```

## 输出产物

检测模型成功后，worker 会写入标准化 JSON：

```text
artifact://model-output/thyroid-detect-nodules/<study_id>/<image_id>/<model_job_id>/detections.json
artifact://model-output/thyroid-detect-nodules/<study_id>/<image_id>/<model_job_id>/overlay.png
```

JSON 中包含：

- `schema_version = thyroid.detector.output.v1`
- 像素坐标系 `pixel_xyxy`
- 主模型信息、模型版本、权重 hash
- `detections[]`：bbox、confidence、class_id、source
- `artifacts`：检测 JSON、overlay 图、模型对比 JSON 的 URI 位置；overlay 只作为医生复核辅助图，不替代原图
- `detectors.primary`：RF-DETR-Medium 主模型摘要
- `detectors.comparators`：YOLO11m 对照模型摘要
- `detectors.consensus`：IoU 匹配后一致性状态，例如 `matched`、`primary_only`、`comparator_only`、`conflict`
- `evaluation`：检测产物级评估，记录双模型一致性、是否进入复核、复核原因
- `llm_evaluation`：待主 LLM/Qwen3.6 消费的结构化评估包，LLM 不直接生成或修改 bbox

当存在对照模型输出时，同目录 `comparison.json` 会额外包含 `quality_gate`：`pass` 表示 RF-DETR 与 YOLO11m 在 IoU 阈值下匹配且无对照模型 warning；`review` 表示缺失对照、冲突、单模型检出或无检出等情况，需要医生和主 LLM 重点复核。

分割任务成功后，worker 会写入：

```text
artifact://model-output/thyroid-segment-nodule/<study_id>/<image_id>/<model_job_id>/segmentation.json
artifact://model-output/thyroid-segment-nodule/<study_id>/<image_id>/<model_job_id>/mask_nodule_<index>.png
```

测量任务成功后，worker 会写入：

```text
artifact://model-output/thyroid-measure-nodule/<study_id>/<image_id>/<model_job_id>/measurements.json
```

视频分割和视频测量任务成功后会写入：

```text
artifact://model-output/thyroid-segment-video-nodule/<study_id>/<video_id>/<model_job_id>/video_segmentation.json
artifact://model-output/thyroid-segment-video-nodule/<study_id>/<video_id>/<model_job_id>/track_<track_id>/frame_<frame_index>.png
artifact://model-output/thyroid-measure-video-nodule/<study_id>/<video_id>/<model_job_id>/video_measurement.json
```

验证版分割如果使用 bbox fallback，产物会带 `segmentation_source = bbox_fallback` 和 `requires_doctor_review = true`。测量任务在缺少 DICOM `PixelSpacing` 或人工标尺时只输出像素测量，毫米字段保持 `null`。

所有检测、分割、测量、视频分割和视频测量产物都包含 `evaluation` 字段。该字段用于把真实模型输出、fallback 输出、低置信或缺少标定等情况统一转换为 `pass` / `review` / `blocked` 类状态，供 Agent 调度、报告依据、医生工作台和审计日志使用。

完整结构见项目文档：`docs/MODEL_ARTIFACT_CONVENTIONS.md`。

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
    "model": "rf-detr-medium-thyroid-detector",
    "model_version": "validation-placeholder",
    "trace_id": "TRACE1"
  }'
```

## 测试

```bash
python3 -m unittest discover services/model-gateway/tests
```
