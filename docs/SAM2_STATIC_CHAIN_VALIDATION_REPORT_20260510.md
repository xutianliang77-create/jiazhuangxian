# SAM2 静态 detector-prompt 完整链条验证报告

## 1. 验证目标

本轮验证目标不是重新训练模型，而是确认 SAM2.1 large 能在现有 CodeClaw/model-gateway 工程链路中真实运行：

```text
TN3K real ultrasound image
-> bbox detector prompt
-> ModelJobStore.enqueue_segment_nodule
-> model-worker run_once
-> Sam2ImageSegmenter
-> segmentation.json + mask_nodule_<index>.png
-> Dice / IoU / overlay report
```

## 2. 数据与方法

- 数据集：TN3K test split 前 20 例真实甲状腺超声图像。
- 输入图像：`data/artifacts/datasets/tn3k/processed/datasets/tn3k/test-image/*.jpg`
- GT mask：`data/artifacts/datasets/tn3k/processed/datasets/tn3k/test-mask/*.jpg`
- Prompt：由 TN3K mask 派生的 bbox，作为 detector-prompt 代理。
- 模型：`sam2-thyroid-segmenter`
- 权重：`sam2.1_hiera_large.pt`
- fallback：关闭，`allow_bbox_fallback=false`
- 输出目录：
  `docs/assets/sam2-static-chain-validation-20260510-real20`

说明：本轮的 prompt bbox 还不是 RF-DETR/YOLO 实际检测框，目的是先验证 SAM2 静态分割链路能否真实跑通。下一轮应替换为检测模型输出框。

## 3. 结果摘要

| 指标 | 结果 |
|---|---:|
| 样本数 | 20 |
| 成功数 | 20 |
| Mean Dice | 0.830193 |
| Median Dice | 0.850878 |
| Min Dice | 0.487826 |
| Mean IoU | 0.726572 |
| Median IoU | 0.740689 |
| Min IoU | 0.322599 |
| Dice >= 0.90 | 8 |
| Dice >= 0.95 | 1 |

## 4. 观察

- 工程链路已经成立：20 例全部通过 `model-worker` 写出正式 `segmentation.json` 和 mask artifact。
- SAM2.1 large 对部分边界清晰的病例表现很好，最高 Dice 为 `0.962320`。
- 低分病例主要集中在 `0002` 和 `0003`，其中 `0002` Dice `0.487826`，`0003` Dice `0.538054`。
- 这说明 SAM2 detector-prompt 可以作为强 prompt 分割组件，但不宜直接替代训练型甲状腺专用分割模型。
- 下一步应使用 RF-DETR/YOLO 实际检测框重跑，并与当前 nnU-Net tight ROI ensemble 做逐例对照。

## 5. 输出文件

- 完整生成报告：`docs/assets/sam2-static-chain-validation-20260510-real20/SAM2_STATIC_CHAIN_VALIDATION_REPORT.md`
- 指标 JSON：`docs/assets/sam2-static-chain-validation-20260510-real20/summary.json`
- 逐例 CSV：`docs/assets/sam2-static-chain-validation-20260510-real20/case_metrics.csv`
- 总览图：`docs/assets/sam2-static-chain-validation-20260510-real20/contact_sheet.png`
- 逐例 overlay：`docs/assets/sam2-static-chain-validation-20260510-real20/overlays/*.png`

## 6. 结论

SAM2.1 large 已经可以作为静态 detector-prompt 分割组件进入验证版工程链路。当前 20 例结果还没有达到可直接作为主分割模型的稳定性，建议定位为：

- 第一阶段真实 mask 生成能力验证组件。
- 与 nnU-Net / Swin U-Net 的对照模型。
- 医生工作台中的 prompt 分割辅助和复核参考。

训练型主模型仍建议继续推进 nnU-Net v2 ResEnc 2D，并在 curated clean set 上重新训练。
