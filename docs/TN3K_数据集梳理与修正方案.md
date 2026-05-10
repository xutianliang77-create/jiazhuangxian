# TN3K 数据集梳理与修正方案

## 1. 背景

本轮工作基于 `Dataset503_TN3KThyroidROITight` 的 20% holdout 分割审计结果，对 576 例甲状腺结节 ROI 样本进行二次梳理。目标不是直接删除低 Dice 病例，而是把失败样本拆分为可解释、可复核、可用于后续训练改进的子集。

原始数据、标签和预测结果保持不变。本轮只生成清单、子集索引和软链接目录，避免破坏原始数据。

## 2. 输入数据

| 项目 | 路径 |
| --- | --- |
| nnU-Net 数据集 | `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw/Dataset503_TN3KThyroidROITight` |
| holdout 图像 | `imagesTs/*.png` |
| holdout 标签 | `labelsTs/*.png` |
| 5 折集成预测 | `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/imagesTs_pred` |
| full summary | `imagesTs_pred/summary.json` |
| 低 Dice 审计表 | `audit/holdout_low_dice_audit.csv` |

本地文档资产已同步到：

`/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1`

## 3. 梳理规则

### 3.1 审计类别映射

| 审计类别 | 归属分组 | 处理含义 |
| --- | --- | --- |
| `multi_region_gt_partial` | `label_or_task_review` | 可能存在标签范围、任务定义或多区域标注不一致，优先人工复核 |
| `location_shift` | `label_or_task_review` | 可能存在图像、标签或预测空间错位，优先人工复核 |
| `boundary_or_shape_mismatch` | `model_hard` | 结节边界或形态学习不足，作为困难样本候选 |
| `oversegmentation` | `model_hard` | 预测范围过大，适合边界约束和负样本增强 |
| `undersegmentation` | `model_hard` | 预测范围过小，适合边界召回优化 |
| `moderate_boundary_error` | `borderline_boundary` | Dice 介于 0.80 到 0.90 的边界误差样本 |
| 未进入低 Dice 审计表 | `clean_high_confidence` | 当前模型 Dice >= 0.90，作为高置信评估候选 |

### 3.2 复核优先级

| 优先级 | 条件 | 用途 |
| --- | --- | --- |
| `high` | `label_or_task_review`，或 Dice < 0.80 | 人工复核、标签修正、任务定义确认 |
| `medium` | `model_hard` 或 `borderline_boundary` | 困难样本训练、边界损失、模型结构优化 |
| `low` | `clean_high_confidence` | 稳定评估集候选 |

## 4. 梳理结果

### 4.1 总体指标

| 范围 | 病例数 | Mean Dice | Median Dice | Min Dice | Max Dice | Dice < 0.80 | Dice < 0.90 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 全部 holdout | 576 | 0.883226 | 0.903258 | 0.387707 | 0.974363 | 55 | 269 |
| `clean_high_confidence` | 307 | 0.929955 | 0.928212 | 0.900067 | 0.974363 | 0 | 0 |
| `clean_label_candidate` | 522 | 0.894297 | 0.907734 | 0.473582 | 0.974363 | 38 | 215 |
| `manual_review_required` | 92 | 0.750402 | 0.769480 | 0.387707 | 0.894155 | 55 | 92 |
| `label_or_task_review` | 54 | 0.776215 | 0.838774 | 0.387707 | 0.894155 | 17 | 54 |
| `model_hard` | 38 | 0.713720 | 0.734011 | 0.473582 | 0.795341 | 38 | 38 |
| `borderline_boundary` | 177 | 0.871216 | 0.879765 | 0.800788 | 0.899398 | 0 | 177 |

### 4.2 子集清单

| 子集 | 病例数 | 本地名单 | 建议用途 |
| --- | ---: | --- | --- |
| `clean_high_confidence` | 307 | `clean_high_confidence_cases.txt` | 当前高置信评估子集，适合做稳定回归验证 |
| `clean_label_candidate` | 522 | `clean_label_candidate_cases.txt` | 排除明显标签/任务疑点后的候选清洁集，人工确认后可作为 clean-label 评估集 |
| `manual_review_required` | 92 | `manual_review_required_cases.txt` | 高优先级人工复核队列 |
| `label_or_task_review` | 54 | `label_or_task_review_cases.txt` | 标签或任务定义疑点病例，不应直接当作困难样本训练 |
| `model_hard_cases` | 38 | `model_hard_cases.txt` | 模型困难样本候选，适合 hard-case retraining |
| `borderline_boundary` | 177 | `borderline_boundary_cases.txt` | 边界误差池，适合边界损失、Swin U-Net、MedSAM/提示式分割对照 |
| `low_dice_below_080` | 55 | `low_dice_below_080_cases.txt` | Dice < 0.80 的低分样本快照 |

