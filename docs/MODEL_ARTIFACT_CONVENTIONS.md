# 模型产物规范

本文档定义验证版模型输出的本地 artifact 约定。目标是让模型网关、医疗 Agent、医生工作台和后续评估脚本读取同一套结构，而不是各模型各写各的临时 JSON。

## 目录约定

默认 artifact 根目录来自 `JZX_ARTIFACT_ROOT`，未配置时为 `data/artifacts`。

甲状腺结节检测输出写入：

```text
artifact://model-output/thyroid-detect-nodules/<study_id>/<image_id>/<model_job_id>/detections.json
artifact://model-output/thyroid-detect-nodules/<study_id>/<image_id>/<model_job_id>/overlay.png
```

本地文件路径对应：

```text
<JZX_ARTIFACT_ROOT>/model-output/thyroid-detect-nodules/<study_id>/<image_id>/<model_job_id>/detections.json
<JZX_ARTIFACT_ROOT>/model-output/thyroid-detect-nodules/<study_id>/<image_id>/<model_job_id>/overlay.png
```

`study_id`、`image_id`、`model_job_id` 会经过路径安全清洗，只保留字母、数字、下划线、点和短横线。

## 检测 JSON

`detections.json` 使用 `schema_version = thyroid.detector.output.v1`。

```json
{
  "schema_version": "thyroid.detector.output.v1",
  "artifact_kind": "thyroid_nodule_detection",
  "created_at": 1778245200000,
  "created_by_worker": "model-worker",
  "study_id": "S1",
  "image_id": "IMG1",
  "agent_task_id": "AT1",
  "model_job_id": "MJ1",
  "job_type": "thyroid.detect_nodules",
  "source_image_uri": "artifact://model-ready/S1/IMG1.png",
  "coordinate_system": {
    "type": "pixel_xyxy",
    "origin": "top_left",
    "unit": "pixel"
  },
  "primary_model": {
    "adapter": "rf-detr",
    "family": "rf-detr",
    "name": "rf-detr-medium-thyroid-detector",
    "version": "validation-placeholder",
    "weights_hash": "sha256:..."
  },
  "detectors": {
    "primary": {
      "adapter": "rf-detr",
      "family": "rf-detr",
      "name": "rf-detr-medium-thyroid-detector",
      "version": "validation-placeholder"
    },
    "comparators": [
      {
        "adapter": "yolov11-ultralytics",
        "family": "yolov11",
        "name": "yolov11-thyroid-detector",
        "version": "validation-comparator"
      }
    ],
    "consensus": {
      "status": "matched",
      "matched_count": 1,
      "primary_only_count": 0,
      "comparator_only_count": 0
    }
  },
  "artifacts": {
    "detections_json": "artifact://model-output/thyroid-detect-nodules/S1/IMG1/MJ1/detections.json",
    "overlay_image": "artifact://model-output/thyroid-detect-nodules/S1/IMG1/MJ1/overlay.png",
    "model_comparison_json": "artifact://model-output/thyroid-detect-nodules/S1/IMG1/MJ1/comparison.json"
  },
  "llm_evaluation": {
    "status": "pending_llm",
    "intended_model": "qwen/qwen3.5-9b",
    "overall_assessment": "consistent",
    "doctor_review_focus": [
      "Matched detections can be reviewed at lower priority unless ImageQC flags risk."
    ]
  },
  "evaluation": {
    "protocol": "thyroid.detector.evaluation.v1",
    "status": "pass",
    "consensus_status": "matched",
    "requires_doctor_review": true,
    "review_reasons": []
  },
  "detections": [
    {
      "nodule_index": 1,
      "bbox": [10.0, 20.0, 30.0, 40.0],
      "confidence": 0.91,
      "class_id": 0,
      "source": "ai",
      "model_name": "rf-detr-medium-thyroid-detector",
      "model_version": "validation-placeholder"
    }
  ],
  "warnings": [],
  "raw_output": {}
}
```

## 坐标约定

- `bbox` 使用 `[x_min, y_min, x_max, y_max]`。
- 坐标原点为图像左上角。
- 单位为像素。
- 后续测量换算毫米时必须使用图像表中的 `pixel_spacing` 或人工标定结果，不能直接把像素当毫米。

## Overlay 图

