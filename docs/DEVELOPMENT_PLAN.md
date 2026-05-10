# 甲状腺 AI 智能体开发规范、测试方案与任务拆解

版本：v1.0
文档类型：研发实施规范
适用范围：甲状腺 AI 智能体平台前端、后端、Agent、MCP、模型服务、知识库、外部接入验证、测试和交付

## 1. 文档目标

本文档用于约束甲状腺 AI 智能体平台的研发过程，确保团队在同一套工程标准下开发、测试、评审和交付。

本文档覆盖：

- 开发规范：代码、分支、提交、评审、文档、配置、安全、审计。
- 开发标准：架构边界、API、数据库、MCP 工具、Agent、模型服务、知识库、UI。
- 测试方案：单元测试、集成测试、端到端测试、模型评估、安全测试、状态边界测试、外部接入验证测试。
- 开发任务：按阶段拆分 MVP 任务、优先级、依赖、交付物和验收标准。

验证版约束：

- 存储采用 SQLite、本地 artifacts 目录和 CodeClaw RAG SQLite，不引入 PostgreSQL、分布式对象存储或独立向量数据库。
- 本次开发只验证能力，不建设业务 RBAC、资源级 ACL、组织架构和权限管理 UI。
- 外部系统先使用手工上传、共享目录、手工录入、CSV/JSON 导入；不接 mock HIS/RIS、HL7/FHIR 或报告回写。

## 2. 基本研发原则

### 2.1 医疗安全优先

系统所有设计和开发必须满足以下底线：

- AI 只做辅助分析，不输出最终诊断。
- 最终报告必须由医生确认。
- 医学建议必须有知识库、指南、规则或医生确认依据。
- 低质量图像、低置信度结果、证据不足时必须转人工。
- 患者数据默认脱敏、最小化使用、全流程审计。

### 2.2 架构边界清晰

```text
CodeClaw 负责通用 Agent 编排
医疗 Agent 负责医学任务调度
MCP 工具负责受控能力暴露
模型服务负责确定性推理
规则引擎负责 TI-RADS 分级
知识库负责医学证据
医生负责最终确认
```

严禁：

- 在前端直接实现医学分级逻辑。
- 在 Agent prompt 中硬编码 TI-RADS 规则。
- 让大模型自由生成分级结果。
- 模型服务直接访问 HIS/EMR/PACS。
- 未经医生确认自动回写正式报告。
- 未脱敏病例进入知识库或训练集。

### 2.3 CodeClaw 优先复用原则

当前项目目录下已有 `CodeClaw/` 原始参考源码，并已将 CodeClaw 工作源码同步到仓库根目录。后续开发原则上基于根目录 CodeClaw 同步源码进行扩展。任何新增医疗功能必须先判断是否能复用 CodeClaw 现有模块，只有在现有模块无法承载医疗业务差异时才新增扩展模块。

必须优先复用：

| 研发对象 | 优先复用模块 |
|---|---|
| 医疗多智能体编排 | `CodeClaw/src/agent/team/` |
| 医学角色执行 | `CodeClaw/src/agent/subagents/` 和 `Task` 工具 |
| 医学工具接入 | `CodeClaw/src/mcp/` 和 MCP server 模式 |
| 医生 Web 工作台 | `CodeClaw/src/channels/web/` 与 `CodeClaw/web-react/` |
| 开源模型接入 | `CodeClaw/src/provider/` 的 vLLM/LM Studio/Ollama/OpenAI-compatible endpoint |
| 医学知识库 | `CodeClaw/src/rag/`、`CodeClaw/src/knowledge/` 的证据包和 provenance 机制 |
| DICOM/图像预处理 | Python pydicom/OpenCV image-worker，CodeClaw 仅通过 MCP/HTTP 调用 |
| 数据库迁移 | `CodeClaw/src/storage/migrate.ts` |
| 审计 | `CodeClaw/src/storage/migrations/audit/001_init.sql` 和 audit 服务 |

开发约束：

- 不新建独立 Agent runtime 替代 QueryEngine 或 Team。
- 不新建独立 MCP 生命周期管理器。
- 不新建独立医生前端项目。
- 不绕过 CodeClaw Web/API 直接操作医疗状态。
- 不绕过 migration 直接建表。
- 不绕过 audit 记录医疗关键操作。

## 3. 项目目录与模块规范

### 3.1 推荐代码组织

基于 CodeClaw 扩展时，建议按以下方式组织新增模块：

```text
CodeClaw/
  src/
    medical/
      agents/
      workflows/
      schemas/
      audit/
      rules/
      integrations/
    channels/
      web/
    agent/
  packages/
    thyroid-mcp/
    medical-knowledge-mcp/
    tirads-rule-engine/
  services/
    model-gateway/
    model-worker/
    image-worker/
    knowledge-ingestion/
    model-evaluation/
  web-react/
    src/
      pages/
      components/
      medical/
  storage/
    migrations/
  test/
    unit/
    integration/
    e2e/
    fixtures/
  scripts/
    evaluation/
```

### 3.2 模块职责

