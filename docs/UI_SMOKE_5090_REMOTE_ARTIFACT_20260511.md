# 5090 远程推理与医生工作台 UI Smoke

日期：2026-05-11

## 目标

验证 Mac 医生工作台通过远程 5090 AI Server 完成一例甲状腺超声静态图像链路：

1. Web API 创建患者、检查和图像记录。
2. `medical-agent-worker` 将检测、分割、测量任务投递到 5090 `model-gateway`。
3. 5090 `model-worker` 使用 GPU 执行 RF-DETR 检测、nnU-Net tight ROI 分割和 mask 测量。
4. Mac 轮询远程 job，写回本地 SQLite。
5. 医生工作台通过远程 artifact 代理展示 overlay、mask、测量和报告依据。

## 环境

| 项 | 值 |
|---|---|
| Mac Web | `http://127.0.0.1:7191` |
| 5090 gateway | `http://100.110.127.117:8766` |
| 5090 queue DB | `data/artifacts/model-gateway/model-gateway.db` |
| Mac smoke DB | `data/artifacts/ui-smoke-5090-20260511-174233/data.db` |
| Mac smoke RAG DB | `data/artifacts/ui-smoke-5090-20260511-174233/rag.db` |
| 输入图像 URI | `artifact://model-ready/ui-smoke-5090/tn5000_000016.jpg` |

5090 配置检查结果：

- `status = ready`
- `ready_detectors = ["yolov11", "rt-detr", "rf-detr"]`
- `ready_segmenters = ["sam2-static", "nnunet-tight-roi"]`
- `ready_video_segmenters = ["sam2-video"]`

## 关键修正

首次 smoke 暴露了远程队列库问题：5090 gateway 使用 `data/artifacts/medical/data.db` 时，远端缺少 Mac 创建的 `study/image` 记录，导致 `FOREIGN KEY constraint failed`。

已修正为：5090 gateway 默认使用独立队列库 `data/artifacts/model-gateway/model-gateway.db`。Mac 本地继续保留 shadow `model_job`，两端通过远程 job id 同步状态和输出。

## 成功病例

| 字段 | 值 |
|---|---|
| study_id | `01KRB6ZVNRG8SC8RGWFF2ED046` |
| accession_no | `UI-SMOKE-5090-ACC2` |
| image_id | `01KRB6ZVP5ZQSTWE32260PD2T3` |
| report_id | `01KRB724MQXZA8J27DFMTBH5WS` |

Agent 任务全部完成：

- `image_qc`
- `detect_nodules`
- `segment_nodules`
- `measure_nodules`
- `classify_tirads_features`
- `calculate_tirads`
- `draft_report`
- `safety_review`

注意：本轮 smoke 的 `classify_tirads_features` 和 `calculate_tirads` 是流程任务完成，不代表 TI-RADS 能力已完成有效闭环。数据库检查显示 `tirads_feature` 和 `tirads_result` 均为空；`classify_tirads_features` 返回 `model_status = not_configured`，`calculate_tirads` 返回 `rule_status = no_structured_features`。因此本轮报告只验证了检测、分割、测量、知识库证据和医生工作台展示链路，不能作为主报告大模型或完整 TI-RADS 报告验证结果。

模型任务全部完成：

| job_type | remote/local shadow job | status |
|---|---|---|
| `thyroid.detect_nodules` | `mj_f8e36705d82b497ca8162656cba01c61` | `succeeded` |
| `thyroid.segment_nodule` | `mj_3a8c4b32adbc480bad66dcdbecf2cad1` | `succeeded` |
| `thyroid.measure_nodule` | `mj_a3ed7a3064b84734b0cf56e91d72e09b` | `succeeded` |

## 结果

检测：

- bbox: `[312.55, 93.54, 539.81, 217.30]`
- confidence: `0.8938`
- 主检测模型：RF-DETR
- 对照模型：YOLOv11

分割：

- 分割来源：`nnunet_tight_roi`
- mask: `artifact://model-output/thyroid-segment-nodule/01KRB6ZVNRG8SC8RGWFF2ED046/01KRB6ZVP5ZQSTWE32260PD2T3/mj_3a8c4b32adbc480bad66dcdbecf2cad1/mask_nodule_1.png`
- ROI: `384 x 384`
- crop: `[279, 8, 574, 303]`

测量：

- long axis: `22.90 mm`
- short axis: `13.00 mm`
- area: `231.98 mm2`
- source: `mask`

