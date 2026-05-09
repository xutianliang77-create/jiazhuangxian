# 医学知识库导入验证流程

本流程用于验证版医学知识库。它不新建独立知识系统，而是把已审核的医学 manifest 同步写入两处存储：

- `data.db` 医学扩展表：`medical_documents`、`medical_chunk_metadata`、`report_templates`、`knowledge_ingestion_job`
- CodeClaw RAG 库：`rag_chunks`、`rag_terms`、`rag_meta`

## Manifest 边界

当前支持 JSON manifest 和带 YAML front matter 的 Markdown manifest。导入入口会强制校验：

- `document.review_status` 必须是 `approved`
- `document.approved_by` 必须存在
- `chunks` 至少 1 条，且每条 `text` 非空
- `report_templates[].status` 只能是 `active` 或 `inactive`

示例文件：

```text
examples/medical-knowledge/thyroid-guidelines-v1.manifest.json
examples/medical-knowledge/acr-tirads-validation.manifest.json
examples/medical-knowledge/acr-tirads-validation.md
```

`thyroid-guidelines-v1.manifest.json` 是第一版验证知识库，覆盖 ACR TI-RADS 2017、ATA 2015、EU-TIRADS 2017、C-TIRADS 本地化参考边界、跨指南冲突策略和报告证据安全约束。C-TIRADS 当前只作为公开文献参考，不作为默认自动判定规则。

Markdown manifest 的 front matter 必须包含 `document`，可选 `chunk_defaults` 和 `report_templates`。正文会按 Markdown 标题切成知识 chunk，所有 chunk 仍然通过同一套 manifest ingestion 管线写入 `medical_chunk_metadata` 和 CodeClaw `rag_chunks`。

## 运行命令

初始化验证版项目本地数据库和 RAG 库：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:init-db
```

初始化并导入示例知识：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:init-db -- --ingest-sample-knowledge
```

`--ingest-sample-knowledge` 默认导入 `examples/medical-knowledge/thyroid-guidelines-v1.manifest.json`。

使用默认 `~/.codeclaw/data.db` 和当前 workspace 对应的 CodeClaw RAG 库：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:ingest -- --manifest examples/medical-knowledge/thyroid-guidelines-v1.manifest.json
```

导入 Markdown：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:ingest -- --manifest examples/medical-knowledge/acr-tirads-validation.md
```

## Embedding 回填

导入会先建立 `rag_chunks` 和 `rag_terms`，embedding 走单独命令回填，避免导入过程依赖模型服务：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:embed -- \
  --data-db data/artifacts/medical-validation/data.db \
  --rag-db data/artifacts/medical-validation/rag.db \
  --base-url http://127.0.0.1:8000/v1 \
  --model Qwen3-Embedding-0.6B \
  --max-chunks 100
```

也可以用环境变量：

```bash
JZX_EMBED_BASE_URL=http://127.0.0.1:8000/v1 \
JZX_EMBED_MODEL=Qwen3-Embedding-0.6B \
npm run medical:embed -- --data-db data/artifacts/medical-validation/data.db --rag-db data/artifacts/medical-validation/rag.db
```

`medical:embed` 只回填 `medical_chunk_metadata.review_status = approved` 对应的医学 RAG chunk，不会批量修改普通 CodeClaw 工作区 chunk。

使用验证版本地数据库：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:ingest -- \
  --manifest examples/medical-knowledge/thyroid-guidelines-v1.manifest.json \
  --data-db data/artifacts/medical-validation/data.db \
  --rag-db data/artifacts/medical-validation/rag.db \
  --workspace /Users/xutianliang/Downloads/jiazhuangxian
```

## 证据检索

医学证据检索只返回 `medical_documents.review_status = approved` 且 `medical_chunk_metadata.review_status = approved` 的 chunk。检索使用 CodeClaw RAG 的 `rag_chunks` / `rag_terms`，再通过医学 metadata 表补齐文档来源、版本、章节、证据等级和审核信息。

MCP 工具：

```text
/mcp call medical medical.SearchGuideline {"query":"solid composition","top_k":5,"filters":{"body_part":"thyroid"}}
```

医生工作台 Web API：

```bash
curl -s http://127.0.0.1:7180/v1/web/medical/knowledge/search \
  -H "authorization: Bearer $CODECLAW_WEB_TOKEN" \
  -H "content-type: application/json" \
  -d '{"query":"TI-RADS TR4","topK":5,"filters":{"bodyPart":"thyroid"}}'
```

RAG DB 路径优先级：

1. 显式配置 `JZX_RAG_DB`
2. `JZX_DATA_DB` 同目录下的 `rag.db`
3. 当前 workspace 对应的默认 CodeClaw RAG 库

医生工作台中的 `知识证据` 面板调用同一个 Web API，定位是“报告依据/规则解释/安全复核”的证据包展示，不作为自由问答模块。

## 数据写入规则

- `medical_documents` 保存文档级 provenance，包括来源、版本、审核状态和审批人。
- 每个 manifest chunk 写入一条 CodeClaw `rag_chunks`，`chunk_id` 形如 `medical/<document_id>/<chunk_id>`。
- `medical_chunk_metadata` 只保存医学过滤维度和 `rag_chunk_id` 关联，不复制 RAG 正文。
- 同一 `document.id` 重复导入时，会替换该文档的 chunk metadata，并删除 manifest 中已经移除的旧 RAG chunk。
- `knowledge_ingestion_job` 会记录 `running`、`succeeded` 或 `failed`，失败时保存错误信息。

## 后续扩展点

- PDF 解析：在 manifest 前增加解析器，最终仍输出同一 manifest 结构。
- Embedding：通过 `medical:embed` 基于现有 `rag_chunks.embedding` 批处理补齐，不放在 manifest 导入同步路径里。
- 医生审核发布：manifest 生成前走人工审核，导入入口只接受已审核内容。