| 模块 | 职责 | 禁止内容 |
|---|---|---|
| `medical/agents` | 医疗 Agent role、prompt、调度配置 | 模型权重、GPU 推理 |
| `medical/workflows` | 病例分析流程、状态机 | UI 展示逻辑 |
| `medical/schemas` | JSON Schema、类型定义 | 业务副作用 |
| `medical/rules` | TI-RADS 规则适配 | 自由文本生成 |
| `medical/integrations` | 手工上传、共享目录、CSV/JSON 导入；试点再扩展 PACS/RIS/HIS/EMR | 直接绕过状态校验和审计写业务表 |
| `packages/thyroid-mcp` | 甲状腺模型工具接口 | 未审计模型调用 |
| `packages/medical-knowledge-mcp` | 知识库检索工具 | 未审核知识输出 |
| `services/model-gateway` | 模型路由、SQLite model_job 队列、vLLM/模型 Worker 调度 | 医生审核逻辑 |
| `services/image-worker` | pydicom/OpenCV 解析、脱敏、预览、预处理和标定提取 | Agent 编排、报告生成 |
| `services/model-evaluation` | 检测、分割、分类、RAG、报告质量评估脚本 | 线上业务状态修改 |
| `web-react/src/medical` | 医疗 UI 组件 | 后端状态校验替代 |

## 4. 开发流程规范

### 4.1 分支规范

| 分支 | 用途 |
|---|---|
| `main` | 稳定主干，必须可构建、可测试 |
| `develop` | 集成开发分支 |
| `feature/<task-id>-<name>` | 新功能开发 |
| `fix/<task-id>-<name>` | 缺陷修复 |
| `docs/<task-id>-<name>` | 文档变更 |
| `release/<version>` | 发布候选 |

示例：

```text
feature/MED-102-agent-role-registry
feature/MED-231-tirads-rule-engine
fix/MED-312-report-state-check
```

### 4.2 提交规范

提交信息格式：

```text
<type>(<scope>): <summary>
```

类型：

| type | 说明 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 文档 |
| `test` | 测试 |
| `refactor` | 重构 |
| `perf` | 性能 |
| `chore` | 构建、配置、依赖 |
| `security` | 安全修复 |

示例：

```text
feat(agent): add thyroid case coordinator role
feat(rules): implement ACR TI-RADS scoring
test(report): cover report signing state guard
docs(ui): add thyroid workstation interaction design
```

### 4.3 Pull Request 规范

每个 PR 必须包含：

- 变更目标。
- 变更范围。
- 关联任务 ID。
- 数据库迁移说明。
- API/MCP/schema 变更说明。
- 安全、审计和状态流转影响说明。
- 测试结果。
- 风险和回滚方式。

PR 模板：

```markdown
## Summary

## Scope

## API / Schema Changes

## Safety / State / Audit Impact

## Test Evidence

## Risk & Rollback
```

### 4.4 Code Review 标准

代码评审必须检查：

- 是否符合架构边界。
- 是否有状态校验和必要本地访问边界。
- 是否写审计日志。
- 是否有 schema 校验。
- 是否有测试覆盖。
- 是否存在患者隐私泄露。
- 是否有大模型幻觉风险。
- 是否绕过医生确认。
- 是否影响外部系统回写安全。

医疗相关 PR 至少需要：

```text
1 名后端/平台评审
1 名业务/医学流程评审
涉及 UI 时增加 1 名前端评审
涉及模型时增加 1 名算法评审
涉及安全/审计时增加 1 名安全评审
```

## 5. 编码规范

### 5.1 TypeScript 规范

- 使用严格类型，不使用隐式 `any`。
- 外部输入必须先 schema 校验，再进入业务逻辑。
- 医疗枚举值集中定义，禁止散落字符串。
- Agent 输出必须定义类型和 JSON Schema。
- 错误必须使用统一错误结构。
- 所有异步任务必须有超时和失败状态。

命名规范：

| 类型 | 规范 |
|---|---|
| 文件名 | `kebab-case.ts` |
| 类型/接口 | `PascalCase` |
| 变量/函数 | `camelCase` |
| 常量 | `UPPER_SNAKE_CASE` |
| 数据库字段 | `snake_case` |
| API 路径 | `kebab-case` |

### 5.2 Python 模型服务规范

- 模型服务只暴露推理 API，不包含医生审核逻辑。
- 模型输入输出必须使用 Pydantic schema。
- 模型加载参数、权重 hash、版本必须记录。
- 推理接口必须支持 trace_id。
- GPU OOM、超时、模型不可用必须返回可识别错误码。
- 不允许将原始患者信息写入模型日志。

推荐结构：

```text
services/model-gateway/
  app/
    api/
    schemas/
    model_registry/
    queue/
    audit/
    config/
  tests/

services/image-worker/
  app/
    api/
    dicom/
    preprocess/
    quality/
    calibration/
    schemas/
  tests/
```

### 5.3 SQL 与迁移规范

- 所有表必须包含主键。
- 关键业务表必须包含 `created_at`。
- 涉及状态流转的表必须明确状态枚举。
- 外部系统消息必须有幂等键。
- 审计表只追加，不更新历史。
- 迁移脚本必须可重复在空库执行。
- 严禁直接修改已发布迁移，必须新增迁移。

字段命名：

```text
外部 ID：external_xxx_id
状态：status
JSON 扩展：xxx_json
文件路径：xxx_uri
时间：xxx_at
版本：version / system_version / model_version
```

### 5.4 前端规范

