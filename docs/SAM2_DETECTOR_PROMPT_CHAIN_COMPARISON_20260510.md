# SAM2 detector-prompt 完整链条对比报告

## 1. 本轮目标

在上一轮 `GT bbox -> SAM2` 验证之后，本轮改为真实检测框：

```text
TN3K real ultrasound image
-> detector job
-> detection artifact
-> selected detector bbox
-> SAM2 segment job
-> segmentation artifact + mask PNG
-> Dice / IoU / overlay report
```

本轮目的是验证完整 `detect_nodules -> segment_nodule` 工程链路，并观察检测框质量对 SAM2 分割的影响。

## 2. 配置

| 路线 | Detector | SAM2 | Prompt | 样本 |
|---|---|---|---|---:|
| 上限参考 | TN3K mask 派生 bbox | SAM2.1 large | GT-derived bbox | 20 |
| 实际链路 A | YOLO11m | SAM2.1 large | YOLO highest-confidence bbox | 20 |
| 实际链路 B | RF-DETR-Medium | SAM2.1 large | RF-DETR highest-confidence bbox | 20 |

说明：

- YOLO11m 使用 TN3K 训练权重。
- RF-DETR-Medium 使用 TN5000 训练权重。
- 当前 RF-DETR adapter 已修复灰度图输入问题，会临时转 RGB，不修改原始图像。
- 当前 SAM2 adapter 已修复设备号问题，`JZX_MODEL_DEVICE=0` 会在分割侧转成 `cuda:0`。

## 3. 对比结果

| 路线 | 成功 | Mean Dice | Median Dice | Min Dice | Mean IoU | Dice >= 0.90 | Dice >= 0.95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| GT bbox -> SAM2 | 20 / 20 | 0.830193 | 0.850878 | 0.487826 | 0.726572 | 8 | 1 |
| YOLO bbox -> SAM2 | 20 / 20 | 0.802101 | 0.850652 | 0.458820 | 0.691587 | 7 | 1 |
| RF-DETR bbox -> SAM2 | 20 / 20 | 0.700522 | 0.804631 | 0.000000 | 0.604538 | 5 | 1 |

## 4. 观察

YOLO 路线与 GT bbox 上限比较接近，说明在 TN3K test 这批图像上，YOLO11m 的检测框作为 SAM2 prompt 是可用的。Mean Dice 从 `0.830193` 降到 `0.802101`，主要损失来自检测框偏移和 SAM2 对困难病例边界不稳定。

RF-DETR 路线本轮明显低于 YOLO。主要原因不是 SAM2 链路失败，而是 RF-DETR 在 TN3K 前 20 例上存在 domain shift 或选框错误。最低病例 `0017` Dice 为 `0.0`，检测框与 GT bbox IoU 为 `0.0`；`0009` Dice 为 `0.067947`，检测框与 GT bbox IoU 为 `0.054517`。

这说明：

- TN5000 训练的 RF-DETR 不能直接假设在 TN3K 上优于 TN3K 训练的 YOLO。
- 主检测模型选择必须按目标验证集和医院真实数据重新验证。
- SAM2 分割强依赖 prompt 质量，检测框错位时不应让 SAM2 结果直接进入报告。

## 5. 低分病例

| 路线 | image_id | Dice | Detector bbox IoU vs GT | Detector confidence |
|---|---|---:|---:|---:|
| YOLO -> SAM2 | 0002 | 0.458820 | 0.874977 | 0.856979 |
| YOLO -> SAM2 | 0012 | 0.489228 | 0.644799 | 0.689884 |
| YOLO -> SAM2 | 0003 | 0.608010 | 0.901222 | 0.386547 |
| RF-DETR -> SAM2 | 0017 | 0.000000 | 0.000000 | 0.398413 |
| RF-DETR -> SAM2 | 0009 | 0.067947 | 0.054517 | 0.816468 |
| RF-DETR -> SAM2 | 0008 | 0.099142 | 0.576644 | 0.634757 |

## 6. 输出文件

GT bbox 上限参考：

- `docs/assets/sam2-static-chain-validation-20260510-real20/summary.json`
- `docs/assets/sam2-static-chain-validation-20260510-real20/case_metrics.csv`
- `docs/assets/sam2-static-chain-validation-20260510-real20/contact_sheet.png`

YOLO 实际检测框：

- `docs/assets/sam2-static-chain-validation-20260510-yolo20/summary.json`
- `docs/assets/sam2-static-chain-validation-20260510-yolo20/case_metrics.csv`
- `docs/assets/sam2-static-chain-validation-20260510-yolo20/contact_sheet.png`

RF-DETR 实际检测框：

- `docs/assets/sam2-static-chain-validation-20260510-rfdetr20/summary.json`
- `docs/assets/sam2-static-chain-validation-20260510-rfdetr20/case_metrics.csv`
- `docs/assets/sam2-static-chain-validation-20260510-rfdetr20/contact_sheet.png`

## 7. 结论与下一步

当前工程结论：

- `YOLO11m -> SAM2` 已经可以作为验证版实际静态分割链路。
- `RF-DETR -> SAM2` 需要先做 TN3K/本院数据适配或选择策略修正，暂不宜作为 SAM2 prompt 主来源。
- SAM2 应保留为强 prompt 分割组件和复核对照，不应单独作为最终主分割模型。

下一步建议：

1. 用 YOLO 实际框扩大到 100 例，确认稳定性。
2. 对 RF-DETR 做 TN3K/test-domain 校准，至少先调 confidence、选框策略和图像预处理。
3. 把同一批 20/100 例与 nnU-Net tight ROI ensemble 输出做逐例对比。
4. 在医生工作台中标记 prompt 来源：`gt_bbox_proxy`、`yolo_bbox`、`rfdetr_bbox`，避免报告误读。
