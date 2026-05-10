# TN3K 低 Dice 病例人工复核工作流

## 1. 目标

把 20% holdout 中的 92 例高优先级病例，从“自动审计结论”推进到“可用于 Dataset504 的人工决策”。本流程不直接修改 `Dataset503_TN3KThyroidROITight`，所有修正 mask 都进入新目录，后续再生成 `Dataset504_TN3KThyroidROITightCuratedV1`。

## 2. 输入

| 输入 | 路径 |
| --- | --- |
| 人工复核队列 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/manual_review_queue.csv` |
| 梳理 manifest | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/curation_manifest.csv` |
| 低 Dice 审计报告 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_低Dice病例审计报告.md` |
| 数据集梳理报告 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_数据集梳理与修正方案.md` |
| 远端 curation 根目录 | `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1` |

## 3. 复核决策字典

| `review_decision` | 含义 | 后续处理 |
| --- | --- | --- |
| `keep_label` | 原标签可接受，模型预测失败主要来自模型能力 | 可进入 hard-case 或边界优化评估 |
| `fix_mask` | 原 mask 有明确错误，需要修正 | 写入 `corrected_masks/`，进入 Dataset504 |
| `exclude_from_eval` | 图像或标签无法用于可靠评估 | 从 clean validation 指标中排除，但保留审计记录 |
| `task_definition_issue` | 多区域、ROI 范围或任务定义不一致 | 先冻结，不进入训练增强池 |

## 4. 复核顺序

按以下顺序处理：

1. `label_or_task_review`，优先看 `location_shift` 和 `multi_region_gt_partial`。
2. Dice < 0.60 的极低分病例。
3. `model_hard_cases` 中的 `oversegmentation`、`undersegmentation`、`boundary_or_shape_mismatch`。
4. 必要时再抽查 `borderline_boundary`。

当前队列高优先级病例数：

| 分组 | 数量 |
| --- | ---: |
| `label_or_task_review` | 54 |
| `model_hard` | 38 |
| 合计 | 92 |

## 5. 修正 mask 规则

修正 mask 必须满足：

- 与原图尺寸完全一致。
- 单通道二值图，背景为 0，结节前景为 1 或 255。
- 文件名保持 `{case_id}.png`。
- 不覆盖原始 `labelsTs`。
- 每个修正必须在 `manual_review_queue.csv` 中填写 `review_decision=fix_mask` 和 `corrected_mask_path`。

建议远端目录：

`/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1/corrected_masks`

## 6. 复核字段填写规范

| 字段 | 填写要求 |
| --- | --- |
| `review_decision` | 必填，只能使用决策字典中的值 |
| `corrected_mask_path` | `fix_mask` 时必填，其余可空 |
| `reviewer` | 必填，记录复核人 |
| `reviewed_at` | 必填，建议 ISO 时间 |
| `notes` | 简短说明原因，例如“GT includes adjacent region” 或 “prediction misses posterior boundary” |

## 7. Dataset504 生成条件

只有满足以下条件后才生成 Dataset504：

1. 92 例全部完成 `review_decision`。
2. 所有 `fix_mask` 的文件存在且通过尺寸/二值校验。
3. 所有 `exclude_from_eval` 和 `task_definition_issue` 都有 notes。
4. Dataset504 的训练/验证切分重新生成，不能把当前 holdout 直接泄露进训练。
5. 生成 Dataset504 后，重新跑一次基线 nnU-Net 或当前最佳 selected 5-fold 推理，确认 clean subset 与 hard subset 指标。

## 8. 输出

复核完成后应输出：

- `manual_review_queue.reviewed.csv`
- `corrected_masks/`
- `dataset504_build_manifest.json`
- `dataset504_excluded_cases.txt`
- `dataset504_corrected_cases.txt`
- `Dataset504_TN3KThyroidROITightCuratedV1`
- `TN3K_Dataset504_构建报告.md`

## 9. 已生成的试跑包

已完成前 20 例人工复核试跑包：

| 项目 | 路径 |
| --- | --- |
| 试跑报告 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_人工复核试跑包_前20例.md` |
| 本地复核包 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-manual-review-pilot-v1` |
| 远端复核包 | `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1/review_packets/pilot_first20` |
| 可填写 CSV | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-manual-review-pilot-v1/manual_review_queue_first20.csv` |
| 总览图 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-manual-review-pilot-v1/tn3k_manual_review_contact_sheet.png` |

生成脚本：

`/Users/xutianliang/Downloads/jiazhuangxian/scripts/build_tn3k_manual_review_packet.py`

## 10. TODO

- [ ] 先完成人工填写前 20 例 `manual_review_queue_first20.csv`。
- [ ] 确认四类决策规则是否稳定：`keep_label`、`fix_mask`、`exclude_from_eval`、`task_definition_issue`。
- [ ] 规则稳定后，批量生成剩余 72 例复核包，建议输出到：
  `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1/review_packets/remaining_72`
- [ ] 剩余 72 例同步回本地后，再进入全 92 例人工复核和 Dataset504 构建。