- 医疗工作台以任务效率为中心，避免营销式页面。
- 图像、AI 结果、报告编辑、证据、安全审核必须在病例详情形成闭环。
- 按钮显示不能替代后端状态机校验。
- AI 草稿、医生修改、最终报告必须明确区分。
- 低置信度、证据不足、安全风险必须醒目标识。
- 已归档报告默认只读。
- 所有删除、驳回、签署操作需要二次确认。

### 5.5 API 错误规范

统一错误格式：

```json
{
  "error": {
    "code": "invalid_state_transition",
    "message": "当前状态不允许执行该操作",
    "trace_id": "TRACE001",
    "details": {}
  }
}
```

常用错误码：

| 错误码 | 说明 |
|---|---|
| `validation_error` | 参数校验失败 |
| `unauthorized` | 本地 token 或 session 无效 |
| `resource_not_found` | 资源不存在 |
| `invalid_state_transition` | 状态流转非法 |
| `image_not_analyzable` | 图像不可分析 |
| `model_unavailable` | 模型服务不可用 |
| `schema_validation_failed` | 模型/Agent 输出结构不合法 |
| `knowledge_evidence_missing` | 知识库无可靠依据 |
| `report_safety_failed` | 报告安全审核未通过 |
| `external_sync_failed` | 外部系统同步失败 |

## 6. Agent 开发标准

### 6.1 Agent 输出标准

Agent 必须输出结构化 JSON。自由文本只能作为解释字段，不得作为唯一结果。

通用结构：

```json
{
  "status": "completed",
  "result": {},
  "warnings": [],
  "requires_human_review": false,
  "evidence": [],
  "trace_id": "TRACE001"
}
```

### 6.2 Agent 工具边界标准

- 每个 Agent 必须配置工具白名单。
- Agent 不得调用与任务无关的工具。
- Agent 不得修改医生最终确认结果。
- Agent 不得直接回写外部系统。
- Agent 调用工具必须写 `tool_call_log`。
- 生产试点阶段再补充服务账号和业务权限校验。

### 6.3 Agent Prompt 标准

Prompt 必须包含：

- 角色职责。
- 输入结构。
- 输出 schema。
- 禁止行为。
- 医生确认边界。
- 低置信度处理方式。
- 知识库引用要求。

Prompt 不允许：

- 写死未版本化医学规则。
- 要求模型直接“诊断恶性”。
- 要求模型忽略医生确认。
- 要求模型在无证据时给出确定建议。

## 7. MCP 工具开发标准

### 7.1 MCP 工具命名

命名格式：

```text
domain.ActionName
```

示例：

```text
thyroid.ImageQC
thyroid.DetectNodules
thyroid.SegmentNodule
thyroid.MeasureNodule
thyroid.ClassifyTiradsFeatures
thyroid.CalculateTirads
image.ParseDicom
image.PreprocessUltrasound
medical.SearchGuideline
medical.CheckReportAgainstGuideline
```

### 7.2 MCP 工具返回结构

```json
{
  "status": "ok",
  "result": {},
  "warnings": [],
  "model": {
    "name": "model-name",
    "version": "v1",
    "weights_hash": "sha256:..."
  },
  "trace_id": "TRACE001"
}
```

规则类工具可不返回 `model`，但必须返回规则版本。

### 7.3 MCP 工具验收标准

- 输入 schema 明确。
- 输出 schema 稳定。
- 错误可解析。
- 记录调用日志。
- 支持 trace_id。
- 支持超时。
- 支持测试 mock。
- 禁止返回不可解析自然语言。

## 8. 数据与安全开发标准

### 8.1 患者数据处理

- 默认不在日志中输出姓名、身份证号、手机号、完整病历。
- UI 默认脱敏显示患者信息。
- 研究和训练数据必须经过脱敏和医生授权。
- 导出数据必须记录导出人、范围、用途、时间。

### 8.2 审计标准

以下动作必须写审计：

- 登录和退出。
- 创建、查看、修改病例。
- 上传、删除、查看原始图像。
- 启动 AI 分析。
- Agent 启动、结束、失败。
- MCP 工具调用。
- 模型推理。
- 知识库检索。
- 报告生成、修改、确认、驳回。
- 外部系统入站和出站消息。

### 8.3 配置与密钥

- 密钥不得提交到 Git。
- 外部系统 endpoint、token、证书必须走密钥管理。
- 模型路径、本地 artifacts 目录、SQLite 数据库路径必须通过环境配置。
- 测试环境不得使用生产患者数据。

## 9. 测试总体方案

### 9.1 测试分层

```text
单元测试
-> 组件测试
-> 集成测试
-> API 测试
-> E2E 测试
-> 安全测试
-> 模型评估
-> 临床验收
```

### 9.2 测试环境

| 环境 | 用途 | 数据要求 |
|---|---|---|
| local | 开发自测 | mock 数据、脱敏样例 |
| test | 自动化测试 | 构造数据、脱敏图像 |
| staging | 联调验收 | 脱敏真实流程数据 |
| prod | 生产 | 真实数据，严格认证、权限和审计；不属于本次验证版范围 |

### 9.3 测试数据规范

- 测试数据不得包含真实姓名、身份证、手机号。
- 医学图像样例必须脱敏。
- 外部系统消息必须使用模拟 patient_id、accession_no。
- 模型评估数据集必须记录来源、标注人、版本。
- 每次模型评估必须固定数据集版本。

## 10. 单元测试方案

### 10.1 后端单元测试

