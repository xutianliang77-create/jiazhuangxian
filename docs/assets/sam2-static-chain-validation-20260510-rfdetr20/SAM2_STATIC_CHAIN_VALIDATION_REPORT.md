# SAM2 静态 detector-prompt 链条验证报告

## 结论

- 样本数：20
- 成功数：20
- Mean Dice：0.700522
- Median Dice：0.804631
- Mean IoU：0.604538
- Dice >= 0.90：5
- Dice >= 0.95：1

说明：本轮验证先运行 `rf-detr-medium-thyroid-detector` 生成真实检测框，再把检测框作为 SAM2 bbox prompt。这用于评估完整 `detect_nodules -> segment_nodule -> artifact` 链路。

## 样本结果

| # | image_id | status | Dice | IoU | confidence | bbox_iou | detector_conf | detector_bbox_iou_gt | overlay |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 0000 | succeeded | 0.88813 | 0.798771 | 0.9047 | 0.856534 | 0.8545997738838196 | 0.85334 | [0000_overlay.png](overlays/0000_overlay.png) |
| 2 | 0001 | succeeded | 0.806685 | 0.676003 | 0.8951 | 0.621502 | 0.8850958943367004 | 0.755088 | [0001_overlay.png](overlays/0001_overlay.png) |
| 3 | 0002 | succeeded | 0.713802 | 0.55497 | 0.8482 | 0.758348 | 0.8425453901290894 | 0.697664 | [0002_overlay.png](overlays/0002_overlay.png) |
| 4 | 0003 | succeeded | 0.37439 | 0.230307 | 0.8951 | 0.151339 | 0.5362973809242249 | 0.175271 | [0003_overlay.png](overlays/0003_overlay.png) |
| 5 | 0004 | succeeded | 0.660856 | 0.493492 | 0.8566 | 0.503472 | 0.7843633890151978 | 0.650772 | [0004_overlay.png](overlays/0004_overlay.png) |
| 6 | 0005 | succeeded | 0.886187 | 0.795634 | 0.9152 | 0.804025 | 0.7725638747215271 | 0.798668 | [0005_overlay.png](overlays/0005_overlay.png) |
| 7 | 0006 | succeeded | 0.849013 | 0.737639 | 0.8783 | 0.79495 | 0.7503637671470642 | 0.929223 | [0006_overlay.png](overlays/0006_overlay.png) |
| 8 | 0007 | succeeded | 0.858622 | 0.752268 | 0.8906 | 0.851042 | 0.72504723072052 | 0.860167 | [0007_overlay.png](overlays/0007_overlay.png) |
| 9 | 0008 | succeeded | 0.099142 | 0.052157 | 0.7141 | 0.247201 | 0.6347574591636658 | 0.576644 | [0008_overlay.png](overlays/0008_overlay.png) |
| 10 | 0009 | succeeded | 0.067947 | 0.035168 | 0.9574 | 0.040311 | 0.8164680004119873 | 0.054517 | [0009_overlay.png](overlays/0009_overlay.png) |
| 11 | 0010 | succeeded | 0.94778 | 0.900744 | 0.9473 | 0.912492 | 0.8932468295097351 | 0.920637 | [0010_overlay.png](overlays/0010_overlay.png) |
| 12 | 0011 | succeeded | 0.772612 | 0.629477 | 0.9215 | 0.621156 | 0.45043763518333435 | 0.576888 | [0011_overlay.png](overlays/0011_overlay.png) |
| 13 | 0012 | succeeded | 0.914468 | 0.842414 | 0.8912 | 0.796465 | 0.889302670955658 | 0.774322 | [0012_overlay.png](overlays/0012_overlay.png) |
| 14 | 0013 | succeeded | 0.93114 | 0.871153 | 0.9499 | 0.875995 | 0.8988261818885803 | 0.833327 | [0013_overlay.png](overlays/0013_overlay.png) |
| 15 | 0014 | succeeded | 0.909473 | 0.833975 | 0.9278 | 0.840575 | 0.8985341787338257 | 0.965568 | [0014_overlay.png](overlays/0014_overlay.png) |
| 16 | 0015 | succeeded | 0.799824 | 0.666423 | 0.8563 | 0.702703 | 0.6751649975776672 | 0.48828 | [0015_overlay.png](overlays/0015_overlay.png) |
| 17 | 0016 | succeeded | 0.761027 | 0.61424 | 0.7873 | 0.627451 | 0.6701226234436035 | 0.374457 | [0016_overlay.png](overlays/0016_overlay.png) |
| 18 | 0017 | succeeded | 0.0 | 0.0 | 0.7873 | 0.0 | 0.39841341972351074 | 0.0 | [0017_overlay.png](overlays/0017_overlay.png) |
| 19 | 0018 | succeeded | 0.966771 | 0.935679 | 0.9645 | 0.93971 | 0.9048373699188232 | 0.91645 | [0018_overlay.png](overlays/0018_overlay.png) |
| 20 | 0019 | succeeded | 0.802576 | 0.670252 | 0.9457 | 0.498744 | 0.8766050338745117 | 0.612192 | [0019_overlay.png](overlays/0019_overlay.png) |

## 输出文件

- `summary.json`
- `case_metrics.csv`
- `overlays/*.png`
- `contact_sheet.png`
