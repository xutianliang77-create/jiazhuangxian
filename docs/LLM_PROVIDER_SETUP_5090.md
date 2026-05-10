# 5090 Qwen3.6 Provider Setup

本文记录验证版在远程 RTX 5090 主机上接入 Qwen3.6 的当前可运行配置。

## 目标

- CodeClaw provider 统一管理主 LLM。
- Qwen3.6 作为主报告模型和检测结果结构化复核模型。
- MedGemma 作为医学复核辅助模型，不替代 Qwen3.6。
- RF-DETR/YOLO 等视觉模型继续由 `services/model-gateway` 执行，不走聊天 provider。

## 当前结论

当前可用验证配置：

```text
主 provider：lmstudio:qwen36-35b-a3b
endpoint：http://127.0.0.1:1234/v1
model：qwen/qwen3.6-35b-a3b
用途：报告草稿、检测结果结构化评估、医生复核重点生成
```

验证结果：

- LM Studio OpenAI-compatible `/v1/models` 可见 `qwen/qwen3.6-35b-a3b`、`qwen/qwen3.6-27b`、`unsloth/qwen3.6-27b`、`medgemma-4b-it`、`medgemma-1.5-4b-it` 等模型；当前复核 provider 优先使用实测可调用的 `medgemma-4b-it`。
- `qwen/qwen3.6-35b-a3b` 已通过直接 JSON 输出烟测。
- CodeClaw `loadRuntimeSelection()` 已能选中 `lmstudio:qwen36-35b-a3b`。
- CodeClaw `streamProviderResponse()` 已能正确只返回最终 `content`，不会把 Qwen reasoning 内容混入医疗 JSON。
- `medical-agent-worker` 已通过真实 provider 复核烟测，写入 `result.llm_provider_evaluation` 和 `medical.detector.llm_evaluation` 审计日志。
- `draft_report` 已接入医学知识证据链：出报告前查询 `tirads_rules`，并在配置 `JZX_RAG_DB` 或 `--rag-db` 时检索医学 RAG chunk；证据进入 `report.evidence_json` 与 Qwen/MedGemma prompt。
- `qwen/qwen3.6-27b` 与 `unsloth/qwen3.6-27b` 当前在 LM Studio API 调用时返回 `Failed to load model`，先保留为候选，不作为自动 fallback。

## 模型目录

项目约定模型入口放在 `~/jiazhuangxian/data/llm`。5090 主机当前采用软链接指向已有 `/data/models`，避免重复占用磁盘：

```text
~/jiazhuangxian/data/llm/qwen3.6-35b-a3b-gguf
  -> /data/models/lmstudio-community/lmstudio-community/Qwen3.6-35B-A3B-GGUF

~/jiazhuangxian/data/llm/qwen3.6-27b-q6-gguf
  -> /data/models/lmstudio-community/lmstudio-community/Qwen3.6-27B-GGUF

~/jiazhuangxian/data/llm/qwen3.6-27b-q5-gguf
  -> /data/models/lmstudio-community/unsloth/Qwen3.6-27B-GGUF
```

当前文件格式是 GGUF：

```text
Qwen3.6-35B-A3B-Q4_K_M.gguf  21.2 GB
Qwen3.6-35B-A3B-Q6_K.gguf    28.5 GB
Qwen3.6-27B-Q6_K.gguf        22.1 GB
Qwen3.6-27B-Q5_K_M.gguf      19.5 GB
```

说明：

- GGUF 路线适合 LM Studio / llama.cpp 类运行时。
- vLLM 路线更适合 Hugging Face safetensors / FP8 / NVFP4 模型目录。
- 若后续切换 vLLM，应把 HF 格式模型下载到 `data/llm/<model-name>/`，再将 CodeClaw provider endpoint 改到 vLLM 的 OpenAI-compatible 服务。

## CodeClaw Provider 配置

远程配置文件：

```text
/home/beelink/.codeclaw/providers.json
/home/beelink/.codeclaw/config.yaml
```

`providers.json` 当前核心配置：

```json
{
  "lmstudio:qwen36-35b-a3b": {
    "type": "lmstudio",
    "displayName": "LM Studio · Qwen3.6-35B-A3B",
    "enabled": true,
    "baseUrl": "http://127.0.0.1:1234/v1",
    "model": "qwen/qwen3.6-35b-a3b",
    "timeoutMs": 180000,
    "maxTokens": 8192,
    "contextWindow": 8192
  },
  "lmstudio:qwen36-27b": {
    "type": "lmstudio",
    "displayName": "LM Studio · Qwen3.6-27B",
    "enabled": true,
    "baseUrl": "http://127.0.0.1:1234/v1",
    "model": "qwen/qwen3.6-27b",
    "timeoutMs": 180000,
    "maxTokens": 4096,
    "contextWindow": 8192
  },
  "lmstudio:medgemma-review": {
    "type": "lmstudio",
    "displayName": "LM Studio · MedGemma review",
    "enabled": true,
    "baseUrl": "http://127.0.0.1:1234/v1",
    "model": "medgemma-4b-it",
    "timeoutMs": 120000,
    "maxTokens": 2048,
    "contextWindow": 8192
  }
}
```