| 模块 | 测试内容 |
|---|---|
| TI-RADS 规则 | 特征分值、总分、分级、尺寸建议 |
| 状态机 | analysis_session、report、agent_task 状态流转 |
| schema | Agent 输出、MCP 输出、API 请求 |
| 审计 | 关键操作是否写日志 |
| 外部标识 | accession_no、Study UID、SOP UID 去重 |

最低要求：

- TI-RADS 规则构造测试集通过率 100%。
- 状态拒绝路径必须覆盖。
- schema 校验失败路径必须覆盖。
- 状态非法流转必须覆盖。

### 10.2 前端单元测试

| 组件 | 测试内容 |
|---|---|
| 检查列表 | 筛选、状态标签、动作按钮状态 |
| 图像工作区 | 图层开关、选中结节、低置信度标识 |
| AI 结果面板 | 特征修改、分级刷新、医生确认 |
| 报告编辑器 | 草稿/最终版区分、禁用词提示 |
| 安全审核面板 | 风险显示、阻断签署 |

### 10.3 模型服务单元测试

| 模块 | 测试内容 |
|---|---|
| Model Gateway | 请求校验、模型路由、超时 |
| SQLite Job Queue | queued/running/succeeded/failed 状态、重试、超时 |
| Worker | 推理任务状态、失败返回 |
| Model Registry | 版本、权重 hash、启停状态 |
| Image Worker | 文件格式、DICOM metadata、PHI 脱敏、pixel spacing、preview、model-ready image |
| vLLM 接入 | Qwen3.6 endpoint、超时、错误降级 |

## 11. 集成测试方案

### 11.1 Agent + MCP 集成

测试场景：

```text
CaseCoordinatorAgent
-> thyroid.ImageQC
-> thyroid.DetectNodules
-> thyroid.ClassifyTiradsFeatures
-> thyroid.CalculateTirads
-> medical.SearchGuideline
-> medical.GetReportTemplate
-> medical.CheckReportAgainstGuideline
```

验收：

- 每次工具调用都有 `tool_call_log`。
- 工具失败时 Agent 状态进入 failed 或 requires_human_review。
- 工具返回非法 JSON 时不进入下一步。
- 低置信度结果不会自动确认。

### 11.2 数据库集成

覆盖：

- 创建 study 后能关联 image。
- 分析后生成 analysis_session 和 agent_task。
- 检测后生成 nodule。
- 分级后生成 tirads_result。
- 报告后生成 report。
- 医生修改后生成 doctor_review。
- 全流程生成 audit_log。

### 11.3 外部接入验证

覆盖：

- 手工上传 DICOM/PNG/JPEG。
- 共享目录批量导入。
- CSV/JSON 患者和检查信息导入。
- accession_no 图像匹配。
- 导入失败重试。
- 患者匹配冲突阻断。

## 12. E2E 测试方案

### 12.1 核心业务路径

场景 1：标准单结节病例

```text
登录
-> 新建检查
-> 上传图像
-> 启动 AI 分析
-> 查看检测框
-> 查看 TI-RADS 分级
-> 生成报告草稿
-> 医生确认
-> 归档
```

验收：

- 页面状态正确。
- AI 结果可见。
- 报告可编辑。
- 安全审核通过后才能签署。
- 审计时间线完整。

场景 2：低质量图像

```text
上传低质量图像
-> 启动分析
-> ImageQcAgent 返回不可分析
-> 系统阻断后续自动分析
-> UI 提示重新上传或人工审核
```

场景 3：低置信度特征

```text
AI 识别边缘置信度低
-> AI 结果面板标记需确认
-> 医生修改特征
-> TI-RADS 自动重算
-> 报告重新生成
```

场景 4：知识库无依据

```text
ReportAgent 请求医学建议
-> RAG 未检索到可靠证据
-> 不生成确定性建议
-> SafetyAuditAgent 阻断签署
```

场景 5：报告导出失败

```text
医生确认报告
-> 导出 PDF 失败
-> 本地报告保持已确认
-> export_job 标记失败并记录错误
-> 可重新导出 Markdown/HTML/JSON
```

## 13. 安全与验证边界测试方案

### 13.1 验证边界测试矩阵

| 测试 | 预期 |
|---|---|
| 未完成 AI 分析就生成报告 | 拒绝 |
| 安全审核未通过就确认报告 | 拒绝 |
| 医生未确认就归档报告 | 拒绝 |
| Agent 调用未配置工具 | 拒绝并记录 |
| 本地 token 或 session 无效 | 拒绝 |
| 医生修改 TI-RADS 特征 | 允许并审计 |
| 医生确认报告 | 安全审核通过后允许 |
| 已归档报告直接修改 | 拒绝，要求创建修订版 |

### 13.2 安全测试

覆盖：

- 越权诊断表达拦截。
- 未审核知识引用拦截。
- 无证据医学建议拦截。
- 日志 PHI 泄露扫描。
- 本地访问边界校验。
- 文件上传类型伪造。
- DICOM metadata PHI 脱敏。
- 外部系统消息重放。

## 14. RAG 与知识库测试方案

### 14.1 检索测试

| 测试 | 预期 |
|---|---|
| 查询 ACR TI-RADS 特征评分 | 返回正确规则和版本 |
| 查询 C-TIRADS 国内规则 | 返回国内指南证据 |
| 查询院内报告模板 | 优先返回院内发布版本 |
| 查询过期指南 | 默认不返回，除非指定历史回放 |
| 查询无依据问题 | `answerable=false` |

