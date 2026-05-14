# 甲状腺数据集整理工具

这是一个独立工具，不依赖 CodeClaw、数据库、前端或模型服务。它只做一件事：扫描硬盘中的甲状腺超声资料，并整理成后续训练、验证、复核都能消费的数据集目录。

核心原则：

- 原始硬盘目录只读，工具不会移动、覆盖、重命名或修改源文件。
- 脱敏后的图片、视频、报告、标注和 manifest 统一保存到 `--output-dir` 指定的新数据集目录。
- 默认不会把原始文件路径写入数据集清单，因为路径和文件夹名里也可能包含姓名或病历号。
- 原始姓名、病历号、检查号等只在构建过程中用于病例关联；输出里保存的是不可逆哈希后的 `patient_key`、`study_key`、`case_id`。

## 输入

支持递归扫描一个硬盘目录中的这些文件：

- JPG / JPEG / PNG 静态图像
- LabelMe JSON 标注
- DOCX / PDF / TXT / MD / RTF / HTML 报告
- MP4 / AVI / MOV / MKV 等普通视频
- DICOM 文件，包括无扩展名 DICOM

如果本机安装了 `pydicom`，工具会额外读取 DICOM 的 `Modality`、`Rows`、`Columns`、`NumberOfFrames`、`PixelSpacing` 等元数据；没有安装也能先完成基础整理。

## 快速使用

如果不会使用命令行，优先用图形界面版：

```bash
python3 dataset-tool/thyroid_dataset_gui.py
```

打开后只需要选择“原始资料文件夹”和“脱敏数据集保存目录”，再点击“开始整理数据集”。Windows 可执行版见 [README_EXECUTABLE.md](README_EXECUTABLE.md)。

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian

python3 dataset-tool/thyroid_dataset_builder.py \
  --source-root /Volumes/你的硬盘/甲状腺原始资料 \
  --output-dir data/artifacts/datasets/my-thyroid-clinical-dataset \
  --dataset-id my-thyroid-clinical-dataset \
  --case-mode auto \
  --copy-mode symlink \
  --sensitive-term 张三
```

默认会开启 `--deidentify basic`。图片/视频会遮盖顶部 16% 和底部 12% 的屏幕叠字区域，文本报告会替换姓名、手机号、身份证号、住院号等字段。源文件永远不修改。

`--copy-mode symlink` 是默认值，适合硬盘资料很大时先快速整理；默认脱敏模式下，需要进入训练集的图片、视频、报告、JSON 标注仍会生成真实脱敏副本，不会链接到源文件。最终归档可以改成：

```bash
--copy-mode copy
```

如果要用姓名、病历号、检查号把同一患者的一次检查、手术、病理、随访资料关联起来，建议提供一个本地 salt：

```bash
python3 dataset-tool/thyroid_dataset_builder.py \
  --source-root /Volumes/你的硬盘/甲状腺原始资料 \
  --output-dir data/artifacts/datasets/my-thyroid-clinical-dataset \
  --dataset-id my-thyroid-clinical-dataset \
  --linkage-mode identity \
  --linkage-salt-file ./dataset-linkage-salt.txt \
  --sensitive-terms-file sensitive_terms.txt
```

`dataset-linkage-salt.txt` 不要放进要共享的数据集目录，也不要提交到 Git。没有 salt 时，工具只能按目录做弱关联；有 salt 时，才会输出稳定的 `patient_key` 和 `study_key`，便于后续合并报告、病理和随访结局。

工具从报告或 DICOM 中提取到的姓名、病历号、检查号等身份字段，会自动作为当前文件的脱敏词使用；`--sensitive-term` 和 `--sensitive-terms-file` 用来补充那些没有字段标签、但仍可能出现在正文里的敏感词。

## 脱敏

默认开启：

```bash
--deidentify basic
```

可以关闭，仅做整理：

```bash
--deidentify off
```

可以指定需要精确替换的姓名或编号：

```bash
--sensitive-term 张三 \
--sensitive-term 370000199001011234
```

也可以用文件批量提供：

```bash
--sensitive-terms-file sensitive_terms.txt
```

每行一个词，空行和 `#` 开头行会忽略。

图片/视频默认遮盖区域是：

- 顶部：`0,0,1,0.16`
- 底部：`0,0.88,1,1`

可用 `--redact-region x1,y1,x2,y2` 自定义，坐标是 0-1 归一化比例，可重复多次：

