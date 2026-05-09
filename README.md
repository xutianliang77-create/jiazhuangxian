# 甲状腺 AI 智能体

本仓库是甲状腺超声 AI 智能体验证版项目。项目在本地 `CodeClaw/` 源码基础上开发，仓库根目录已经同步 CodeClaw 的核心源码，并在其 Agent Team、MCP、RAG、Web、Storage、Provider 等能力之上扩展医疗多智能体平台。

## 验证版定位

- 主存储：SQLite
- 图像与产物：本地 `data/artifacts`
- 编排：CodeClaw Agent Team 思路 + 医疗 TeamPlan 扩展
- 图像预处理：Python `pydicom` / OpenCV `image-worker`
- 模型服务：Python FastAPI + PyTorch Worker + SQLite `model_job`
- 报告模型：Qwen3.6 主生成，MedGemma 复核
- 知识库：CodeClaw RAG embedding/hybrid 思路 + 医学扩展表
- 权限：验证版不做业务 RBAC/ACL，只做本地访问边界、状态机和审计

## 目录

```text
docs/                    设计方案、开发计划、CodeClaw 复用基线
src/                     CodeClaw 运行时源码，后续在此扩展医疗 Agent、工作流、API
packages/                CodeClaw MCP/工具包，后续新增 thyroid/medical knowledge/rule packages
web-react/               CodeClaw React 工作台，后续扩展医生工作台 UI
services/image-worker/   DICOM/超声图像解析、脱敏、预处理、质量检测
services/model-gateway/  模型路由、SQLite job queue、本地推理 worker
services/model-evaluation/ 模型评估脚本
data/artifacts/          本地验证版图像与 AI 产物目录
```

`CodeClaw/` 是本机原始源码参考目录，已在 `.gitignore` 中排除。实际开发和提交以仓库根目录下的 `src/`、`packages/`、`web-react/`、`web/` 等同步源码为准。

## 关键文档

- [技术详细设计](docs/TECHNICAL_DESIGN.md)
- [开发规范、测试方案与任务拆解](docs/DEVELOPMENT_PLAN.md)
- [UI 设计补充](docs/UI_DESIGN.md)
- [CodeClaw 复用开发基线](docs/CODECLAW_REUSE_BASELINE.md)
- [医学 MCP 本地验证配置](docs/MEDICAL_MCP_SETUP.md)
- [医学知识库导入验证流程](docs/MEDICAL_KNOWLEDGE_INGESTION.md)
- [模型产物规范](docs/MODEL_ARTIFACT_CONVENTIONS.md)
- [远程 RTX 5090 GPU 推理环境配置](docs/GPU_INFERENCE_SETUP.md)
- [进度日志](PROGRESS_LOG.md)

## 当前阶段

P0 医疗验证闭环开发中：已完成 CodeClaw 源码基线、SQLite 医疗 schema、医学知识库导入、MCP 工具、图像/模型 worker 骨架、医生工作台手工登记、病例详情、分析启动，以及验证版 `medical-agent-worker` 任务推进链路。