### 14.2 知识发布测试

- 未审核文档不可检索。
- 发布新版本后旧报告仍引用旧版本。
- 停用知识不影响历史报告回放。
- 病例经验必须脱敏且 `approved_for_learning=true`。

## 15. 模型评估方案

### 15.1 评估任务

| 任务 | 指标 |
|---|---|
| 图像质控 | accuracy、误拒率、漏拒率 |
| 结节检测 | precision、recall、F1、mAP |
| 分割 | Dice、IoU |
| 测量 | MAE、相对误差 |
| 特征分类 | macro F1、per-feature accuracy |
| 报告生成 | 医生可用率、平均修改率、安全通过率 |

### 15.2 模型上线门禁

模型上线前必须具备：

- 固定验证集。
- 评估报告。
- 模型版本和权重 hash。
- 失败样例分析。
- 已知限制说明。
- 回滚版本。
- 医生或算法负责人审批。

模型不得在没有验证集评估的情况下进入临床试点流程。

## 16. CI/CD 与质量门禁

### 16.1 本地提交前检查

开发者提交前必须运行：

```text
typecheck
lint
unit tests
changed integration tests
schema validation
```

具体命令按仓库脚本定义执行，例如：

```bash
npm run typecheck
npm run test
```

Python 服务执行：

```bash
pytest
ruff check
mypy
```

### 16.2 CI 门禁

CI 必须包含：

- TypeScript 类型检查。
- 后端单元测试。
- 前端组件测试。
- Python 模型服务测试。
- 数据库迁移测试。
- API schema 测试。
- 状态边界测试。
- 安全扫描。
- 文档链接检查。

### 16.3 Definition of Done

任务完成必须满足：

- 功能实现。
- 单元测试通过。
- 必要集成测试通过。
- 状态机和本地访问边界完成。
- 审计日志完成。
- API/MCP/schema 文档更新。
- UI 状态和异常处理完成。
- 无未处理高风险安全问题。
- PR 评审通过。

## 17. 开发任务拆解

### 17.0 任务覆盖检查结论

对照技术详细设计中的 21 个最终组件，开发任务必须覆盖以下新增重点：

| 检查项 | 结论 | 处理 |
|---|---|---|
| Python image-worker | 原任务只写 DICOM 脱敏，缺少 pydicom/OpenCV 主实现 | P2/P3 补 image-worker 与 image MCP wrapper |
| SQLite model_job | 原任务未明确模型队列表 | P3 补 model_job queue |
| YOLOv11 + RT-DETR/RF-DETR | 原任务只写通用 DetectNodules | P3 补主模型、对照模型和一致性解释 |
| MedSAM/nnU-Net/Swin U-Net | 原任务未覆盖分割测量工具 | P3 补 SegmentNodule、MeasureNodule |
| ResNet50/ViT/多模态 | 原任务未覆盖特征分类模型路线 | P3/P8 补分类工具和评估 |
| Qwen3.6/MedGemma/vLLM | 原任务未覆盖报告模型运行 | P3/P8 补 endpoint、部署和验证 |
| Qwen3-Embedding/Reranker | 原任务未覆盖 embedding/rerank | P4 补 CodeClaw RAG embedding/hybrid |
| 9 个医学知识扩展模块 | 原任务只写 documents/chunks/terms/templates | P4 补完整表和工具 |
| 报告导出 | 原任务只写报告编辑 | P5/P8 补 Markdown/HTML/PDF/JSON 导出 |
| 验证版外部接入 | 原任务已改为手工/共享目录/CSV/JSON | P7 保持验证版边界 |

### 17.1 阶段总览

| 阶段 | 名称 | 目标 |
|---|---|---|
| P0 | 工程准备与规范落地 | 建立开发基线、测试基线、文档基线 |
| P1 | CodeClaw 医疗扩展底座 | 建立医疗 Agent、状态、审计和 schema |
| P2 | 病例与图像工作流 | 支持 study、image、上传、预览、分析任务 |
| P3 | TI-RADS 规则与模型工具 | 接入规则引擎和模型服务 |
| P4 | 医学知识库与 RAG | 建立指南、规则、模板和证据检索 |
| P5 | 医生工作台 UI | 完成病例审核、图像、AI 结果、报告编辑 |
| P6 | 安全、审计与验证边界 | 完成安全审核、审计中心、本地访问边界和状态流转保护 |
| P7 | 外部接入验证 | 手工上传、共享目录、CSV/JSON 导入和 accession_no 匹配 |
| P8 | 联调、验证与试点 | 完成端到端验收和临床试点准备 |

### 17.2 P0 工程准备与规范落地

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-001 | 确认 CodeClaw 基线版本和分支策略 | P0 | 分支策略文档 | 团队统一开发分支 |
| MED-002 | 建立项目目录和模块边界 | P0 | 目录结构 PR | 模块职责清晰 |
| MED-003 | 建立 CI 基线 | P0 | CI workflow | typecheck/test 自动执行 |
| MED-004 | 建立代码规范和 PR 模板 | P0 | PR 模板、lint 配置 | PR 可按规范提交 |
| MED-005 | 建立测试数据规范 | P0 | 脱敏测试数据说明 | 无真实 PHI |
| MED-006 | 固化 CodeClaw 复用基线 | P0 | 源码复用清单和禁止重写清单 | 每个新模块能对应复用或扩展点 |
| MED-007 | 固化 21 个组件选型 | P0 | 组件选型清单 | 与技术详细设计一致 |
| MED-008 | RTX 5090/CUDA 12.8 环境基线 | P0 | 环境检查脚本 | PyTorch/vLLM 可运行 |
| MED-009 | 本地数据目录初始化 | P0 | `data/artifacts` 和 SQLite 路径配置 | 空环境可一键初始化 |

