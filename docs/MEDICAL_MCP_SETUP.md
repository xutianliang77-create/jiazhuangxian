# 医学 MCP 本地验证配置

本文件说明如何把 `packages/medical-mcp` 挂到 CodeClaw MCP Manager，并连接本地验证版 `image-worker` 与 `model-gateway`。

## 运行边界

| 组件 | 启动方式 | 职责 |
|---|---|---|
| `medical` MCP server | CodeClaw 根据 `.mcp.json` 以 stdio 子进程启动 | 暴露 `image.*`、`thyroid.*`、`medical.*` 工具 |
| `image-worker` | 单独 HTTP 服务 | DICOM 解析、脱敏、预览、预处理、图像质量检查 |
| `model-gateway` | 单独 HTTP 服务 | 接收检测请求并写入 `model_job` 队列 |
| `model-worker` | 单独后台进程 | 消费 `model_job`；当前验证版只写结构化未配置错误 |
| `medical-agent-worker` | 单独后台进程 | 消费 `agent_task`；`image_qc` 调用 image-worker，检测任务写入 `model_job`，并推进 TI-RADS、报告草稿与安全审核任务链 |

`.mcp.json` 只负责启动 MCP server，不负责拉起长期运行的 HTTP 后台服务。

## 项目级 `.mcp.json`

在项目根目录复制样例：

```bash
cp examples/mcp.medical.validation.json .mcp.json
```

样例内容：

```json
{
  "servers": {
    "medical": {
      "command": "npm",
      "args": ["--silent", "run", "medical:mcp"],
      "env": {
        "JZX_IMAGE_WORKER_URL": "http://127.0.0.1:8765",
        "JZX_MODEL_GATEWAY_URL": "http://127.0.0.1:8766",
        "JZX_DATA_DB": "/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/data.db",
        "JZX_RAG_DB": "/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/rag.db"
      },
      "disabled": false
    }
  }
}
```

CodeClaw 的 MCP 配置优先级是 `<workspace>/.mcp.json` 高于 `~/.codeclaw/mcp.json`。

如果写到用户级 `~/.codeclaw/mcp.json`，建议给 `medical` server 增加绝对路径 `cwd`：

```json
{
  "servers": {
    "medical": {
      "command": "npm",
      "args": ["--silent", "run", "medical:mcp"],
      "cwd": "/Users/xutianliang/Downloads/jiazhuangxian",
      "env": {
        "JZX_IMAGE_WORKER_URL": "http://127.0.0.1:8765",
        "JZX_MODEL_GATEWAY_URL": "http://127.0.0.1:8766",
        "JZX_DATA_DB": "/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/data.db",
        "JZX_RAG_DB": "/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/rag.db"
      }
    }
  }
}
```

## 启动顺序

先初始化验证数据库。Web、medical-agent-worker、model-gateway 和 model-worker 应指向同一个 `JZX_DATA_DB`，这样医生工作台才能看到同一批病例、agent task 和 model job 状态。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:init-db -- --data-db data/artifacts/medical/data.db --rag-db data/artifacts/medical/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian --ingest-sample-knowledge
export JZX_DATA_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/data.db
export JZX_RAG_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/rag.db
```

`--ingest-sample-knowledge` 默认写入第一版甲状腺知识库 `examples/medical-knowledge/thyroid-guidelines-v1.manifest.json`，包含 ACR TI-RADS、ATA、EU-TIRADS、C-TIRADS 参考边界和报告安全证据约束。

终端 1：启动图像服务。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_ARTIFACT_ROOT=data/artifacts npm run image-worker
```

终端 2：启动模型网关。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_DATA_DB=data/artifacts/medical/data.db npm run model-gateway
```

启动前可先检查模型网关配置：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_DATA_DB=data/artifacts/medical/data.db npm run model-gateway:check
```

启动后也可通过 HTTP 检查：

```bash
curl -s http://127.0.0.1:8766/model/v1/config/check
```

医生工作台会通过 Web API 代理同一个检查结果：`GET /v1/web/medical/model-gateway/check`。如果 Web 进程没有设置 `JZX_MODEL_GATEWAY_URL`，默认检查 `http://127.0.0.1:8766`。

