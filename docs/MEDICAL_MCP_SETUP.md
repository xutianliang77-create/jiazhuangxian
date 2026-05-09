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
        "JZX_MODEL_GATEWAY_URL": "http://127.0.0.1:8766"
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
        "JZX_MODEL_GATEWAY_URL": "http://127.0.0.1:8766"
      }
    }
  }
}
```

## 启动顺序

先初始化验证数据库。Web、medical-agent-worker、model-gateway 和 model-worker 应指向同一个 `JZX_DATA_DB`，这样医生工作台才能看到同一批病例、agent task 和 model job 状态。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:init-db -- --data-db data/artifacts/medical/data.db --workspace /Users/xutianliang/Downloads/jiazhuangxian --ingest-sample-knowledge
export JZX_DATA_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/data.db
```

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

术语和模板工具读取医学 SQLite 知识表。默认读取 `~/.codeclaw/data.db`；如需指定验证数据库，可在 `.mcp.json` 的 `env` 中增加 `JZX_DATA_DB`，但该数据库必须已经跑过 `src/storage/migrations/data` 迁移。

```text
/mcp call medical medical.NormalizeTerm {"text":"低回声实性结节","category":"tirads_feature"}
/mcp call medical medical.GetTiradsRule {"rule_code":"ACR_2017_composition_solid"}
/mcp call medical medical.GetReportTemplate {"scene":"thyroid_ultrasound_draft","category":"TR4"}
```

检测工具会写入 model-gateway 队列。当前验证版 worker 会消费任务并写入 `detector_not_configured`，用于验证队列和错误路径。

```text
/mcp call medical thyroid.DetectNodules {"study_id":"S1","image_id":"IMG1","image_uri":"artifact://model-ready/S1/IMG1.png","trace_id":"TRACE1"}
```

医生工作台的完整验证链路是：

1. 手工登记患者、检查和图像。
2. 打开病例详情，点击图像行的 `启动分析`。
3. `medical-agent-worker` 消费 `agent_task`；`image_qc` 会调用 `image-worker` 的 `/image/v1/image-quality-check`，并将成功返回的 `image_quality`/`quality_score` 写回 `image` 表。
4. `detect_nodules` 任务会进入 `waiting_model`，并创建 `model_job`。
5. `model-worker` 消费 `model_job`；当前没有真实权重时会写入 `detector_not_configured`。
6. `medical-agent-worker` 再次同步 `waiting_model`；如果检测成功，会把模型返回的结节框写入 `nodule` 表并继续推进下游任务；如果检测失败，会将检测任务标记为失败并阻断下游任务。
7. `classify_tirads_features` 当前支持验证版结构化输入：如果 task input 带 `feature_candidates` / `tirads_features` / `features`，会绑定 `nodule_id` 或 `nodule_index` 并写入 `tirads_feature`；未接真实特征模型时会返回明确未配置 warning。
8. 当 `tirads_feature` 表已有结构化特征时，`calculate_tirads` 会调用本地 ACR TI-RADS 2017 规则引擎，并把分值、分级、建议和证据规则写入 `tirads_result`。
9. `draft_report` 会读取同一病例下已持久化的结节和最新 TI-RADS 结果，按验证版模板生成 AI 辅助报告草稿并写入 `report` 表；草稿状态为 `draft`，输出始终带 `doctor_review_required`，必须由医生审核后才可生效。
10. `safety_review` 会读取最新报告草稿、`safety_rules`、图像质量和结节置信度，检查最终诊断表述、缺证据 FNA/随访建议、低质量/低置信度、缺少标定的毫米级表述和 PHI 泄露风险，并把审核摘要写入 `audit_log`。
11. 病例详情接口和医生工作台会展示同一病例下的 `model_job`、`nodule`、`tirads_feature`、`tirads_result`、`report` 和 `audit_log`，其中检测成功的 `model_job.artifact_uri` 会指向标准化检测产物 JSON；如果源图像可读取且请求允许 overlay，模型输出还会包含同目录 `overlay.png` 复核图 URI。
12. 医生工作台可对 `draft` / `pending_review` 报告执行确认或驳回；确认会写入 `report.final_text`、`confirmed_by`、`confirmed_at` 和 `doctor_review`，同时追加 `audit_log`。

如果 `image-worker` 未启动，`image_qc` 不会阻断验证链路；任务会以 `validation_mode=true` 成功完成，并在输出中写入 `image_worker_qc_unavailable` 与具体错误码，便于本地分步验证。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `/mcp tools medical` 无工具 | `npm run medical:mcp` 启动失败或工作目录不对 | 项目级配置用样例；用户级配置加绝对 `cwd` |
| `image_worker_qc_unavailable` | `medical-agent-worker` 无法访问 image-worker，或 image-worker 返回非标准响应 | 检查 `JZX_IMAGE_WORKER_URL`、`npm run image-worker` 和图像 `artifact://` 路径 |
| `model_gateway_unreachable` | model-gateway 未启动 | 检查 `JZX_MODEL_GATEWAY_URL` 和 `npm run model-gateway` |
| `knowledge_db_unavailable` | `JZX_DATA_DB` 指向的 SQLite 不存在或未迁移 | 使用默认 `~/.codeclaw/data.db`，或先初始化带医学迁移的验证数据库 |
| `detector_not_configured` | 当前验证 worker 尚未接真实 YOLOv11/RT-DETR 权重 | 这是当前预期行为；后续替换 detector adapter |
| `agent_task` 长时间 `queued` | `medical-agent-worker` 未启动，或父任务未完成 | 先运行 `npm run medical-agent-worker:once` 查看 JSON 输出 |
| `detect_nodules` 长时间 `waiting_model` | `model-worker` 未启动，或 `JZX_DATA_DB` 不是同一个 SQLite 文件 | 确认 model-gateway、model-worker、medical-agent-worker 使用同一个 `JZX_DATA_DB` |