### 17.3 P1 CodeClaw 医疗扩展底座

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-101 | 医疗 TeamPlan 扩展 | P0 | 基于 `src/agent/team` 的 thyroid team plan | 可生成病例级医疗 TeamRun |
| MED-102 | 医疗 Agent Role Registry | P0 | medical role registry | 可注册 CaseCoordinatorAgent 等角色 |
| MED-103 | Agent 结构化输出 schema | P0 | JSON Schema | 非法输出被拦截 |
| MED-104 | analysis_session 状态机 | P0 | 状态机实现 | 状态流转测试通过 |
| MED-105 | agent_task 持久化 | P0 | DB 表和写入逻辑 | 每个 Agent 任务可追踪 |
| MED-106 | tool_call_log 记录 | P0 | 工具调用审计 | MCP 调用有日志 |
| MED-107 | SafetyAuditAgent 基线 | P1 | 安全审核 Agent | 可拦截越权报告表达 |

### 17.4 P2 病例与图像工作流

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-201 | patient/study/image 表 | P0 | DB migration | 病例和图像可入库 |
| MED-202 | 检查创建 API | P0 | `/api/v1/studies` | API 测试通过 |
| MED-203 | 图像上传 API | P0 | `/images` API | PNG/JPEG/DICOM 基础上传 |
| MED-204 | 图像预览和本地 artifacts | P0 | raw/preview URI | UI 可查看预览 |
| MED-205 | DICOM metadata 脱敏 | P1 | 脱敏流程 | PHI 不进入普通日志 |
| MED-206 | AI 分析启动 API | P0 | `/analyze` API | 可创建 analysis_session |
| MED-207 | artifacts URI 映射 | P0 | artifact resolver | `artifact://` 可映射本地文件 |
| MED-208 | Python image-worker 骨架 | P0 | image-worker service | pydicom/OpenCV 服务可启动 |
| MED-209 | image-worker 预处理接口 | P0 | parse/deidentify/preview/preprocess/calibration API | 可输出 preview 和 model-ready image |
| MED-210 | 图像质量与标定入库 | P1 | image_quality/pixel_spacing 写入 | 无标定时不输出毫米测量 |

### 17.5 P3 TI-RADS 规则与模型工具

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-301 | ACR TI-RADS 规则表 | P0 | `tirads_rules` seed | 构造测试 100% 通过 |
| MED-302 | C-TIRADS 规则表 | P1 | 规则版本 | 可切换规则体系 |
| MED-303 | TI-RADS 规则引擎 | P0 | `thyroid.CalculateTirads` | 输入特征输出分级 |
| MED-304 | Model Gateway | P0 | 推理网关服务 | 支持任务创建和状态返回 |
| MED-305 | `thyroid.ImageQC` | P0 | MCP 工具 | 可返回质量分 |
| MED-306 | `thyroid.DetectNodules` | P0 | MCP 工具 | 可返回 bbox JSON |
| MED-307 | `thyroid.ClassifyTiradsFeatures` | P1 | MCP 工具 | 可返回特征和置信度 |
| MED-308 | 模型版本登记 | P0 | model registry | 结果包含模型版本 |
| MED-309 | SQLite model_job queue | P0 | model_job 表和轮询 Worker | 推理任务可排队、重试、失败追踪 |
| MED-310 | vLLM/LM Studio/Ollama endpoint 配置 | P0 | model endpoint config | Qwen3.6 endpoint 可切换 |
| MED-311 | image MCP wrapper | P0 | `image.*` MCP 工具 | CodeClaw 可调用 image-worker |
| MED-312 | `thyroid.SegmentNodule` | P1 | MCP 工具 | 可返回 mask/contour |
| MED-312V | `thyroid.SegmentVideoNodule` | P1 | MCP 工具 + video artifact | 可返回逐帧 mask/track |
| MED-313 | `thyroid.MeasureNodule` | P1 | MCP 工具 | 可返回长径、短径、面积、纵横比 |
| MED-313V | `thyroid.MeasureVideoNodule` | P1 | MCP 工具 + video measurement | 可返回最大径帧、关键帧测量、时间稳定性 |
| MED-314 | RF-DETR-Medium 主检测适配 | P0 | detector adapter | 主模型输出 bbox、confidence |
| MED-315 | YOLO11m 对照检测适配 | P1 | comparison adapter | 可输出对照 bbox |
| MED-316 | 双模型一致性解释 | P1 | agreement service | 输出 IoU、一致性和复核标记 |
| MED-317 | Qwen3.6 报告模型接入 | P0 | report model endpoint | 可生成结构化报告草稿 |
| MED-318 | MedGemma 复核模型接入 | P1 | review model endpoint | 可输出医学复核意见 |
| MED-319 | 模型许可证审查清单 | P0 | license matrix | YOLO/MedGemma 等风险可见 |
| MED-320 | 主 LLM 检测结果评估 | P1 | detector result evaluator | 基于 RF-DETR/YOLO/IoU/ImageQC 输出医生复核重点 |