终端 3：启动验证 worker。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_DATA_DB=data/artifacts/medical/data.db npm run model-worker
```

终端 4：启动医疗 Agent worker。医生工作台点击 `启动分析` 后会创建 `agent_task`，该 worker 负责 claim 任务并推进状态；结节检测任务会写入 `model_job`，再交给 `model-worker`。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_DATA_DB=data/artifacts/medical/data.db JZX_IMAGE_WORKER_URL=http://127.0.0.1:8765 npm run medical-agent-worker
```

可选：打开主 LLM 结构化评估。该通道复用 CodeClaw provider 配置，推荐指向本地 vLLM/LM Studio/OpenAI-compatible 的 Qwen3.6；MedGemma 保持医学复核辅助，不替代主报告模型。

```bash
JZX_DATA_DB=data/artifacts/medical/data.db \
JZX_RAG_DB=data/artifacts/medical/rag.db \
JZX_IMAGE_WORKER_URL=http://127.0.0.1:8765 \
JZX_MEDICAL_LLM_EVALUATION=1 \
JZX_MEDICAL_LLM_PROVIDER=lmstudio:qwen36-35b-a3b \
JZX_MEDICAL_REVIEW=1 \
JZX_MEDICAL_REVIEW_PROVIDER=lmstudio:medgemma-review \
JZX_MEDICAL_KNOWLEDGE_TOP_K=3 \
npm run medical-agent-worker
```

也可以显式传参：

```bash
npm run medical-agent-worker:once -- \
  --data-db data/artifacts/medical/data.db \
  --rag-db data/artifacts/medical/rag.db \
  --knowledge-top-k 3 \
  --enable-llm-evaluation \
  --llm-provider lmstudio:qwen36-35b-a3b \
  --enable-medical-review \
  --medical-review-provider lmstudio:medgemma-review
```

5090 验证主机的 Qwen3.6 配置记录见 [LLM_PROVIDER_SETUP_5090.md](LLM_PROVIDER_SETUP_5090.md)。当前可用验证 provider 是 `lmstudio:qwen36-35b-a3b`，endpoint 为 `http://127.0.0.1:1234/v1`，模型文件入口统一放在远程项目的 `~/jiazhuangxian/data/llm`。远程运行医疗 worker 时需先使用 Node 22：

```bash
export PATH=/home/beelink/.local/node/node-v22.9.0-linux-x64/bin:$PATH
```

也可以单步消费一条任务，便于调试：

```bash
JZX_DATA_DB=data/artifacts/medical/data.db JZX_IMAGE_WORKER_URL=http://127.0.0.1:8765 npm run medical-agent-worker:once
```

终端 5：启动 CodeClaw，并通过 `/mcp` 检查工具。

```text
/mcp
/mcp tools medical
```

## 验证调用

规则引擎不依赖后台 HTTP 服务，可直接验证：

```text
/mcp call medical thyroid.CalculateTirads {"features":{"composition":"solid","echogenicity":"hypoechoic","shape":"taller_than_wide","margin":"irregular","echogenic_foci":["punctate_echogenic_foci"]},"size_mm":{"long_axis":12,"short_axis":8,"ap_axis":10}}
```

术语、模板和证据检索工具读取医学 SQLite 知识表。默认读取 `~/.codeclaw/data.db`；如需指定验证数据库，可在 `.mcp.json` 的 `env` 中增加 `JZX_DATA_DB` 和 `JZX_RAG_DB`，其中 `JZX_DATA_DB` 必须已经跑过 `src/storage/migrations/data` 迁移，`JZX_RAG_DB` 应包含已导入的医学 `rag_chunks`。

```text
/mcp call medical medical.NormalizeTerm {"text":"低回声实性结节","category":"tirads_feature"}
/mcp call medical medical.SearchGuideline {"query":"solid composition","top_k":5,"filters":{"body_part":"thyroid"}}
/mcp call medical medical.GetTiradsRule {"rule_code":"ACR_2017_composition_solid"}
/mcp call medical medical.GetReportTemplate {"scene":"thyroid_ultrasound_draft","category":"TR4"}
```

检测工具会写入 model-gateway 队列。当前验证版 worker 会消费任务并写入 `detector_not_configured`，用于验证队列和错误路径。

