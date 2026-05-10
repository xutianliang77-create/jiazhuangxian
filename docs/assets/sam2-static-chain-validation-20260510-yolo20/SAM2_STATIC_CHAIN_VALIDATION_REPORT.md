# SAM2 静态 detector-prompt 链条验证报告

## 结论

- 样本数：20
- 成功数：20
- Mean Dice：0.802101
- Median Dice：0.850652
- Mean IoU：0.691587
- Dice >= 0.90：7
- Dice >= 0.95：1

说明：本轮验证先运行 `yolov11-thyroid-detector` 生成真实检测框，再把检测框作为 SAM2 bbox prompt。这用于评估完整 `detect_nodules -> segment_nodule -> artifact` 链路。

## 样本结果

| # | image_id | status | Dice | IoU | confidence | bbox_iou | detector_conf | detector_bbox_iou_gt | overlay |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 0000 | succeeded | 0.85617 | 0.748512 | 0.9149 | 0.770202 | 0.7786346673965454 | 0.853459 | [0000_overlay.png](overlays/0000_overlay.png) |
| 2 | 0001 | succeeded | 0.927139 | 0.864174 | 0.8788 | 0.914619 | 0.7241911888122559 | 0.902669 | [0001_overlay.png](overlays/0001_overlay.png) |
| 3 | 0002 | succeeded | 0.45882 | 0.297707 | 0.7208 | 0.462063 | 0.8569787740707397 | 0.874977 | [0002_overlay.png](overlays/0002_overlay.png) |
| 4 | 0003 | succeeded | 0.60801 | 0.436792 | 0.6742 | 0.643229 | 0.38654661178588867 | 0.901222 | [0003_overlay.png](overlays/0003_overlay.png) |
| 5 | 0004 | succeeded | 0.752101 | 0.602694 | 0.8546 | 0.618924 | 0.7106057405471802 | 0.882024 | [0004_overlay.png](overlays/0004_overlay.png) |
| 6 | 0005 | succeeded | 0.929922 | 0.869023 | 0.9338 | 0.86475 | 0.790492594242096 | 0.914184 | [0005_overlay.png](overlays/0005_overlay.png) |
| 7 | 0006 | succeeded | 0.845133 | 0.731802 | 0.8795 | 0.783816 | 0.8726560473442078 | 0.94975 | [0006_overlay.png](overlays/0006_overlay.png) |
| 8 | 0007 | succeeded | 0.867465 | 0.76595 | 0.8889 | 0.866011 | 0.7080437541007996 | 0.874257 | [0007_overlay.png](overlays/0007_overlay.png) |
| 9 | 0008 | succeeded | 0.700965 | 0.539604 | 0.8757 | 0.59655 | 0.3820268511772156 | 0.865232 | [0008_overlay.png](overlays/0008_overlay.png) |
| 10 | 0009 | succeeded | 0.924404 | 0.859434 | 0.8839 | 0.91604 | 0.580952525138855 | 0.889961 | [0009_overlay.png](overlays/0009_overlay.png) |
| 11 | 0010 | succeeded | 0.943638 | 0.893291 | 0.9474 | 0.889256 | 0.8513974547386169 | 0.959442 | [0010_overlay.png](overlays/0010_overlay.png) |
| 12 | 0011 | succeeded | 0.772804 | 0.629731 | 0.9195 | 0.621156 | 0.7074034810066223 | 0.558515 | [0011_overlay.png](overlays/0011_overlay.png) |
| 13 | 0012 | succeeded | 0.489228 | 0.323826 | 0.6745 | 0.552411 | 0.6898835897445679 | 0.644799 | [0012_overlay.png](overlays/0012_overlay.png) |
| 14 | 0013 | succeeded | 0.927662 | 0.865084 | 0.9508 | 0.871227 | 0.8383327126502991 | 0.899137 | [0013_overlay.png](overlays/0013_overlay.png) |
| 15 | 0014 | succeeded | 0.900428 | 0.81889 | 0.9296 | 0.833378 | 0.8452338576316833 | 0.943673 | [0014_overlay.png](overlays/0014_overlay.png) |
| 16 | 0015 | succeeded | 0.830471 | 0.71009 | 0.7923 | 0.666667 | 0.724699079990387 | 0.782888 | [0015_overlay.png](overlays/0015_overlay.png) |
| 17 | 0016 | succeeded | 0.870125 | 0.770107 | 0.8495 | 0.83252 | 0.7721818685531616 | 0.681386 | [0016_overlay.png](overlays/0016_overlay.png) |
| 18 | 0017 | succeeded | 0.673569 | 0.507805 | 0.8352 | 0.461648 | 0.665206253528595 | 0.66545 | [0017_overlay.png](overlays/0017_overlay.png) |
| 19 | 0018 | succeeded | 0.964222 | 0.930916 | 0.9647 | 0.942478 | 0.7874073386192322 | 0.970329 | [0018_overlay.png](overlays/0018_overlay.png) |
| 20 | 0019 | succeeded | 0.799744 | 0.666311 | 0.9461 | 0.490765 | 0.7765153646469116 | 0.650437 | [0019_overlay.png](overlays/0019_overlay.png) |

## 输出文件

- `summary.json`
- `case_metrics.csv`
- `overlays/*.png`
- `contact_sheet.png`