当前实现备注：

- `MED-312` 已完成验证版工具链：`thyroid.SegmentNodule` MCP -> model-gateway -> `thyroid.segment_nodule` job -> `segmentation.json`/`mask_nodule_<index>.png` -> `nodule.mask_uri`。当前默认是 `bbox_fallback` 矩形 mask，必须医生复核，后续替换真实分割模型。
- `MED-313` 已完成验证版工具链：`thyroid.MeasureNodule` MCP -> model-gateway -> `thyroid.measure_nodule` job -> `measurements.json` -> `measurement` 表。无 `PixelSpacing` 时只保留像素测量证据，毫米字段保持空。
- `MED-312V` 已完成验证版工具链骨架和可选 SAM2 adapter 壳：`thyroid.SegmentVideoNodule` MCP -> model-gateway -> `thyroid.segment_video_nodule` job -> `video_segmentation.json`/prompt-frame mask PNG。当前默认是 `video_bbox_prompt_fallback`，只用于链路验证和医生复核；配置 `JZX_MEDSAM2_WEIGHTS`/`JZX_MEDSAM2_CONFIG` 和 `sam2` 包后可尝试 MedSAM2/SAM2 真实视频传播。
- `MED-313V` 已完成验证版工具链骨架：`thyroid.MeasureVideoNodule` MCP -> model-gateway -> `thyroid.measure_video_nodule` job -> `video_measurement.json`。当前可读取视频分割 artifact，选择关键帧并输出像素/毫米测量；无 `PixelSpacing` 时毫米字段保持空。
- 真实 Swin U-Net / U-Net / MedSAM 分割权重和视频 MedSAM2/SAM2 分割测量接入方案见 `docs/SEGMENTATION_MODEL_INTEGRATION_PLAN.md`。优先级为：先接静态图像 MedSAM bbox prompt 真实分割，再接视频 MedSAM2/SAM2 逐帧传播，随后训练 U-Net/nnU-Net 监督基线和 Swin U-Net 对照模型。

### 17.6 P4 医学知识库与 RAG

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-401 | 医学知识扩展表结构 | P0 | 9 个医学扩展表 migration | migration 通过 |
| MED-402 | 文档上传和解析 | P0 | 知识文档管理 | 可上传指南 |
| MED-403 | medical_chunk_metadata | P0 | chunk metadata 写入 | 可关联 CodeClaw rag_chunk_id |
| MED-404 | `medical.SearchGuideline` | P0 | MCP 工具 | 返回 evidence pack |
| MED-405 | `medical.GetTiradsRule` | P0 | MCP 工具 | 返回规则和版本 |
| MED-406 | `medical.GetReportTemplate` | P0 | MCP 工具 | 返回发布模板 |
| MED-407 | 知识审核发布流程 | P1 | 审核状态机 | 未审核知识不可用 |
| MED-408 | CodeClaw RAG embedding/hybrid 复用 | P0 | RAG bridge | 可调用 Qwen3-Embedding/Reranker |
| MED-409 | Qwen3-Embedding/Reranker 配置 | P0 | embedding/rerank config | 可切换 8B/0.6B/BGE-M3 |
| MED-410 | evidence_links | P0 | evidence link service | 报告建议可追溯到 chunk/rule |
| MED-411 | safety_rules | P0 | safety rule registry | SafetyAuditAgent 可读取 |
| MED-412 | knowledge_ingestion_job | P1 | ingestion job tracking | 解析、切片、embedding 状态可追踪 |
| MED-413 | medical.NormalizeTerm | P1 | MCP 工具 | 自由文本可归一化 |
| MED-414 | medical.CheckReportAgainstGuideline | P0 | MCP 工具 | 报告可按证据审核 |
| MED-415 | medical.ExplainTiradsResult | P1 | MCP 工具 | 分级解释带证据 |
| MED-416 | 相似病例检索 | P2 | `SearchSimilarCases` | 仅脱敏且勾选可学习病例可检索 |

### 17.7 P5 医生工作台 UI

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-501 | 工作台首页 | P1 | 任务看板 | 待办和风险可见 |
| MED-502 | 检查列表 | P0 | 列表页 | 支持状态/风险筛选 |
| MED-503 | 图像上传页 | P0 | 上传 UI | 上传状态清晰 |
| MED-504 | 病例详情布局 | P0 | 三栏工作台 | 图像/AI/报告同屏 |
| MED-505 | 图像工作区 | P0 | 图层、bbox、测量 | 可选中和查看结节 |
| MED-506 | AI 结果面板 | P0 | 特征编辑 | 修改后分级重算 |
| MED-507 | 报告编辑区 | P0 | 草稿/最终版 | 医生可编辑报告 |
| MED-508 | 知识证据面板 | P1 | evidence 展示 | 建议能定位证据 |
| MED-509 | 安全审核面板 | P0 | 风险阻断 | 高危风险禁签署 |
| MED-510 | 审计时间线 | P1 | 时间线 | 关键节点可查看 |
| MED-511 | 双模型一致性面板 | P1 | agreement UI | 可查看主模型/对照模型一致性 |
| MED-512 | 分割与测量编辑 | P1 | mask/measurement UI | 医生可修正测量并重算 |
| MED-513 | 报告导出 API | P0 | md/html/pdf/json export | confirmed 报告可导出 |
| MED-514 | 报告导出 UI | P1 | export actions | Web 可下载/预览导出结果 |

