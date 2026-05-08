# model-gateway

Python 模型服务入口，负责模型路由、SQLite `model_job` 队列和本地推理 worker 调度。

计划能力：

- 甲状腺结节检测：YOLOv11 主模型，RT-DETR/RF-DETR 对照
- 结节分割测量：MedSAM/MedSAM2、nnU-Net、Swin U-Net
- TI-RADS 特征识别：ResNet50、ViT/TC-ViT、多模态融合
- 报告与复核模型 endpoint：Qwen3.6、MedGemma
- 模型版本、权重 hash、推理参数和 artifact URI 记录
