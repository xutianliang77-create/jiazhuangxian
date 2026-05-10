# SAM2 静态 detector-prompt 链条验证报告

## 结论

- 样本数：20
- 成功数：20
- Mean Dice：0.830193
- Median Dice：0.850878
- Mean IoU：0.726572
- Dice >= 0.90：8
- Dice >= 0.95：1

说明：本轮验证使用 TN3K mask 派生 bbox 作为 detector-prompt 代理，目的是验证 SAM2 静态分割在正式 `thyroid.segment_nodule -> model-worker -> segmentation artifact` 链路中能真实运行。下一轮应替换为 RF-DETR/YOLO 实际检测框。

## 样本结果

| # | image_id | status | Dice | IoU | confidence | bbox_iou | overlay |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | 0000 | succeeded | 0.881046 | 0.787383 | 0.9052 | 0.84596 | [0000_overlay.png](overlays/0000_overlay.png) |
| 2 | 0001 | succeeded | 0.922289 | 0.855784 | 0.8943 | 0.851408 | [0001_overlay.png](overlays/0001_overlay.png) |
| 3 | 0002 | succeeded | 0.487826 | 0.322599 | 0.3614 | 0.473928 | [0002_overlay.png](overlays/0002_overlay.png) |
| 4 | 0003 | succeeded | 0.538054 | 0.368039 | 0.5876 | 0.598698 | [0003_overlay.png](overlays/0003_overlay.png) |
| 5 | 0004 | succeeded | 0.780303 | 0.639752 | 0.8476 | 0.658854 | [0004_overlay.png](overlays/0004_overlay.png) |
| 6 | 0005 | succeeded | 0.927715 | 0.865175 | 0.9334 | 0.86475 | [0005_overlay.png](overlays/0005_overlay.png) |
| 7 | 0006 | succeeded | 0.837659 | 0.720665 | 0.8789 | 0.748641 | [0006_overlay.png](overlays/0006_overlay.png) |
| 8 | 0007 | succeeded | 0.864097 | 0.760713 | 0.8993 | 0.859375 | [0007_overlay.png](overlays/0007_overlay.png) |
| 9 | 0008 | succeeded | 0.713727 | 0.55488 | 0.8733 | 0.589532 | [0008_overlay.png](overlays/0008_overlay.png) |
| 10 | 0009 | succeeded | 0.920964 | 0.853505 | 0.8831 | 0.968981 | [0009_overlay.png](overlays/0009_overlay.png) |
| 11 | 0010 | succeeded | 0.935674 | 0.879124 | 0.9446 | 0.875826 | [0010_overlay.png](overlays/0010_overlay.png) |
| 12 | 0011 | succeeded | 0.795822 | 0.660885 | 0.8189 | 0.800944 | [0011_overlay.png](overlays/0011_overlay.png) |
| 13 | 0012 | succeeded | 0.932565 | 0.873651 | 0.9069 | 0.848571 | [0012_overlay.png](overlays/0012_overlay.png) |
| 14 | 0013 | succeeded | 0.926218 | 0.862576 | 0.951 | 0.871582 | [0013_overlay.png](overlays/0013_overlay.png) |
| 15 | 0014 | succeeded | 0.918071 | 0.84855 | 0.9271 | 0.856289 | [0014_overlay.png](overlays/0014_overlay.png) |
| 16 | 0015 | succeeded | 0.807091 | 0.676574 | 0.7475 | 0.612857 | [0015_overlay.png](overlays/0015_overlay.png) |
| 17 | 0016 | succeeded | 0.82984 | 0.709168 | 0.7698 | 0.645996 | [0016_overlay.png](overlays/0016_overlay.png) |
| 18 | 0017 | succeeded | 0.807525 | 0.677184 | 0.9076 | 0.571875 | [0017_overlay.png](overlays/0017_overlay.png) |
| 19 | 0018 | succeeded | 0.96232 | 0.927376 | 0.9637 | 0.942478 | [0018_overlay.png](overlays/0018_overlay.png) |
| 20 | 0019 | succeeded | 0.815063 | 0.687853 | 0.9063 | 0.516183 | [0019_overlay.png](overlays/0019_overlay.png) |

## 输出文件

- `summary.json`
- `case_metrics.csv`
- `overlays/*.png`
- `contact_sheet.png`
