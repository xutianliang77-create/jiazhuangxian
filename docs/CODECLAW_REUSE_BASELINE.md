# CodeClaw 源码阅读与医疗平台复用开发基线

版本：v1.0
文档类型：源码阅读结论 / 开发基线
适用范围：甲状腺 AI 智能体平台后续研发

## 1. 结论

当前项目目录下包含本地原始参考源码 `CodeClaw/`，仓库根目录已经同步 CodeClaw 的工作源码。本次甲状腺 AI 智能体开发原则上应基于根目录下的 CodeClaw 同步源码进行扩展，而不是另起一套 Agent 平台、Web 平台、MCP 框架或会话系统。

路径约定：

- `CodeClaw/`：本地原始参考副本，不直接提交。
- `src/`、`packages/`、`web-react/`、`web/`、`scripts/`：本项目实际开发路径。
- 文档中早期出现的 `CodeClaw/src/...` 可理解为“源自 CodeClaw 的对应模块”，实际改动落在根目录 `src/...`。

总体结论：

```text
CodeClaw = 医疗 AI 平台底座
医疗平台 = CodeClaw 的医疗领域扩展
甲状腺智能体 = 医疗平台的首个专病应用
```

后续开发必须优先复用：

- CodeClaw Agent Team 编排能力。
- CodeClaw Subagent/Task 工具能力。
- CodeClaw MCP server 管理和工具桥接能力。
- CodeClaw Web Channel 和 React 工作台。
- CodeClaw Provider 管理能力。
- CodeClaw RAG/Knowledge 检索能力。
- CodeClaw Storage migration 和 audit 能力。
- CodeClaw MCP/HTTP 工具桥接 Python image-worker 的能力。

## 2. 源码结构阅读摘要

### 2.1 入口与运行时

| 模块 | 路径 | 复用结论 |
|---|---|---|
| CLI 入口 | `CodeClaw/src/cli.tsx` | 保留 CodeClaw 启动方式，医疗平台作为子模块扩展 |
| QueryEngine | `CodeClaw/src/agent/queryEngine.ts` | 核心 Agent runtime，不重写 |
| Slash Commands | `CodeClaw/src/commands/slash/` | 可增加医疗命令，例如 `/medical`、`/thyroid` |
| Provider | `CodeClaw/src/provider/` | 复用本地/云模型 provider、fallback、探测机制 |
| Permissions | `CodeClaw/src/permissions/manager.ts` | 验证版仅复用工具白名单和安全边界；业务权限后置 |

### 2.2 Agent 与 Team 编排

| 模块 | 路径 | 当前能力 |
|---|---|---|
| Subagent roles | `CodeClaw/src/agent/subagents/roles.ts` | 内置代码角色、allowedTools、permissionMode |
| Subagent runner | `CodeClaw/src/agent/subagents/runner.ts` | 子 QueryEngine、工具过滤、5 分钟超时、父 abort 级联 |
| Task tool | `CodeClaw/src/agent/tools/taskTool.ts` | 父 Agent 启动子 Agent |
| Team types | `CodeClaw/src/agent/team/types.ts` | TeamRun、TeamTask、TeamPlan、Blackboard、Mailbox、Claims |
| Team coordinator | `CodeClaw/src/agent/team/coordinator.ts` | 根据目标生成任务 DAG、预算、角色、写策略 |
| Team runner | `CodeClaw/src/agent/team/runner.ts` | read-only team run、Blackboard 汇总、Merge Gate |
| Merge Gate | `CodeClaw/src/agent/team/mergeGate.ts` | reviewer/test/manual gate |
| Claims | `CodeClaw/src/agent/team/claims.ts` | 文件 claim，防止并发写冲突 |
| Team store | `CodeClaw/src/storage/repositories/teamRunRepo.ts` | TeamRun/Claims 持久化 |

医疗平台复用策略：

```text
CaseCoordinatorAgent -> 基于 Team Coordinator 扩展
ImageQcAgent/DetectionAgent/ReportAgent -> 基于 TeamTask/WorkerRole 扩展
医学证据和风险 -> 写入 Blackboard
医生接管和安全审核 -> 作为 Merge Gate 的医疗化门控
分析进度 -> 基于 TeamRun + Web TeamPanel 展示
```

### 2.3 Web 与前端