```text
/mcp call medical thyroid.DetectNodules {"study_id":"S1","image_id":"IMG1","image_uri":"artifact://model-ready/S1/IMG1.png","trace_id":"TRACE1"}
/mcp call medical thyroid.SegmentNodule {"study_id":"S1","image_id":"IMG1","image_uri":"artifact://model-ready/S1/IMG1.png","nodule_id":"N1","bbox":[120,88,260,210],"trace_id":"TRACE2"}
/mcp call medical thyroid.MeasureNodule {"study_id":"S1","image_id":"IMG1","nodule_id":"N1","mask_uri":"artifact://model-output/thyroid-segment-nodule/S1/IMG1/JOB/mask_nodule_1.png","pixel_spacing":{"row_mm":0.08,"column_mm":0.08},"trace_id":"TRACE3"}
```

视频分割与测量工具为下一步设计目标，接口定义见 `docs/SEGMENTATION_MODEL_INTEGRATION_PLAN.md`。实现后验证调用形态如下：

```text
/mcp call medical thyroid.SegmentVideoNodule {"study_id":"S1","video_id":"VID1","video_uri":"artifact://medical-videos/S1/VID1.mp4","targets":[{"nodule_id":"N1","track_id":"T1","prompt_frame_index":42,"bbox":[120,88,260,210]}],"trace_id":"TRACE4"}
/mcp call medical thyroid.MeasureVideoNodule {"study_id":"S1","video_id":"VID1","segmentation_uri":"artifact://model-output/thyroid-segment-video-nodule/S1/VID1/JOB/video_segmentation.json","measurement_policy":"max_long_axis_high_confidence","trace_id":"TRACE5"}
```

医生工作台的完整验证链路是：

1. 手工登记患者、检查和图像。
2. 打开病例详情，点击图像行的 `启动分析`。
3. `medical-agent-worker` 消费 `agent_task`；`image_qc` 会调用 `image-worker` 的 `/image/v1/image-quality-check`，并将成功返回的 `image_quality`/`quality_score` 写回 `image` 表。
4. `detect_nodules` 任务会进入 `waiting_model`，并创建 `model_job`。
5. `model-worker` 消费 `model_job`；配置 RF-DETR/YOLO 权重后会写入 `detections.json`、`comparison.json` 和 `overlay.png`，未配置权重时会写入 `detector_not_configured`。
6. `medical-agent-worker` 再次同步 `waiting_model`；如果检测成功，会把模型返回的结节框写入 `nodule` 表并继续推进下游任务；如果启用 `JZX_MEDICAL_LLM_EVALUATION=1`，还会把 `model_job.output_json.llm_evaluation` 交给 CodeClaw provider 中的 Qwen3.6 生成结构化复核意见，并写入 `medical.detector.llm_evaluation` 审计日志。该 LLM 通道不得新增、删除或移动 bbox。
7. `segment_nodules` 会创建 `thyroid.segment_nodule` model_job。当前验证版未配置真实分割权重时，会生成明确标记为 `bbox_fallback` 的矩形 mask、`segmentation.json` 和 `mask_nodule_<index>.png`，并把 `mask_uri` 写回 `nodule`；该 mask 仅用于链路验证和医生复核。
8. `measure_nodules` 会创建 `thyroid.measure_nodule` model_job。worker 优先基于 mask 计算测量；缺少 DICOM `PixelSpacing` 时只输出像素测量，毫米字段保持空，并标记需要医生复核/人工标定。
9. `classify_tirads_features` 当前支持验证版结构化输入：如果 task input 带 `feature_candidates` / `tirads_features` / `features`，会绑定 `nodule_id` 或 `nodule_index` 并写入 `tirads_feature`；未接真实特征模型时会返回明确未配置 warning。
10. 当 `tirads_feature` 表已有结构化特征时，`calculate_tirads` 会调用本地 ACR TI-RADS 2017 规则引擎，并把分值、分级、建议和证据规则写入 `tirads_result`。
11. `draft_report` 会读取同一病例下已持久化的结节和最新 TI-RADS 结果，先查询 `tirads_rules` 补齐结构化规则依据，再通过医学 RAG 检索已审核指南 chunk。规则与 RAG 证据会写入 `report.evidence_json` 和 `report.structured_json.knowledge_evidence`。如果启用 `JZX_MEDICAL_LLM_EVALUATION=1` 并配置 Qwen3.6 provider，则会把模板、结构化结果、规则库证据、RAG 证据和安全约束交给 provider 生成受控报告草稿，并写入 `medical.report.llm_draft` 审计日志。草稿状态始终为 `draft`，输出始终带 `doctor_review_required`，必须由医生审核后才可生效。
12. `safety_review` 会读取最新报告草稿、`safety_rules`、图像质量和结节置信度，检查最终诊断表述、缺证据 FNA/随访建议、低质量/低置信度、缺少标定的毫米级表述和 PHI 泄露风险，并把审核摘要写入 `audit_log`。如果启用 `JZX_MEDICAL_REVIEW=1` 并配置 MedGemma provider，`safety_review` 会用精简后的报告正文、结节摘要、规则库证据和 RAG 证据复核同一条已落库报告，结果写回 `report.structured_json.medical_review_assistant`，并追加 `medical.report.medgemma_review` 审计日志。5090 显存紧张时推荐串行执行：先加载 Qwen3.6 跑 `draft_report`，再卸载 Qwen3.6、加载 `medgemma-4b-it` 跑 `safety_review`。
13. 病例详情接口和医生工作台会展示同一病例下的 `model_job`、`nodule`、`measurement`、`tirads_feature`、`tirads_result`、`report` 和 `audit_log`，其中检测/分割/测量成功的 `model_job.artifact_uri` 会指向标准化 JSON 产物；如果源图像可读取且请求允许 overlay，模型输出还会包含同目录 `overlay.png` 复核图 URI，并通过 `GET /v1/web/medical/artifacts?uri=<artifact-uri>` 在医生工作台内预览。
14. 医生工作台的 `知识证据` 面板可调用 `POST /v1/web/medical/knowledge/search` 检索已审核指南证据；返回结果来自 CodeClaw RAG chunk，并带 `medical_documents` / `medical_chunk_metadata` provenance。
15. 医生工作台可对 AI 结节 bbox 执行数字修订；修订会更新 `nodule.bbox`、将 `source` 标记为 `doctor`、将状态改为 `doctor_revised`，同时追加 `medical.nodule.revise` 审计日志。
16. 医生工作台可对 `draft` / `pending_review` 报告执行确认或驳回；确认会写入 `report.final_text`、`confirmed_by`、`confirmed_at` 和 `doctor_review`，同时追加 `audit_log`。