报告：

- 状态：`draft`
- evidence 包含 `segmentation_result`、`measurement_result` 和 `medical_guideline`
- 尚未包含 `tirads_feature` / `tirads_result` 证据，也未形成 `qwen/qwen3.5-9b` 基于 TI-RADS 结果的主报告草稿。
- 医生工作台报告编辑器可展示结构化段落。

## Artifact 代理验证

Mac Web artifact 接口成功从 5090 拉取并缓存：

- overlay: `data/artifacts/ui-smoke-5090-20260511-174233/proxy-overlay.png`
- mask: `data/artifacts/ui-smoke-5090-20260511-174233/proxy-mask.png`
- measurement JSON: `data/artifacts/ui-smoke-5090-20260511-174233/proxy-measurements.json`

截图证据：

- `data/artifacts/ui-smoke-5090-20260511-174233/ui-medical-overview.png`
- `data/artifacts/ui-smoke-5090-20260511-174233/ui-medical-overlay.png`
- `data/artifacts/ui-smoke-5090-20260511-174233/ui-medical-evidence.png`
- `data/artifacts/ui-smoke-5090-20260511-174233/ui-medical-report-editor.png`

## 结论

本轮 smoke 对远程 5090 AI Server、Mac agent 调度、本地 shadow job 同步、远程 artifact 代理、医生工作台展示和图像模型产物依据链路通过。

完整医疗技术设计闭环尚未通过：下一轮必须先补齐 TI-RADS FeatureAgent 的有效输入来源（真实特征识别模型或医生手工结构化录入），写入 `tirads_feature`，再由规则引擎写入 `tirads_result`，最后由 `qwen/qwen3.5-9b` 在 `tirads_result + tirads_rule + medical_guideline + measurement` 证据包约束下生成主报告，并由 MedGemma / SafetyAuditAgent 复核。

下一步建议把 Mac 输入图像到 5090 的同步做成自动上传或 artifact push 任务，减少手工 `scp/rsync`。

## 真实演示分阶段说明

真实演示时先不默认加载主报告大模型。推荐分两段演示：

1. 先运行图像链路和结构化链路：RF-DETR/YOLO 检测、nnU-Net 分割、mask 测量、医生结构化 TI-RADS 特征录入、规则引擎、知识库证据、模板报告和医生审核。
2. 需要演示主报告生成时，再由操作员手动在 5090 上加载 `qwen/qwen3.5-9b`，然后运行 `draft_report / safety_review` 阶段。

医生工作台已在 Reports 区域增加真实演示提示：当前报告若为 `structured_template_validation`，会明确显示“主报告大模型需手动加载”。这样演示现场可以区分“结构化模板草稿已可用”和“Qwen 主报告阶段尚未启动”。

## 自动演示 Runner

为减少现场反复手工执行 `medical-agent-worker:once`，新增自动演示入口：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
export JZX_MEDICAL_REAL_INFERENCE=1

npm run medical-demo:run -- \
  --data-db data/artifacts/live-demo-001/data.db \
  --rag-db data/artifacts/live-demo-001/rag.db \
  --workspace /Users/xutianliang/Downloads/jiazhuangxian \
  --remote-model-gateway-url http://100.110.127.117:8766 \
  --llm-provider lmstudio:qwen35-9b \
  --qwen-model qwen/qwen3.5-9b
```

Runner 行为：

1. 自动循环执行已排队任务，并轮询 5090 远程模型 job。
2. 若检测、分割、测量已完成但缺少医生结构化 TI-RADS 特征，会停在 `waiting_doctor_tirads_features`，等待医生在工作台提交。
3. TI-RADS 规则计算完成后，若下一步是 `draft_report` 且 Qwen 未加载，会停在 `waiting_qwen_model`。
4. 操作员在 5090 上手工加载 `qwen/qwen3.5-9b` 后，Runner 会自动检测 LM Studio 模型状态，继续执行 `draft_report / safety_review`，并把 Qwen 主报告及依据写入本地 SQLite。

默认 Qwen 检测使用 provider `lmstudio:qwen35-9b` 的 `baseUrl` 推导 LM Studio `/api/v0/models` 和 `/v1/models`。如现场地址不同，可显式传入：

```bash
--qwen-check-url http://100.110.127.117:1234/api/v0/models
```

如果只想让 Runner 跑到 Qwen 提示后退出，而不是等待模型加载，可加：

```bash
--no-wait-for-qwen
```