| 模块 | 路径 | 当前能力 |
|---|---|---|
| Web server | `CodeClaw/src/channels/web/server.ts` | HTTP 路由、SSE、静态资源 |
| Web handlers | `CodeClaw/src/channels/web/handlers.ts` | session、message、provider、MCP、RAG、Graph、Team、Cron |
| SessionStore | `CodeClaw/src/channels/web/sessionStore.ts` | session engine 和消息状态 |
| React workspace | `CodeClaw/web-react/src/components/Workspace.tsx` | 多 panel 工作台 |
| TeamPanel | `CodeClaw/web-react/src/components/panels/TeamPanel.tsx` | TeamRun、task、claim、merge gate 展示 |
| API endpoints | `CodeClaw/web-react/src/api/endpoints.ts` | 前端 API 封装 |

医疗平台复用策略：

- 医生工作台不另建前端项目，优先在 `web-react/src/medical/` 和现有 panel 模式下扩展。
- 病例详情、图像工作区、报告编辑区可作为新的 medical panel。
- 医疗分析进度可复用 TeamPanel 的 task/run 展示方式。
- Web SSE 用于推送 Agent 分析进度、模型推理状态和安全审核结果。

### 2.4 MCP 与医学图像处理边界

| 模块 | 路径 | 当前能力 |
|---|---|---|
| MCP manager | `CodeClaw/src/mcp/manager.ts` | MCP server 生命周期、工具聚合、重启 |
| MCP config | `CodeClaw/src/mcp/config.ts` | workspace `.mcp.json` 和用户级配置 |
| DICOM MCP | `CodeClaw/packages/dicom-mcp/` | 保留为参考代码；本项目不纳入运行链路 |
| Python image-worker | `services/image-worker/` | 计划新增：pydicom/OpenCV 解析、脱敏、预览、预处理和标定提取 |

CodeClaw `dicom-mcp` 当前边界：

- 支持 DICOM Part 10。
- 支持 Explicit/Implicit VR Little Endian。
- 支持单帧灰阶 MONOCHROME1/2。
- 支持 8-bit/16-bit pixel data。
- 不支持 JPEG/JPEG2000/RLE 压缩。
- 不支持多帧导航、DICOMweb、PACS query/retrieve、测量、分割、标注。

医疗平台复用策略：

```text
不注册 packages/dicom-mcp 为甲状腺项目运行工具
新增 Python pydicom/OpenCV image-worker 作为图像处理主实现
新增 image MCP wrapper 调用 image-worker
新增 thyroid-mcp 作为甲状腺模型工具边界
新增 medical-knowledge-mcp 作为医学知识库工具边界
新增 tirads-rule-engine 作为规则工具边界
```

禁止把 DICOM 解析逻辑直接写入 QueryEngine、React 组件或医学 Agent prompt。

### 2.5 RAG 与知识库

| 模块 | 路径 | 当前能力 |
|---|---|---|
| RAG API | `CodeClaw/src/rag/api.ts` | index、search、embed、hybrid search |
| RAG store | `CodeClaw/src/rag/store.ts` | workspace 级 SQLite RAG DB |
| Knowledge tool | `CodeClaw/src/agent/tools/knowledgeTool.ts` | 聚合 RAG、Graph、Beelink 的证据包 |
| Knowledge docs | `CodeClaw/docs/L3_KNOWLEDGE_TECH_DESIGN.md` | L3 Knowledge 设计 |

医疗平台复用策略：

- 医学知识库优先复用 CodeClaw 的“证据包 + provenance”设计。
- 新增医学 metadata：指南名称、版本、审核状态、适用范围、证据级别。
- 不把完整指南全文塞进 prompt，只返回短证据片段和来源。
- 未审核知识不得进入 ReportAgent。

### 2.6 存储与审计

| 模块 | 路径 | 当前能力 |
|---|---|---|
| Migration | `CodeClaw/src/storage/migrate.ts` | data/audit 两套迁移，幂等执行 |
| data schema | `CodeClaw/src/storage/migrations/data/` | sessions、tasks、steps、approvals、team_runs、team_claims |
| audit schema | `CodeClaw/src/storage/migrations/audit/001_init.sql` | append-only audit_events，链式 hash |
| repositories | `CodeClaw/src/storage/repositories/` | session、task、observation、teamRun repo |

医疗平台复用策略：

- 新增医疗业务表必须走 CodeClaw migration 机制。
- 医疗审计事件应优先写入 CodeClaw audit_events 或兼容审计服务。
- TeamRun 可保存医疗分析 run snapshot，但医疗业务实体仍需独立表。
- 不允许绕过 migration 直接创建生产表。

### 2.7 Provider 与本地开源模型

CodeClaw 已支持：

- OpenAI。
- Anthropic。
- Ollama。
- LM Studio。
- Provider fallback。
- 本地 endpoint 探测。
- Web provider 设置查看和编辑。