如果 `image-worker` 未启动，`image_qc` 不会阻断验证链路；任务会以 `validation_mode=true` 成功完成，并在输出中写入 `image_worker_qc_unavailable` 与具体错误码，便于本地分步验证。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `/mcp tools medical` 无工具 | `npm run medical:mcp` 启动失败或工作目录不对 | 项目级配置用样例；用户级配置加绝对 `cwd` |
| `image_worker_qc_unavailable` | `medical-agent-worker` 无法访问 image-worker，或 image-worker 返回非标准响应 | 检查 `JZX_IMAGE_WORKER_URL`、`npm run image-worker` 和图像 `artifact://` 路径 |
| `model_gateway_unreachable` | model-gateway 未启动 | 检查 `JZX_MODEL_GATEWAY_URL` 和 `npm run model-gateway` |
| `knowledge_db_unavailable` | `JZX_DATA_DB` 指向的 SQLite 不存在或未迁移 | 使用默认 `~/.codeclaw/data.db`，或先初始化带医学迁移的验证数据库 |
| `rag_db_unavailable` | 医学 RAG 库未生成或 `JZX_RAG_DB` 未指向正确文件 | 运行 `npm run medical:init-db -- --rag-db ... --ingest-sample-knowledge` 或 `npm run medical:ingest -- --rag-db ...` |
| `detector_not_configured` | 当前验证 worker 尚未接真实 YOLOv11/RT-DETR 权重 | 这是当前预期行为；后续替换 detector adapter |
| `agent_task` 长时间 `queued` | `medical-agent-worker` 未启动，或父任务未完成 | 先运行 `npm run medical-agent-worker:once` 查看 JSON 输出 |
| `detect_nodules` 长时间 `waiting_model` | `model-worker` 未启动，或 `JZX_DATA_DB` 不是同一个 SQLite 文件 | 确认 model-gateway、model-worker、medical-agent-worker 使用同一个 `JZX_DATA_DB` |
