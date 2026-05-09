# 公开甲状腺超声数据集下载记录

本记录用于验证版模型开发。数据集文件只保存在本地 `data/artifacts/datasets/`，不提交 Git；Git 只提交来源、状态、校验值和使用建议。

## 本地状态

| 数据集 | 状态 | 本地路径 | 主要用途 |
|---|---|---|---|
| TN3K | 已下载并解压 | `data/artifacts/datasets/tn3k/` | 分割、良恶性分类、mask 转 bbox 后做检测预训练 |
| Sample-of-UD-TN | 已下载公开样例 | `data/artifacts/datasets/ud-tn-sample/` | 轻量 smoke test、分类链路检查 |
| TN5000 | 未自动下载 | `data/artifacts/datasets/tn5000/` | YOLOv11/RT-DETR 结节检测主数据集 |
| ThyroidXL | 未下载，需 Hugging Face 人工授权 | `data/artifacts/datasets/thyroidxl/` | 检测、分割、分类、TI-RADS 评估 |
| ThyUS2Path | 未下载，需手工获取大文件 | `data/artifacts/datasets/thyus2path/` | 病理验证分类、外部验证 |
| Stanford Thyroid Cine-clip | 未下载，需 Redivis 官方流程 | `data/artifacts/datasets/stanford-thyroid-cine-clip/` | cine clip 分割、TI-RADS 描述符、外部验证 |
| AHU heterogeneous ultrasound | 未下载，非甲状腺专用 | `data/artifacts/datasets/ahu-heterogeneous-ultrasound/` | 超声域偏移和鲁棒性探测 |
| DDTI | 未下载，原站不可解析 | `data/artifacts/datasets/ddti/` | 小规模分割/检测 smoke test |

## 已下载数据

### TN3K

- 来源：`https://huggingface.co/datasets/haifan-gong/TN3K`
- 本次下载使用：`https://hf-mirror.com/datasets/haifan-gong/TN3K/resolve/main/TN3K.rar`
- 原因：本机直连 Hugging Face API 超时，镜像能解析同一公开仓库文件。
- License：MIT
- Archive：`data/artifacts/datasets/tn3k/raw/TN3K.rar`
- 解压目录：`data/artifacts/datasets/tn3k/processed/datasets/tn3k`
- SHA256：`407fe2b4992e83b037621214aaaa39d86072e03d4ee3765f3c68d06e546e4ad4`

本地解压后的结构：

```text
trainval-image/    2879
trainval-mask/     2879
test-image/         614
test-mask/          614
label4trainval.csv 2879 rows
label4test.csv      614 rows
```

使用建议：

- 分割模型：直接使用 `*-image` 和 `*-mask`。
- 良恶性分类：使用 `label4trainval.csv`、`label4test.csv`。
- 检测模型：先从 mask 生成 bbox，再转换为 YOLO/COCO 格式；不要直接把 TN3K 当原生检测标注集。

### Sample-of-UD-TN

- 来源：`https://github.com/18811755633/Sample-of-UD-TN`
- 本次下载方式：GitHub API 读取 repository tree 和 blob。
- 本地目录：`data/artifacts/datasets/ud-tn-sample/raw/Sample-of-UD-TN-master`
- 文件数：27
- 图像数：26
- License：仓库未声明，验证版只做本地 smoke test。

使用建议：

- 用来快速验证图片读取、手工注册、分类目录扫描和 UI 显示链路。
- 不作为模型训练主数据集，也不作为公开评测结论依据。

## 未自动下载的原因

### TN5000

TN5000 是当前最适合结节检测任务的公开数据集候选，因为它面向 thyroid nodule detection and classification，包含检测标注，适合训练 YOLOv11 主检测模型和 RT-DETR/RF-DETR 对照模型。

本机命令行访问 Figshare 下载地址时返回 AWS WAF challenge：

```text
https://springernature.figshare.com/ndownloader/articles/28455641/versions/1
```

处理方式：

1. 用浏览器打开 Figshare 数据页。
2. 手动下载完整数据包。
3. 放入 `data/artifacts/datasets/tn5000/raw/`。
4. 解压到 `data/artifacts/datasets/tn5000/processed/`。
5. 将文件名、大小、sha256 和标注格式补入 `examples/datasets/thyroid-ultrasound-public.manifest.json`。

### ThyroidXL

Hugging Face API 显示该数据集为 `manual` gated。需要登录 Hugging Face 并接受数据条款后才能下载。本项目可以预留目录和清单，但不应绕过授权流程。

### ThyUS2Path

该数据集适合作为病理验证的良恶性分类外部验证集，但不是第一阶段检测训练主数据集。建议在拿到官方大文件后再纳入本地清单。

### Stanford Thyroid Ultrasound Cine-clip

该数据集包含 cine clip、放射科医生分割、TI-RADS 描述符和病理信息，适合做动态超声片段、分割和外部验证。下载入口走 Redivis 官方流程，建议人工登录、确认条款后再落地到本地目录。

### AHU Heterogeneous Ultrasound

这是多器官异构超声数据集，包含甲状腺但不是甲状腺结节专用主数据。第一阶段不建议用于训练主检测器，后续可作为图像质量、域偏移和设备差异鲁棒性测试集。

### DDTI

DDTI 原始站点 `cimalab.intec.co` 在本机不可解析。只有确认可靠镜像和授权条款后再下载。

## 项目约定

- 数据不入 Git；路径 `data/artifacts/**` 已被 `.gitignore` 排除。
- 每个下载的数据集必须记录来源 URL、下载时间、license/access 状态、sha256、标注类型和本地路径。
- 医疗验证报告必须区分“公开数据集验证”和“院内本地外部验证”，不能用公开数据集结果替代临床验证结论。
- 检测、分割、分类、TI-RADS 特征识别的数据集拆分要固定版本，不要在同一实验中混用不同来源的测试集。
