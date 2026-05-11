# RTX 5090 AI 服务器模式

日期：2026-05-11

本模式把 Mac 上的 CodeClaw/医生工作台与 5090 GPU 推理解耦：

```text
Mac medical-agent-worker
-> HTTP POST 5090 model-gateway
-> 5090 model-worker 消费远端 model_job
-> Mac 轮询 /model/v1/jobs/{job_id}
-> 本地 SQLite 写入检测、分割、测量和报告依据
```

默认行为不变：未设置 `JZX_REMOTE_MODEL_GATEWAY_URL` 时，`medical-agent-worker` 仍写本地 SQLite `model_job`，由本地 `model-worker` 消费。

## 1. 5090 启动

在 5090 主机执行：

```bash
cd /home/beelink/jiazhuangxian

# 配置检查
scripts/start-5090-ai-server.sh check

# 终端 1：HTTP 网关
scripts/start-5090-ai-server.sh gateway

# 终端 2：GPU worker
scripts/start-5090-ai-server.sh worker
```

默认监听：

```text
http://0.0.0.0:8766
```

Mac 访问地址：

```text
http://100.110.127.117:8766
```

## 2. Mac 调用远程模型网关

在 Mac 上运行 medical agent worker 时增加：

```bash
export JZX_REMOTE_MODEL_GATEWAY_URL=http://100.110.127.117:8766
export JZX_MEDICAL_REAL_INFERENCE=1

npm run medical-agent-worker:once -- \
  --data-db data/artifacts/medical/data.db \
  --rag-db data/artifacts/medical/rag.db \
  --workspace /Users/xutianliang/Downloads/jiazhuangxian \
  --remote-model-gateway-url http://100.110.127.117:8766
```

`JZX_MEDICAL_REAL_INFERENCE=1` 会关闭自动分割的 bbox fallback。未配置真实分割模型时，远端 worker 会返回明确失败，不会伪造 mask。

## 3. 任务状态同步

远程模式下，Mac 本地仍会创建一个 `model_job` 影子记录：

- `model_job.id` 使用 5090 返回的远程 job id。
- `model_job.input.remote_model_gateway.url` 记录远程网关地址。
- 后续 `medical-agent-worker` 会轮询 `GET /model/v1/jobs/{job_id}`。
- 远程 job 成功后，本地同步 `status/output/error/artifact_uri/started_at/completed_at`。
- 本地报告、医生工作台和审计仍读取本地 SQLite。

## 4. Artifact 约束

当前远程模式要求 5090 能读取 `image_uri` 指向的图像：

```text
artifact://...
```

必须在 5090 的 `JZX_ARTIFACT_ROOT` 下存在同一路径，或由上游流程先同步图像。否则远端模型 worker 会返回 `image_path_missing`。

本轮只完成远程 job 调度和结果同步。下一步需要补齐 artifact 自动上传/回传或远程 artifact 代理，以便医生工作台直接预览 5090 生成的 overlay 和 mask。

## 5. 已验证模型配置

`scripts/start-5090-ai-server.sh` 默认使用本项目已验证的 5090 路径：

| 类型 | 默认路径 |
|---|---|
| RF-DETR | `data/artifacts/model-training/tn5000-rfdetr/runs/tn5000-clean-rfdetr-medium-80-20-e40-r576-b4x4-target90/checkpoint_best_ema.pth` |
| YOLO11m | `runs/detect/data/artifacts/model-training/tn5000-yolo/runs/tn5000-clean-yolo11m-80-20-e150-i896-b16-target90/weights/best.pt` |
| RT-DETR | `runs/detect/data/artifacts/model-training/tn5000-rtdetr/runs/tn5000-clean-rtdetr-l-80-20-e120-i896-b8-target90/weights/best.pt` |
| nnU-Net | `data/nnunet/nnUNet_results`, Dataset503, 2d, folds `0 1 2 3 4` |
| SAM2 | `data/models/segmentation/medsam2/sam2.1_hiera_large.pt` |

## 6. 下一步

1. 增加 model-gateway artifact 下载接口或 Mac 端 artifact 回传任务。
2. 在医生工作台详情页展示远程 overlay/mask。
3. 增加真实 UI smoke：上传图像、远程检测、远程分割、测量、报告依据、医生审核。
4. 将 5090 gateway/worker 做成 systemd 或 launchd 等常驻服务。