- 当检测请求 `return_overlay = true` 且 `source_image_uri` 能解析为可读取的 PNG/JPEG 等栅格图时，model-worker 会在同一目录写入 `overlay.png`。
- Overlay 使用检测 JSON 中的像素 bbox 直接绘制，只用于医生快速复核候选框位置。
- 医生工作台通过 `GET /v1/web/medical/artifacts?uri=<artifact-uri>` 读取 overlay；该路由需要 Web 鉴权，并且只允许解析到 artifact root 内的 `artifact://` 路径。
- Overlay 不是诊断依据，不替代原始图像、DICOM 图像、测量结果或医生修订记录。
- 如果 Pillow 缺失、源图像不存在或源图像格式无法打开，检测 JSON 仍会写入，`warnings` 会包含 `overlay_unavailable:*`，`artifacts.overlay_image` 为 `null`。

## 双模型对比

验证版检测链路采用 RF-DETR-Medium 主模型和 YOLO11m 对照模型。产物写入：

- `detectors.primary`：RF-DETR-Medium 主模型输出摘要。
- `detectors.comparators`：YOLO11m 对照模型输出摘要列表。
- `detectors.consensus`：一致性判断，例如 `matched`、`conflict`、`primary_only`。
- `artifacts.model_comparison_json`：独立对比 JSON 产物 URI。
- `quality_gate`：对比产物中的门控结果，`pass` 表示 RF-DETR 与 YOLO11m 在 IoU 阈值下匹配且无对照模型 warning；`review` 表示需要医生、主 LLM 或二次模型重点复核。
- `llm_evaluation`：主 LLM 对双模型检测结果的结构化评估，包括复核优先级、冲突说明和医生检查重点。

医生工作台和安全审核只应展示可追踪的 artifact URI、模型名、版本、权重 hash 和置信度，不展示无法追溯的临时内存结果。

主 LLM 只评估结构化结果，不直接生成或修改 bbox。所有 bbox 坐标必须来自 RF-DETR-Medium、YOLO11m、后续分割/测量模型或医生人工修订。

## 统一评估字段

所有模型产物都必须包含 `evaluation` 字段，供 CodeClaw 医疗 Agent、医生工作台、报告依据和审计日志统一读取。

通用约定：

- `protocol`：评估协议版本，例如 `thyroid.detector.evaluation.v1`、`thyroid.segmentation.evaluation.v1`、`thyroid.measurement.evaluation.v1`。
- `status`：产物状态。检测可为 `pass` / `review` / `single_model_review`；分割可为 `real_model_result_requires_review` / `validation_fallback_requires_review` / `blocked_real_model_unavailable`；测量可为 `mm_measurement_available` / `pixel_only_requires_calibration` / `no_measurement`。
- `requires_doctor_review`：医疗验证版固定为 `true`，表示 AI 结果只能作为辅助依据。
- `review_reasons[]`：机器可读复核原因，例如 `detector_consensus_conflict`、`bbox_fallback_mask_not_real_segmentation`、`pixel_spacing_missing`。

真实 GPU 链路策略版本为 `thyroid-gpu-pipeline-v1`：

- 静态检测：RF-DETR-Medium 主模型，YOLO11m 对照，IoU 阈值 0.5 做一致性门控。
- 静态分割：nnU-Net Tight ROI 主路线，SAM2/MedSAM 作为复核或交互式修订路线。
- 视频分割：SAM2/MedSAM2 video prompt 主路线，逐帧 fallback 必须显式标记。
- 测量：基于 mask 的像素测量，只有存在 DICOM `PixelSpacing` 或人工标尺时才输出毫米值。

## 分割 JSON

验证版 `thyroid.segment_nodule` 写入：

```text
artifact://model-output/thyroid-segment-nodule/<study_id>/<image_id>/<model_job_id>/segmentation.json
artifact://model-output/thyroid-segment-nodule/<study_id>/<image_id>/<model_job_id>/mask_nodule_<index>.png
```

核心字段：

- `schema_version = thyroid.segmentation.output.v1`
- `artifact_kind = thyroid_nodule_segmentation`
- `coordinate_system.type = pixel_xy`
- `segmentations[]`：`nodule_id`、`nodule_index`、`bbox`、`contour`、`mask_uri`、`confidence`、`segmentation_source`、`requires_doctor_review`
- `artifacts.mask_images[]`：mask PNG 列表
- `evaluation`：分割产物评估，区分真实模型结果、bbox fallback、无输出和真实模型未配置