远端完整子集目录：

`/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1`

每个子集目录包含：

- `cases.txt`
- `manifest.csv`
- `imagesTs/`
- `labelsTs/`
- `predictions/`

默认使用软链接指向原始图像、标签和预测文件。

## 5. 关键判断

1. 不能简单剔除所有 Dice < 0.90 病例。`borderline_boundary` 有 177 例，主要是中等边界误差，适合用于边界优化和模型对照。
2. Dice < 0.80 的 55 例需要拆开看。38 例偏模型困难样本，17 例偏标签或任务定义问题。
3. `label_or_task_review` 必须先人工复核。若标签本身存在偏移、多区域或任务定义不一致，直接用于训练会把错误监督信号灌给模型。
4. `clean_high_confidence` 可以作为当前最稳定的回归评估子集，但它来自本次 holdout，不应和后续训练集混用。
5. `clean_label_candidate` 不是最终清洁集。它只是排除了明显标签/任务疑点，里面仍包含 `model_hard` 和 `borderline_boundary`。

## 6. 后续修正流程

### 6.1 人工复核表

先复核 `manual_review_required` 92 例，记录以下字段：

| 字段 | 说明 |
| --- | --- |
| `case_id` | 病例编号 |
| `original_category` | 自动审计类别 |
| `review_decision` | `keep_label` / `fix_mask` / `exclude_from_eval` / `task_definition_issue` |
| `corrected_mask_path` | 修正后 mask 路径，没有修正则为空 |
| `reviewer` | 复核人 |
| `reviewed_at` | 复核时间 |
| `notes` | 复核说明 |

### 6.2 标签修正目录

建议在远端新增：

`/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1/corrected_masks`

只保存经过人工确认的修正 mask，不覆盖原始 `labelsTs`。

### 6.3 数据集版本

人工修正后不要直接覆盖 `Dataset503`，而是生成新版本：

| 版本 | 用途 |
| --- | --- |
| `Dataset503_TN3KThyroidROITight` | 当前基线，冻结保留 |
| `Dataset504_TN3KThyroidROITightCuratedV1` | 纳入人工修正和明确排除规则的新训练/验证版本 |

### 6.4 训练使用建议

- 下一轮 nnU-Net、Swin U-Net、增强 U-Net 调参，优先使用冻结的原始数据集做可比实验。
- 若要利用 `model_hard_cases` 做 hard-case retraining，必须重新生成训练/验证切分，避免把当前 holdout 泄露进训练。
- `label_or_task_review` 复核前不进入训练增强池。
- `borderline_boundary` 可以作为边界改进评估池，用来比较 Dice、IoU、HD95、ASSD 和边界可视化。

## 7. 产物

| 产物 | 路径 |
| --- | --- |
| 梳理脚本 | `/Users/xutianliang/Downloads/jiazhuangxian/scripts/curate_tn3k_low_dice_dataset.py` |
| 单元测试 | `/Users/xutianliang/Downloads/jiazhuangxian/test/unit/scripts/test_curate_tn3k_low_dice_dataset.py` |
| 本地 summary | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/curation_summary.json` |
| 本地 manifest CSV | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/curation_manifest.csv` |
| 本地 manifest JSON | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/curation_manifest.json` |
| 人工复核队列 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/manual_review_queue.csv` |
| 人工复核工作流 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_MANUAL_REVIEW_WORKFLOW.md` |
| 前 20 例复核试跑包 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-manual-review-pilot-v1` |
| 前 20 例复核试跑报告 | `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_人工复核试跑包_前20例.md` |
| 远端完整子集 | `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1` |

## 8. 已执行命令

```bash
cd /home/beelink/jiazhuangxian
.venv-model-gateway-gpu/bin/python scripts/curate_tn3k_low_dice_dataset.py \
  --dataset-root data/nnunet/nnUNet_raw/Dataset503_TN3KThyroidROITight \
  --prediction-dir data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/imagesTs_pred \
  --audit-csv data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/audit/holdout_low_dice_audit.csv \
  --summary-json data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/imagesTs_pred/summary.json \
  --output-dir data/curation/tn3k-tight-roi-low-dice-v1 \
  --overwrite
```

本地验证：

```bash
python3 -m py_compile scripts/curate_tn3k_low_dice_dataset.py test/unit/scripts/test_curate_tn3k_low_dice_dataset.py
python3 test/unit/scripts/test_curate_tn3k_low_dice_dataset.py
```