`config.yaml` 当前默认模型：

```yaml
provider:
  default: lmstudio:qwen36-35b-a3b
  fallback: lmstudio:qwen36-35b-a3b
defaults:
  language: zh
  permissionMode: plan
  workspace: /home/beelink/jiazhuangxian
memory:
  l1AutoCompactThreshold: 167000
  l2Dir: ~/.codeclaw/sessions/
```

## 运行要求

远程系统默认 `/usr/bin/node` 是 Node 18，会导致当前仓库的 `better-sqlite3` 原生模块 ABI 不匹配。运行 CodeClaw、医疗 worker、Web/API 测试时使用 Node 22：

```bash
export PATH=/home/beelink/.local/node/node-v22.9.0-linux-x64/bin:$PATH
```

医生工作台或医疗 worker 常用命令：

```bash
cd ~/jiazhuangxian
export PATH=/home/beelink/.local/node/node-v22.9.0-linux-x64/bin:$PATH

npm run dev -- doctor

npm run medical-agent-worker:once -- \
  --data-db data/artifacts/medical/data.db \
  --rag-db data/artifacts/medical/rag.db \
  --knowledge-top-k 3 \
  --worker-id qwen36-worker \
  --enable-llm-evaluation \
  --llm-provider lmstudio:qwen36-35b-a3b \
  --enable-medical-review \
  --medical-review-provider lmstudio:medgemma-review
```

## 烟测记录

直接 provider 烟测：

```text
provider: lmstudio:qwen36-35b-a3b
model: qwen/qwen3.6-35b-a3b
output: {"status":"ok","model":"qwen3.6"}
```

医疗 worker 真实链路烟测：

```text
data_db: data/artifacts/medical-llm-provider-smoke-20260510/data.db
model_job_id: 01KR7M8PXF86E5S6S1HCACCAGW
provider: lmstudio:qwen36-35b-a3b
llm_provider_evaluation.status: reviewed
overall_assessment: consistent
bbox_policy: must_not_modify_bbox
audit_log_id: 01KR7MA4YDY55BGCJBE10XPBXX
```

该烟测证明：

- 检测模型输出的 bbox `[120, 160, 260, 310]` 被原样持久化。
- Qwen3.6 只生成结构化复核意见和医生复核重点。
- LLM 没有新增、删除或移动 bbox。
- 复核结果已写入 `agent_task.output_json.result.llm_provider_evaluation`。
- 审计日志已写入 `audit_log.action = medical.detector.llm_evaluation`。

报告草稿真实链路烟测：

```text
data_db: data/artifacts/medical-report-provider-smoke-20260510/data.db
task_type: draft_report
provider: lmstudio:qwen36-35b-a3b
report_id: 01KR7N32W0MHJYVE3EE39GM1V7
report_status: draft
structured.generator: llm_provider_structured_report
llm_provider_report.status: drafted
audit_log_id: 01KR7N32W130XHR403NYPC8VCK
```

该烟测证明：

- `draft_report` 可以在真实 Qwen3.6 provider 下返回可解析 JSON。
- 报告草稿写入 `report` 表，状态仍为 `draft`。
- 草稿保留 `本报告为AI辅助草稿，需医生审核确认后生效`。
- provider 结果写入 `report.structured_json.llm_provider_report`。
- 审计日志已写入 `audit_log.action = medical.report.llm_draft`。

报告 + 知识库 + MedGemma 串行烟测：

```text
data_db: data/artifacts/medical-report-rag-medgemma-smoke2-20260510/data.db
qwen_task_type: draft_report
qwen_provider: lmstudio:qwen36-35b-a3b
report_id: 01KR7R1ZDZR4NTNZ9MF3TK2P2G
structured.generator: llm_provider_structured_report
knowledge_evidence.tirads_rule_count: 2
knowledge_evidence.guideline_chunk_count: 5
qwen_audit_log_id: 01KR7R1ZE04YBFQ81H2DH6HS2E
medgemma_task_type: safety_review
medgemma_provider: lmstudio:medgemma-review
medgemma_model: medgemma-4b-it
medical_review_assistant.status: reviewed
medical_review_assistant.role: medical_review_assistant
medical_review_audit_log_id: 01KR7RQX6AJX8QTX4NXJRMS8FQ
```

该烟测证明：

- `draft_report` 会在出报告前查询 `tirads_rules` 和医学 RAG，并把证据写入报告。
- Qwen3.6 主报告可以在只加载 Qwen 的情况下完成 `llm_provider_structured_report`。
- 换载 `medgemma-4b-it` 后，`safety_review` 可以复核同一条已落库报告。
- MedGemma 复核结果写回 `report.structured_json.medical_review_assistant`，并写入 `audit_log.action = medical.report.medgemma_review`。

## 后续待办

1. 修复或重新加载 `qwen/qwen3.6-27b`，确认 27B 是否可作为低显存 fallback。
2. 评估是否继续使用 LM Studio GGUF，或切换到 `data/llm` 下 HF 格式模型 + vLLM。
3. 在 5090 上完成“Qwen3.6 主报告 + MedGemma 复核 + RAG evidence pack”完整 smoke。
4. 将同一 provider 能力继续扩展到安全复核和医生修改建议。
