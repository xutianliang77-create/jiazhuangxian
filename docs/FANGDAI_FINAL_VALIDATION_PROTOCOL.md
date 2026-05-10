# FangDai 最终外部验证集封存与使用协议

## 1. 数据集定位

`FangDai/Thyroid_Ultrasound_Images` 在本项目中只作为最终外部验证集使用。它不参与训练、调参、模型选择、低 Dice 审计修正或数据增强策略设计。

本数据集当前下载快照是三分类目录标签：

- `FTC`
- `MTC`
- `PTC`

它不包含 bbox、分割 mask、TI-RADS 特征标签或良恶性二分类标签，因此不能用于结节检测、分割 Dice 验证、TI-RADS 规则验证或 YOLO/RF-DETR 评测。

## 2. 本地封存信息

| 项目 | 值 |
| --- | --- |
| Source | `https://huggingface.co/datasets/FangDai/Thyroid_Ultrasound_Images` |
| Download used | `https://hf-mirror.com/datasets/FangDai/Thyroid_Ultrasound_Images` |
| Repo snapshot | `ccd08799a57b8e5c045b71883900cf3e5872d1bc` |
| Raw root | `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/raw` |
| File manifest | `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/file_manifest.csv` |
| Lock file | `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/final_validation_lock.json` |

当前本地口径：

| 类别 | 数量 |
| --- | ---: |
| `FTC` | 100 |
| `MTC` | 99 |
| `PTC` | 99 |
| 合计 | 298 |

数据集 README 写明 900 张图像，但本次仓库快照实际下载到 `Thyroid/` 下 298 张图像。最终验证以本地 `file_manifest.csv` 和 `final_validation_lock.json` 为准。

## 3. 使用前置条件

只有满足以下条件后，才允许运行 FangDai 最终验证：

1. 分类模型结构已经冻结。
2. 模型权重已经冻结，并记录权重路径和 sha256。
3. 预处理流程已经冻结，包括 resize、crop、normalize、色彩通道和插值方式。
4. 分类标签映射已经冻结，必须显式写明 `FTC`、`MTC`、`PTC` 的 index。
5. 决策阈值已经从内部验证集确定，不能在 FangDai 上重新调阈值。
6. 运行验证前必须先执行封存校验脚本，确认文件数量和 sha256 未变化。

## 4. 允许输出的指标

最终报告至少输出：

- Top-1 accuracy
- Macro precision
- Macro recall
- Macro F1
- Balanced accuracy
- Per-class precision / recall / F1
- Confusion matrix
- 每类样本数

建议额外输出：

- bootstrap 95% confidence interval
- calibration ECE
- low-confidence case list
- misclassified case list

## 5. 禁止事项

- 禁止把 FangDai 样本加入训练集。
- 禁止用 FangDai 调学习率、epoch、loss、backbone、prompt 或阈值。
- 禁止根据 FangDai 错例反向修改模型后仍宣称是同一次最终验证。
- 禁止剔除低分样本，除非封存校验在验证前证明文件损坏，并在报告中列明。
- 禁止用该数据集评价检测框 mAP、分割 Dice、TI-RADS 分类或报告生成质量。

## 6. 封存校验命令

```bash
python3 scripts/lock_final_validation_dataset.py \
  --dataset-id fangdai-thyroid-ultrasound-images \
  --raw-root data/artifacts/datasets/fangdai-thyroid-ultrasound-images/raw \
  --file-manifest data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/file_manifest.csv \
  --output-json data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/final_validation_lock.json \
  --expected-count 298 \
  --purpose final_external_validation_only \
  --source-url https://huggingface.co/datasets/FangDai/Thyroid_Ultrasound_Images \
  --download-url-used https://hf-mirror.com/datasets/FangDai/Thyroid_Ultrasound_Images \
  --snapshot-sha ccd08799a57b8e5c045b71883900cf3e5872d1bc
```

## 7. 最终验证输出目录

建议固定输出到：

`data/artifacts/model-evaluation/fangdai-final-validation/<model-id>-<date>/`

每次验证至少保存：

- `evaluation_config.json`
- `model_weight_sha256.txt`
- `predictions.csv`
- `metrics.json`
- `confusion_matrix.png`
- `misclassified_cases.csv`
- `low_confidence_cases.csv`
- `final_validation_report.md`