### 17.8 P6 安全、审计与验证边界

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-601 | 审计日志服务 | P0 | audit service | 关键操作记录 |
| MED-602 | PHI 日志脱敏 | P0 | log sanitizer | 日志无敏感字段 |
| MED-603 | 报告安全审核规则 | P0 | safety rules | 越权诊断表述被拦截 |
| MED-604 | 本地 token/session 边界 | P1 | local guard | 无效访问被拒绝 |
| MED-605 | 状态流转保护 | P0 | state guard | 未审核、未确认、已归档等非法动作被拒绝 |
| MED-606 | Agent 工具白名单校验 | P0 | allowedTools check | Agent 不能调用未配置工具 |
| MED-607 | 导出审计与脱敏检查 | P0 | export audit | 报告导出记录审计且不泄露 PHI |

### 17.9 P7 外部接入验证

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-701 | 手工上传导入 | P0 | upload import | DICOM/PNG/JPEG 可入库 |
| MED-702 | 共享目录导入 | P1 | folder import | 新文件可被发现并导入 |
| MED-703 | CSV 导入 | P0 | csv importer | patient/study 可批量创建 |
| MED-704 | JSON 导入 | P0 | json importer | patient/study 可批量创建 |
| MED-705 | accession_no 匹配 | P0 | matching service | 图像与检查可自动匹配 |
| MED-706 | 导入失败重试 | P1 | retry flow | 失败可修正后重试 |
| MED-707 | 匹配冲突人工处理 | P2 | 冲突队列 | 错配被阻断 |

### 17.10 P8 联调、验证与试点

| 任务 ID | 任务 | 优先级 | 交付物 | 验收标准 |
|---|---|---|---|---|
| MED-801 | E2E 自动化测试 | P0 | e2e suite | 核心路径通过 |
| MED-802 | 模型评估报告 | P0 | evaluation report | 达到试点门禁 |
| MED-803 | 安全测试报告 | P0 | security report | 无高危问题 |
| MED-804 | 验证边界测试报告 | P0 | boundary report | 状态边界和本地访问边界通过 |
| MED-805 | 医生验收测试 | P0 | UAT report | 医生确认可用 |
| MED-806 | 试点部署手册 | P1 | deployment guide | 可按文档部署 |
| MED-807 | 回滚预案 | P0 | rollback plan | 失败可恢复 |
| MED-808 | Vitest 测试套件 | P0 | TS test suite | 规则、MCP、状态机通过 |
| MED-809 | pytest 测试套件 | P0 | Python test suite | image-worker/model-gateway 通过 |
| MED-810 | Playwright E2E | P0 | browser e2e | 上传、分析、确认、导出通过 |
| MED-811 | 检测模型评估 | P0 | detection eval | recall、precision、mAP、小结节召回可计算 |
| MED-812 | 分割测量评估 | P1 | segmentation eval | Dice、IoU、测量误差可计算 |
| MED-813 | 分类模型评估 | P1 | classification eval | AUC、sensitivity、specificity、F1 可计算 |
| MED-814 | RAG 检索评估 | P0 | rag eval | Recall@K、MRR、证据命中率可计算 |
| MED-815 | 报告生成评估 | P1 | report eval | 医生修改率、安全通过率、证据覆盖率可计算 |
| MED-816 | 5090 单卡部署验证 | P0 | deployment evidence | vLLM/Qwen3.6/image models 可按队列运行 |

## 18. 里程碑计划

| 里程碑 | 范围 | 建议周期 |
|---|---|---|
| M1 工程基线 | P0 | 1-2 周 |
| M2 病例和 Agent 底座 | P1 + P2 基础 | 2-4 周 |
| M3 规则和模型 MVP | P3 | 3-5 周 |
| M4 知识库和报告 | P4 + P5 报告相关 | 3-5 周 |
| M5 医生工作台闭环 | P5 + P6 | 4-6 周 |
| M6 外部接入验证 | P7 | 2-4 周 |
| M7 验证版交付准备 | P8 | 2-4 周 |

具体周期取决于数据可用性、模型成熟度、RTX 5090 环境稳定性和医生评审资源。

## 19. 交付清单

MVP 交付必须包含：

- 可运行的 CodeClaw 医疗扩展服务。
- 病例、图像、AI 分析、报告审核完整流程。
- 医疗 Agent Team 基础角色。
- Python image-worker 和本地 artifacts 存储。
- SQLite model_job 队列和 Model Gateway。
- vLLM/LM Studio/Ollama 模型 endpoint 配置。
- TI-RADS 规则引擎。
- 甲状腺模型 MCP 工具。
- 医学知识库基础检索和 9 个医学扩展模块。
- 医生工作台 UI。
- Web/Markdown/HTML/PDF/JSON 报告导出。
- 状态边界和审计。
- 自动化测试报告。
- 模型评估报告。
- 部署文档。
- 回滚预案。

## 20. 结论

甲状腺 AI 智能体平台验证版研发必须以医疗安全、结构化输出、医生确认、证据可追溯和审计为核心标准。开发任务应按平台底座、病例图像流程、Agent 编排、模型工具、知识库、医生工作台、安全审计、外部接入验证和验收分阶段推进。任何功能只有在通过类型检查、单元测试、集成测试、状态边界测试、安全测试和医生验收后，才能进入验证环境。
