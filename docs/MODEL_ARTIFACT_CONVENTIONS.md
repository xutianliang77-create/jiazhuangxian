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
    "adapter": "yolov11-ultralytics",
    "family": "yolov11",
    "name": "yolov11-thyroid-detector",
    "version": "validation-placeholder",
    "weights_hash": "sha256:..."
  },
  "detectors": {
    "primary": {},
    "comparators": [],
    "consensus": {
      "status": "single_model_only"
    }
  },
  "artifacts": {
    "detections_json": "artifact://model-output/thyroid-detect-nodules/S1/IMG1/MJ1/detections.json",
    "overlay_image": "artifact://model-output/thyroid-detect-nodules/S1/IMG1/MJ1/overlay.png",
    "model_comparison_json": null
  },
  "detections": [
    {
      "nodule_index": 1,
      "bbox": [10.0, 20.0, 30.0, 40.0],
      "confidence": 0.91,
      "class_id": 0,
      "source": "ai",
      "model_name": "yolov11-thyroid-detector",
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

## 双模型对比预留

验证版先支持单主模型输出。后续 YOLOv11 主模型和 RT-DETR/RF-DETR 对照模型同时运行时，写入：

- `detectors.primary`：主模型输出摘要。
- `detectors.comparators`：对照模型输出摘要列表。
- `detectors.consensus`：一致性判断，例如 `matched`、`conflict`、`primary_only`。
- `artifacts.model_comparison_json`：独立对比 JSON 产物 URI。

医生工作台和安全审核只应展示可追踪的 artifact URI、模型名、版本、权重 hash 和置信度，不展示无法追溯的临时内存结果。