当前未接入真实分割权重时，worker 只允许生成明确标记为 `bbox_fallback` 的矩形 mask。该 mask 用于验证链路和医生复核，不得当作真实结节轮廓或临床分割结果。

## 测量 JSON

验证版 `thyroid.measure_nodule` 写入：

```text
artifact://model-output/thyroid-measure-nodule/<study_id>/<image_id>/<model_job_id>/measurements.json
```

核心字段：

- `schema_version = thyroid.measurement.output.v1`
- `artifact_kind = thyroid_nodule_measurement`
- `measurements[]`：`nodule_id`、`nodule_index`、`long_axis_mm`、`short_axis_mm`、`area_mm2`、`aspect_ratio`、`pixel_measurements`、`measurement_source`、`requires_doctor_review`
- `pixel_spacing`：行/列方向毫米间距
- `evaluation`：测量产物评估，区分毫米测量可用、仅像素测量、缺少标定和无测量输出

当图像没有 DICOM `PixelSpacing` 或人工标尺时，`long_axis_mm`、`short_axis_mm`、`area_mm2` 必须保持 `null`，同时输出像素测量和 `pixel_spacing_missing:mm_measurement_unavailable` warning。报告生成不得把像素值伪装成毫米值。

## 视频分割 JSON

视频版 `thyroid.segment_video_nodule` 写入：

```text
artifact://model-output/thyroid-segment-video-nodule/<study_id>/<video_id>/<model_job_id>/video_segmentation.json
artifact://model-output/thyroid-segment-video-nodule/<study_id>/<video_id>/<model_job_id>/track_<track_id>/frame_<frame_index>.png
```

核心字段：

- `schema_version = thyroid.video_segmentation.output.v1`
- `artifact_kind = thyroid_nodule_video_segmentation`
- `video.frame_count`、`video.fps`、`video.processed_frame_range`
- `tracks[]`：`track_id`、`nodule_id`、`prompt_frame_index`、`prompt_bbox`、`frames[]`、`quality`
- `tracks[].frames[]`：`frame_index`、`time_ms`、`bbox`、`contour`、`mask_uri`、`confidence`、`requires_doctor_review`
- `tracks[].quality`：`mean_confidence`、`min_confidence`、`mask_area_cv`、`track_dropout_frames`、`temporal_jitter_score`
- `evaluation`：视频分割产物评估，记录 track 数、frame 数、是否使用 fallback 和复核原因

视频分割不得静默逐帧 fallback。若使用逐帧 MedSAM/U-Net/Swin U-Net 加跟踪兜底，必须写入 `segmentation_source = framewise_segmentation_with_tracker` 和 warning；若使用 MedSAM2/SAM2，则写入 `segmentation_source = medsam2_video_prompt` 或 `sam2_video_prompt`。

## 视频测量 JSON

视频版 `thyroid.measure_video_nodule` 写入：

```text
artifact://model-output/thyroid-measure-video-nodule/<study_id>/<video_id>/<model_job_id>/video_measurement.json
```

核心字段：

- `schema_version = thyroid.video_measurement.output.v1`
- `artifact_kind = thyroid_nodule_video_measurement`
- `measurements[]`：`track_id`、`nodule_id`、`selected_frame_index`、`selection_reason`、`long_axis_mm`、`short_axis_mm`、`area_mm2`、`frame_measurements`、`temporal_summary`、`requires_doctor_review`
- `frame_measurements[]`：逐帧或抽样帧的像素长径、短径、面积
- `temporal_summary`：`max_long_axis_px`、`median_long_axis_px`、`area_cv`、`stable_frame_count`
- `evaluation`：视频测量产物评估，协议为 `thyroid.video_measurement.evaluation.v1`

默认测量策略为 `max_long_axis_high_confidence`：排除低置信、目标丢失、mask 面积突变和贴边帧后，选择长径最大的高可信帧。缺少 DICOM `PixelSpacing` 或人工标尺时，视频测量同样只输出像素值，毫米字段保持 `null`。
