# SAM2 静态 detector-prompt 链条验证报告

## 结论

- 样本数：100
- 成功数：97
- Mean Dice：0.769584
- Median Dice：0.837804
- Mean IoU：0.65661
- Dice >= 0.90：22
- Dice >= 0.95：3

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
| 21 | 0020 | succeeded | 0.869472 | 0.769085 | 0.845 | 0.79718 | 0.7636169791221619 | 0.798734 | [0020_overlay.png](overlays/0020_overlay.png) |
| 22 | 0021 | succeeded | 0.908476 | 0.832301 | 0.9705 | 0.904371 | 0.8497723937034607 | 0.937707 | [0021_overlay.png](overlays/0021_overlay.png) |
| 23 | 0022 | succeeded | 0.900316 | 0.818704 | 0.8241 | 0.88633 | 0.77928626537323 | 0.809144 | [0022_overlay.png](overlays/0022_overlay.png) |
| 24 | 0023 | succeeded | 0.88335 | 0.791072 | 0.929 | 0.702479 | 0.7842766642570496 | 0.885482 | [0023_overlay.png](overlays/0023_overlay.png) |
| 25 | 0024 | succeeded | 0.891546 | 0.804315 | 0.8032 | 0.876507 | 0.8494809865951538 | 0.876707 | [0024_overlay.png](overlays/0024_overlay.png) |
| 26 | 0025 | succeeded | 0.882255 | 0.789317 | 0.9125 | 0.883413 | 0.8517266511917114 | 0.9677 | [0025_overlay.png](overlays/0025_overlay.png) |
| 27 | 0026 | succeeded | 0.926909 | 0.863775 | 0.9461 | 0.873275 | 0.8521655797958374 | 0.849173 | [0026_overlay.png](overlays/0026_overlay.png) |
| 28 | 0027 | succeeded | 0.786402 | 0.647993 | 0.8209 | 0.618139 | 0.7319502234458923 | 0.861162 | [0027_overlay.png](overlays/0027_overlay.png) |
| 29 | 0028 | succeeded | 0.885836 | 0.795068 | 0.8676 | 0.825446 | 0.8034842610359192 | 0.917381 | [0028_overlay.png](overlays/0028_overlay.png) |
| 30 | 0029 | succeeded | 0.893336 | 0.807234 | 0.869 | 0.910606 | 0.8308058977127075 | 0.951177 | [0029_overlay.png](overlays/0029_overlay.png) |
| 31 | 0030 | succeeded | 0.739296 | 0.586416 | 0.8488 | 0.641271 | 0.8170901536941528 | 0.871399 | [0030_overlay.png](overlays/0030_overlay.png) |
| 32 | 0031 | succeeded | 0.714357 | 0.555642 | 0.9104 | 0.495332 | 0.7689396739006042 | 0.890598 | [0031_overlay.png](overlays/0031_overlay.png) |
| 33 | 0032 | succeeded | 0.95095 | 0.906486 | 0.9357 | 0.933824 | 0.7322061657905579 | 0.871626 | [0032_overlay.png](overlays/0032_overlay.png) |
| 34 | 0033 | succeeded | 0.847791 | 0.735795 | 0.9159 | 0.718784 | 0.8026337623596191 | 0.86925 | [0033_overlay.png](overlays/0033_overlay.png) |
| 35 | 0034 | succeeded | 0.877331 | 0.781469 | 0.9021 | 0.861878 | 0.5914483666419983 | 0.880236 | [0034_overlay.png](overlays/0034_overlay.png) |
| 36 | 0035 | succeeded | 0.814566 | 0.687146 | 0.8858 | 0.662879 | 0.854235827922821 | 0.834042 | [0035_overlay.png](overlays/0035_overlay.png) |
| 37 | 0036 | succeeded | 0.623471 | 0.45293 | 0.87 | 0.102205 | 0.7526252865791321 | 0.097511 | [0036_overlay.png](overlays/0036_overlay.png) |
| 38 | 0037 | detector_empty |  |  |  |  |  |  |  |
| 39 | 0038 | succeeded | 0.077499 | 0.040311 | 0.743 | 0.037634 | 0.5656796097755432 | 0.04118 | [0038_overlay.png](overlays/0038_overlay.png) |
| 40 | 0039 | succeeded | 0.715012 | 0.556435 | 0.9046 | 0.615672 | 0.8114849328994751 | 0.90235 | [0039_overlay.png](overlays/0039_overlay.png) |
| 41 | 0040 | succeeded | 0.606077 | 0.434799 | 0.8021 | 0.443861 | 0.7790613770484924 | 0.848208 | [0040_overlay.png](overlays/0040_overlay.png) |
| 42 | 0041 | succeeded | 0.065372 | 0.03379 | 0.7226 | 0.059996 | 0.7208480834960938 | 0.055994 | [0041_overlay.png](overlays/0041_overlay.png) |
| 43 | 0042 | succeeded | 0.306745 | 0.181157 | 0.7535 | 0.235342 | 0.8124803900718689 | 0.948966 | [0042_overlay.png](overlays/0042_overlay.png) |
| 44 | 0043 | succeeded | 0.936086 | 0.879851 | 0.9392 | 0.862383 | 0.8390372395515442 | 0.975769 | [0043_overlay.png](overlays/0043_overlay.png) |
| 45 | 0044 | succeeded | 0.692056 | 0.529118 | 0.6869 | 0.803567 | 0.5843020081520081 | 0.70432 | [0044_overlay.png](overlays/0044_overlay.png) |
| 46 | 0045 | succeeded | 0.928627 | 0.866764 | 0.9683 | 0.850009 | 0.828158974647522 | 0.943423 | [0045_overlay.png](overlays/0045_overlay.png) |
| 47 | 0046 | succeeded | 0.885553 | 0.794612 | 0.9603 | 0.860444 | 0.8233687281608582 | 0.904969 | [0046_overlay.png](overlays/0046_overlay.png) |
| 48 | 0047 | succeeded | 0.495907 | 0.329705 | 0.8373 | 0.209811 | 0.33995601534843445 | 0.532913 | [0047_overlay.png](overlays/0047_overlay.png) |
| 49 | 0048 | succeeded | 0.600164 | 0.428739 | 0.5744 | 0.5063 | 0.7084344029426575 | 0.929669 | [0048_overlay.png](overlays/0048_overlay.png) |
| 50 | 0049 | succeeded | 0.693526 | 0.530838 | 0.7314 | 0.829784 | 0.7733752727508545 | 0.936327 | [0049_overlay.png](overlays/0049_overlay.png) |
| 51 | 0050 | succeeded | 0.492342 | 0.326561 | 0.8775 | 0.172587 | 0.5740939974784851 | 0.203048 | [0050_overlay.png](overlays/0050_overlay.png) |
| 52 | 0051 | succeeded | 0.7601 | 0.613034 | 0.8701 | 0.361828 | 0.6933861374855042 | 0.510309 | [0051_overlay.png](overlays/0051_overlay.png) |
| 53 | 0052 | succeeded | 0.909273 | 0.83364 | 0.5791 | 0.879749 | 0.5921853184700012 | 0.828562 | [0052_overlay.png](overlays/0052_overlay.png) |
| 54 | 0053 | succeeded | 0.881614 | 0.788291 | 0.9124 | 0.811089 | 0.6664755344390869 | 0.910789 | [0053_overlay.png](overlays/0053_overlay.png) |
| 55 | 0054 | succeeded | 0.603834 | 0.432495 | 0.7073 | 0.546545 | 0.3285139501094818 | 0.741217 | [0054_overlay.png](overlays/0054_overlay.png) |
| 56 | 0055 | succeeded | 0.89194 | 0.804956 | 0.9273 | 0.879866 | 0.6839351058006287 | 0.932219 | [0055_overlay.png](overlays/0055_overlay.png) |
| 57 | 0056 | succeeded | 0.887763 | 0.798178 | 0.8641 | 0.882065 | 0.7119657397270203 | 0.868127 | [0056_overlay.png](overlays/0056_overlay.png) |
| 58 | 0057 | succeeded | 0.485667 | 0.320713 | 0.9045 | 0.291383 | 0.8171145915985107 | 0.942221 | [0057_overlay.png](overlays/0057_overlay.png) |
| 59 | 0058 | succeeded | 0.837804 | 0.720879 | 0.8992 | 0.802941 | 0.7444523572921753 | 0.94623 | [0058_overlay.png](overlays/0058_overlay.png) |
| 60 | 0059 | succeeded | 0.881777 | 0.788551 | 0.9336 | 0.789763 | 0.8002792000770569 | 0.957275 | [0059_overlay.png](overlays/0059_overlay.png) |
| 61 | 0060 | succeeded | 0.639007 | 0.469515 | 0.8759 | 0.532336 | 0.8352988362312317 | 0.924387 | [0060_overlay.png](overlays/0060_overlay.png) |
| 62 | 0061 | succeeded | 0.907512 | 0.830685 | 0.8231 | 0.851469 | 0.7601432800292969 | 0.783672 | [0061_overlay.png](overlays/0061_overlay.png) |
| 63 | 0062 | succeeded | 0.926186 | 0.86252 | 0.9419 | 0.936459 | 0.8203601241111755 | 0.944847 | [0062_overlay.png](overlays/0062_overlay.png) |
| 64 | 0063 | succeeded | 0.819783 | 0.694604 | 0.8392 | 0.634005 | 0.825966477394104 | 0.906501 | [0063_overlay.png](overlays/0063_overlay.png) |
| 65 | 0064 | succeeded | 0.768527 | 0.624071 | 0.8984 | 0.933201 | 0.8444761633872986 | 0.93892 | [0064_overlay.png](overlays/0064_overlay.png) |
| 66 | 0065 | succeeded | 0.602973 | 0.431612 | 0.884 | 0.470182 | 0.8611350059509277 | 0.884405 | [0065_overlay.png](overlays/0065_overlay.png) |
| 67 | 0066 | succeeded | 0.91179 | 0.83788 | 0.9577 | 0.821775 | 0.8244879841804504 | 0.96164 | [0066_overlay.png](overlays/0066_overlay.png) |
| 68 | 0067 | succeeded | 0.47615 | 0.312465 | 0.884 | 0.350195 | 0.3137727677822113 | 0.385208 | [0067_overlay.png](overlays/0067_overlay.png) |
| 69 | 0068 | succeeded | 0.0984 | 0.051746 | 0.8609 | 0.966738 | 0.8646317720413208 | 0.938207 | [0068_overlay.png](overlays/0068_overlay.png) |
| 70 | 0069 | succeeded | 0.933907 | 0.87601 | 0.8268 | 0.891463 | 0.8017584085464478 | 0.953357 | [0069_overlay.png](overlays/0069_overlay.png) |
| 71 | 0070 | succeeded | 0.895882 | 0.811401 | 0.7123 | 0.874857 | 0.7284353375434875 | 0.892532 | [0070_overlay.png](overlays/0070_overlay.png) |
| 72 | 0071 | succeeded | 0.838706 | 0.722216 | 0.9112 | 0.817637 | 0.8420292139053345 | 0.924564 | [0071_overlay.png](overlays/0071_overlay.png) |
| 73 | 0072 | succeeded | 0.813108 | 0.685073 | 0.8752 | 0.709918 | 0.5401288866996765 | 0.849004 | [0072_overlay.png](overlays/0072_overlay.png) |
| 74 | 0073 | succeeded | 0.862777 | 0.758669 | 0.868 | 0.799031 | 0.8586958050727844 | 0.937358 | [0073_overlay.png](overlays/0073_overlay.png) |
| 75 | 0074 | succeeded | 0.797609 | 0.663353 | 0.8226 | 0.619252 | 0.5253952145576477 | 0.850663 | [0074_overlay.png](overlays/0074_overlay.png) |
| 76 | 0075 | succeeded | 0.810142 | 0.680874 | 0.9444 | 0.641447 | 0.8418210744857788 | 0.920342 | [0075_overlay.png](overlays/0075_overlay.png) |
| 77 | 0076 | succeeded | 0.64753 | 0.478776 | 0.8113 | 0.425466 | 0.3825184404850006 | 0.482575 | [0076_overlay.png](overlays/0076_overlay.png) |
| 78 | 0077 | succeeded | 0.791971 | 0.65559 | 0.8899 | 0.684375 | 0.7666115164756775 | 0.817082 | [0077_overlay.png](overlays/0077_overlay.png) |
| 79 | 0078 | succeeded | 0.767851 | 0.62318 | 0.9262 | 0.603713 | 0.7680743336677551 | 0.788861 | [0078_overlay.png](overlays/0078_overlay.png) |
| 80 | 0079 | succeeded | 0.819366 | 0.694006 | 0.8103 | 0.753512 | 0.636289119720459 | 0.875469 | [0079_overlay.png](overlays/0079_overlay.png) |
| 81 | 0080 | succeeded | 0.658127 | 0.490454 | 0.8547 | 0.517905 | 0.7580633163452148 | 0.913554 | [0080_overlay.png](overlays/0080_overlay.png) |
| 82 | 0081 | succeeded | 0.829678 | 0.708932 | 0.8436 | 0.866219 | 0.47256356477737427 | 0.778577 | [0081_overlay.png](overlays/0081_overlay.png) |
| 83 | 0082 | succeeded | 0.873581 | 0.775538 | 0.9047 | 0.715475 | 0.7619274854660034 | 0.863591 | [0082_overlay.png](overlays/0082_overlay.png) |
| 84 | 0083 | succeeded | 0.865296 | 0.762575 | 0.8686 | 0.86034 | 0.8331859707832336 | 0.939539 | [0083_overlay.png](overlays/0083_overlay.png) |
| 85 | 0084 | succeeded | 0.404205 | 0.253294 | 0.9226 | 0.220949 | 0.8267362117767334 | 0.904169 | [0084_overlay.png](overlays/0084_overlay.png) |
| 86 | 0085 | detector_empty |  |  |  |  |  |  |  |
| 87 | 0086 | succeeded | 0.623041 | 0.452476 | 0.9211 | 0.477215 | 0.853780210018158 | 0.910374 | [0086_overlay.png](overlays/0086_overlay.png) |
| 88 | 0087 | detector_empty |  |  |  |  |  |  |  |
| 89 | 0088 | succeeded | 0.891422 | 0.804113 | 0.977 | 0.773631 | 0.7191768288612366 | 0.968483 | [0088_overlay.png](overlays/0088_overlay.png) |
| 90 | 0089 | succeeded | 0.88584 | 0.795074 | 0.8295 | 0.832769 | 0.8559743165969849 | 0.955009 | [0089_overlay.png](overlays/0089_overlay.png) |
| 91 | 0090 | succeeded | 0.827279 | 0.705436 | 0.8694 | 0.681409 | 0.8444097638130188 | 0.82959 | [0090_overlay.png](overlays/0090_overlay.png) |
| 92 | 0091 | succeeded | 0.723488 | 0.566769 | 0.7906 | 0.677668 | 0.6841057538986206 | 0.860207 | [0091_overlay.png](overlays/0091_overlay.png) |
| 93 | 0092 | succeeded | 0.868266 | 0.7672 | 0.9265 | 0.726704 | 0.8766829967498779 | 0.930776 | [0092_overlay.png](overlays/0092_overlay.png) |
| 94 | 0093 | succeeded | 0.909283 | 0.833657 | 0.925 | 0.823847 | 0.8468886017799377 | 0.955165 | [0093_overlay.png](overlays/0093_overlay.png) |
| 95 | 0094 | succeeded | 0.875484 | 0.778543 | 0.875 | 0.837838 | 0.5878185629844666 | 0.840967 | [0094_overlay.png](overlays/0094_overlay.png) |
| 96 | 0095 | succeeded | 0.684725 | 0.520595 | 0.8885 | 0.391304 | 0.6746723651885986 | 0.857962 | [0095_overlay.png](overlays/0095_overlay.png) |
| 97 | 0096 | succeeded | 0.957873 | 0.919151 | 0.9565 | 0.89918 | 0.8068761229515076 | 0.928942 | [0096_overlay.png](overlays/0096_overlay.png) |
| 98 | 0097 | succeeded | 0.941734 | 0.889884 | 0.9525 | 0.956257 | 0.8028512597084045 | 0.895862 | [0097_overlay.png](overlays/0097_overlay.png) |
| 99 | 0098 | succeeded | 0.941937 | 0.890247 | 0.9495 | 0.905108 | 0.8706483244895935 | 0.959831 | [0098_overlay.png](overlays/0098_overlay.png) |
| 100 | 0099 | succeeded | 0.68684 | 0.523043 | 0.9082 | 0.561946 | 0.8474240303039551 | 0.911517 | [0099_overlay.png](overlays/0099_overlay.png) |

## 输出文件

- `summary.json`
- `case_metrics.csv`
- `overlays/*.png`
- `contact_sheet.png`