```bash
--redact-region 0,0,1,0.14 \
--redact-region 0,0.9,1,1 \
--redact-region 0.78,0,1,0.22
```

脱敏能力边界：

- JPG/PNG：需要 `Pillow`，输出遮盖后的图片副本。
- MP4/MOV/AVI/MKV 等视频：需要系统安装 `ffmpeg`，输出遮盖后的视频副本并移除音频和 metadata。
- TXT/MD/HTML/RTF/JSON 报告：直接输出正则替换后的文本。
- DOCX：会处理 `word/` 与 `docProps/` 下的 XML 文本。
- PDF：当前不做可靠内容重写，避免伪脱敏；会在 `warnings.jsonl` 标记失败，不输出未脱敏副本。
- DICOM：安装 `pydicom` 后可移除/替换常见患者 tag；像素里烧录的姓名仍需另行像素遮盖或导出为图像/视频后再脱敏。
- 其他未知格式：默认不会复制或软链进脱敏数据集，只在 manifest/warnings 中记录，避免把未脱敏原件带入新目录。

如果显式设置 `--deidentify off`，工具只做整理，可能会按 `--copy-mode` 复制或软链原始文件；这个模式只适合院内本机盘点，不适合训练集归档或共享。

## 输出结构

```text
<output-dir>/
  README.md
  metadata/
    dataset.json
    file_manifest.csv
    cases.jsonl
    images.jsonl
    annotations.jsonl
    reports.jsonl
    videos.jsonl
    clinical_labels.jsonl
    report_pair_manifest.jsonl
    tirads_manifest.jsonl
    classification_manifest.jsonl
    detection_manifest.jsonl
    warnings.jsonl
  cases/
    <case_id>/
      case.json
      images/
      annotations/labelme/
      reports/
      videos/
      dicom/static/
      dicom/video/
      dicom/structured-report/
```

最重要的是：

- `metadata/file_manifest.csv`：全部文件清单。
- `cases/<case_id>/case.json`：病例维度汇总。
- `metadata/detection_manifest.jsonl`：带 LabelMe bbox 的图片，可直接作为检测训练清单的输入。
- `metadata/report_pair_manifest.jsonl`：图像/视频和报告配对清单，可用于报告生成、报告检索、图文配对评测。
- `metadata/tirads_manifest.jsonl`：报告中抽取到的 TI-RADS 标签，需医生复核后用于 TI-RADS 特征/分类训练。
- `metadata/classification_manifest.jsonl`：报告、病理或随访中抽取到的良恶性标签，需医生复核后用于良恶性分类训练。
- `metadata/warnings.jsonl`：需要人工复核的问题，例如标注没有匹配图片、DICOM 缺 PixelSpacing。

## 病例分组

默认 `--case-mode auto`：

- 如果文件在子目录里，用第一层目录名作为病例 ID。
- 如果所有文件平铺在一个目录里，统一归为一个病例。

也可以指定：

```bash
--case-mode flat
--case-mode first-folder
--case-mode parent-folder
```

如果你的文件名里有病例号，可以用正则：

```bash
--case-regex '(?P<case>CASE-[0-9]+)'
```

## 病例关联

工具会先从报告文本、DOCX、DICOM tag 和路径中提取候选字段：

- 患者层：姓名、病历号/门诊号/住院号、性别、出生年份。
- 检查层：检查号、登记号、检查日期、DICOM StudyInstanceUID。
- 标签层：报告里的 TI-RADS、结节大小、良恶性/病理关键词、随访信息。

这些原始字段只用于内存中的关联判断，不会原样写入输出数据集。输出字段含义：

- `patient_key`：同一患者的哈希键。
- `study_key` / `case_id`：同一次检查或同一次就诊资料的哈希键。
- `linkage_confidence`：关联可信度，强患者 ID + 强检查号最高。
- `linkage_evidence`：只记录使用了哪些字段类型，例如 `identity:patient_id`，不记录字段原值。

如果缺少姓名/病历号等身份字段，工具会退回目录分组，并在 `warnings.jsonl` 写入 `identity_linkage_missing_patient_fields`。

## 注意

这个工具提供基础脱敏，不等于合规终审脱敏。请人工抽查 `metadata/warnings.jsonl`、输出图片/视频边角叠字、报告内容和 DICOM 样本后再用于训练或共享。
