# 医学 MCP 本地验证配置

本文件说明如何把 `packages/medical-mcp` 挂到 CodeClaw MCP Manager，并连接本地验证版 `image-worker` 与 `model-gateway`。

## 运行边界

| 组件 | 启动方式 | 职责 |
|---|---|---|
| `medical` MCP server | CodeClaw 根据 `.mcp.json` 以 stdio 子进程启动 | 暴露 `image.*`、`thyroid.*`、`medical.*` 工具 |
| `image-worker` | 单独 HTTP 服务 | DICOM 解析、脱敏、预览、预处理、图像质量检查 |
| `model-gateway` | 单独 HTTP 服务 | 接收检测请求并写入 `model_job` 队列 |
| `model-worker` | 单独后台进程 | 消费 `model_job`；当前验证版只写结构化未配置错误 |

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

终端 1：启动图像服务。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_ARTIFACT_ROOT=data/artifacts npm run image-worker
```

终端 2：启动模型网关。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_DATA_DB=data/artifacts/model-gateway/model-gateway.db npm run model-gateway
```

终端 3：启动验证 worker。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
JZX_DATA_DB=data/artifacts/model-gateway/model-gateway.db npm run model-worker
```

终端 4：启动 CodeClaw，并通过 `/mcp` 检查工具。

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

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `/mcp tools medical` 无工具 | `npm run medical:mcp` 启动失败或工作目录不对 | 项目级配置用样例；用户级配置加绝对 `cwd` |
| `image-worker` unreachable | HTTP 服务未启动或端口不一致 | 检查 `JZX_IMAGE_WORKER_URL` 和 `npm run image-worker` |
| `model_gateway_unreachable` | model-gateway 未启动 | 检查 `JZX_MODEL_GATEWAY_URL` 和 `npm run model-gateway` |
| `knowledge_db_unavailable` | `JZX_DATA_DB` 指向的 SQLite 不存在或未迁移 | 使用默认 `~/.codeclaw/data.db`，或先初始化带医学迁移的验证数据库 |
| `detector_not_configured` | 当前验证 worker 尚未接真实 YOLOv11/RT-DETR 权重 | 这是当前预期行为；后续替换 detector adapter |
