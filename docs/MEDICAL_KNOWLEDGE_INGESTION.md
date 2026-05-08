# 医学知识库导入验证流程

本流程用于验证版医学知识库。它不新建独立知识系统，而是把已审核的医学 manifest 同步写入两处存储：

- `data.db` 医学扩展表：`medical_documents`、`medical_chunk_metadata`、`report_templates`、`knowledge_ingestion_job`
- CodeClaw RAG 库：`rag_chunks`、`rag_terms`、`rag_meta`

## Manifest 边界

当前只支持 JSON manifest。导入入口会强制校验：

- `document.review_status` 必须是 `approved`
- `document.approved_by` 必须存在
- `chunks` 至少 1 条，且每条 `text` 非空
- `report_templates[].status` 只能是 `active` 或 `inactive`

示例文件：

```text
examples/medical-knowledge/acr-tirads-validation.manifest.json
```

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

使用默认 `~/.codeclaw/data.db` 和当前 workspace 对应的 CodeClaw RAG 库：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:ingest -- --manifest examples/medical-knowledge/acr-tirads-validation.manifest.json
```

使用验证版本地数据库：

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical:ingest -- \
  --manifest examples/medical-knowledge/acr-tirads-validation.manifest.json \
  --data-db data/artifacts/medical-validation/data.db \
  --rag-db data/artifacts/medical-validation/rag.db \
  --workspace /Users/xutianliang/Downloads/jiazhuangxian
```

## 数据写入规则

- `medical_documents` 保存文档级 provenance，包括来源、版本、审核状态和审批人。
- 每个 manifest chunk 写入一条 CodeClaw `rag_chunks`，`chunk_id` 形如 `medical/<document_id>/<chunk_id>`。
- `medical_chunk_metadata` 只保存医学过滤维度和 `rag_chunk_id` 关联，不复制 RAG 正文。
- 同一 `document.id` 重复导入时，会替换该文档的 chunk metadata，并删除 manifest 中已经移除的旧 RAG chunk。
- `knowledge_ingestion_job` 会记录 `running`、`succeeded` 或 `failed`，失败时保存错误信息。

## 后续扩展点

- PDF / Markdown 解析：在 manifest 前增加解析器，最终仍输出同一 manifest 结构。
- Embedding：基于现有 `rag_chunks.embedding` 批处理补齐，不放在 manifest 导入同步路径里。
- 医生审核发布：manifest 生成前走人工审核，导入入口只接受已审核内容。