医疗平台复用策略：

- 开源大模型优先通过 vLLM 主后端接入，LM Studio/Ollama 作为开发调试备选，均通过 OpenAI-compatible local endpoint 暴露。
- 医学图像模型和规则服务不作为 LLM provider，而是通过 MCP/HTTP 工具接入。
- 模型服务必须返回结构化 JSON，不让 Agent 解析自由文本。

## 3. 基于 CodeClaw 的开发基线

### 3.1 必须复用

| 能力 | 必须复用模块 |
|---|---|
| 医疗多智能体编排 | `src/agent/team/` |
| 医学角色执行 | `src/agent/subagents/` + `Task` |
| 工具接入 | `src/mcp/` + MCP server |
| 医生 Web 工作台 | `src/channels/web/` + `web-react/` |
| 模型 provider | `src/provider/` |
| 知识检索 | `src/rag/` + `src/knowledge/` |
| DICOM/图像预处理 | Python image-worker + image MCP wrapper |
| 数据库迁移 | `src/storage/migrate.ts` |
| 审计 | `audit_events` 和审计服务 |

### 3.2 应扩展

| 医疗能力 | 扩展方式 |
|---|---|
| 甲状腺病例分析流程 | 在 TeamPlan/TeamRun 之上增加 MedicalAnalysisSession |
| 医疗 Agent 角色 | 新增 MedicalAgentRole 或扩展 TeamWorkerRole |
| 模型推理 | 新增 `packages/thyroid-mcp` 和外部 Model Gateway |
| TI-RADS 规则 | 新增 `packages/tirads-rule-engine` 或 medical rules service |
| 医学知识库 | 新增 `packages/medical-knowledge-mcp`，复用 RAG provenance |
| 医生工作台 | 在 React workspace 新增 medical pages/panels |
| 外部系统集成 | 新增 `src/medical/integrations/`，不污染 Agent core |
| 访问边界 | 验证版复用 CodeClaw allowedTools、tool permission 和 audit；RBAC/ACL 后置 |

### 3.3 不应重写

以下内容原则上不重写：

- 不重写 QueryEngine。
- 不重写 Team runtime。
- 不重写 MCP manager。
- 不重写 Web server。
- 不新建独立前端工作台项目。
- 不新建独立 provider 管理体系。
- 不新建脱离 CodeClaw migration 的数据库初始化器。
- 不新建脱离 CodeClaw audit 的关键审计链路。

## 4. 医疗平台推荐落地目录

建议在 CodeClaw 内新增：

```text
CodeClaw/src/medical/
  agents/
    medicalRoles.ts
    thyroidTeamPlan.ts
    prompts/
  workflows/
    analysisSession.ts
    thyroidWorkflow.ts
    reportWorkflow.ts
  schemas/
    imageQc.schema.ts
    nodule.schema.ts
    tirads.schema.ts
    report.schema.ts
  rules/
    tirads/
  audit/
    medicalAudit.ts
  integrations/
    pacs/
    ris/
    his/
    emr/

CodeClaw/packages/
  thyroid-mcp/
  medical-knowledge-mcp/
  tirads-rule-engine/

CodeClaw/web-react/src/medical/
  pages/
  components/
  panels/
```

## 5. 开发顺序调整建议

基于当前源码，开发顺序应调整为：

1. 先扩展 Team，而不是先写独立医疗 workflow engine。
2. 先定义医疗 TeamPlan/AgentRole/resultSchema。
3. 再新增医疗业务表和 migration。
4. 再新增 thyroid-mcp、medical-knowledge-mcp、tirads-rule-engine。
5. 再扩展 Web React 医生工作台。
6. 最后接入 PACS/RIS/HIS/EMR。

## 6. 验收标准

后续任何医疗功能开发，都必须满足：

- 能说明复用了哪个 CodeClaw 模块。
- 没有绕过 CodeClaw 工具白名单、审计和状态校验体系。
- Agent 输出有结构化 schema。
- MCP 工具输入输出可测试。
- Web UI 复用现有 session、SSE、panel 和 API 风格。
- 数据库变化通过 migration。
- 关键操作有 audit。
- 失败场景能进入人工接管。

## 7. 最终判断

CodeClaw 已具备从“通用智能体平台”扩展为“医疗 AI Agent 平台”的核心底座。甲状腺 AI 智能体应作为 CodeClaw 的医疗领域扩展来开发，不应把 CodeClaw 只当参考代码。后续研发应采用“在 CodeClaw 内扩展模块、在 MCP 中接入模型、在 Web 工作台中承载医生流程”的路线。
