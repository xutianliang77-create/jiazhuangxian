# Thyroid Detector Dataset Standard

本项目的结节检测模型只接收同一检测标准的数据。YOLO 输入尺寸统一由训练参数完成；原始数据是否能混合，取决于采集/裁剪方式和标注定义是否一致。

## 可进入检测训练的数据

必须同时满足：

- 原始或近原始甲状腺超声帧，不是只包含结节局部的分类裁剪图。
- 有真实结节定位标注：segmentation mask、bbox、COCO、YOLO label 或可可靠转换成 bbox 的 mask。
- bbox/mask 对应同一张原图坐标系。
- 训练/验证拆分清楚，验证集不能混入伪标注。
- 图像质量、尺寸分布和 TN3K/TN5000 检测数据大体同域。

## 暂不进入检测训练的数据

- 224x224 或固定尺寸 cropped 分类图。
- 只有 benign/malignant 标签、没有真实 bbox/mask 的数据。
- 由当前 detector 自动生成的伪 bbox，除非先通过人工抽样审核和单独外部验证。
- Hugging Face gated 数据，在未完成账号授权和使用条款确认前不下载、不训练。

## 当前数据集结论

| 数据集 | 状态 | 检测训练结论 |
| --- | --- | --- |
| TN3K | 已下载 | 可用。mask 已转换为真实 bbox，当前 strict 主数据。 |
| TN5000 HF cropped classification | 已下载 | 不进入检测训练。全部 224x224 cropped 分类图，只可用于分类预训练/外部验证。 |
| BTX24 thyroid cancer ultrasound | 已下载 | 暂不进入检测训练。尺寸接近原始超声帧，但只有分类标签，无真实 bbox/mask。 |
| ROCOv2 Thyroid | 已下载 | 不进入检测训练。图文/参考数据。 |
| ThyroidXL | gated | 候选检测数据。需 HF 授权后评估 images/labels 是否可直接转换。 |
| TN5000 Figshare detection | 未下载 | P0 候选。需手工下载官方检测版本并转换真实 annotations。 |

## 训练原则

- detector training 使用 strict manifest。
- classification dataset 不能用 full-image pseudo bbox 直接混入 detector。
- 若做半监督伪标注，必须单独命名、单独记录来源，并只放入训练集；验证集仍必须是真实 bbox/mask。
- 93% mAP50 目标只在真实检测验证集上计算。
