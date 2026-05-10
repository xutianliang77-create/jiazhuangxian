# Manuscript Scaffold

工作题目：

**Guideline-constrained multimodal thyroid ultrasound AI agent with expert vision models for nodule detection, TI-RADS stratification, and report quality control: development and multicentre validation**

## Abstract

Thyroid ultrasound diagnosis requires consistent nodule localization, TI-RADS feature characterization, risk stratification, and structured reporting. Existing thyroid AI models commonly focus on isolated classification tasks, while general-purpose multimodal models may hallucinate unsupported ultrasound descriptors. We developed a guideline-constrained thyroid ultrasound AI agent that combines expert vision models, deterministic TI-RADS reasoning, retrieval-grounded report generation, report quality control, and physician review. In the current development phase, we curated a cleaned TN5000 detection dataset and trained expert nodule detectors, with RF-DETR-Medium achieving mAP50 `[0.971]` and YOLO11m achieving mAP50 `[0.959]` on the same fixed validation split. Multicentre clinical validation, TI-RADS feature annotation, report quality-control annotation, and reader study remain required before clinical claims can be made. This study is designed to test whether a guideline-constrained agentic workflow improves TI-RADS consistency, report quality, and physician performance compared with single-model and unguided multimodal baselines.

> 投稿前注意：如果未完成多中心外部验证，摘要不能保留 “improves” 等结果性措辞，只能写 “is designed to test” 或作为 methods/development paper 表述。

## Introduction

甲状腺超声诊断不仅是图像分类问题，还包括结节定位、特征描述、TI-RADS 分级、随访或 FNA 建议、报告书写和医生审核。现有视觉模型能在部分数据集上取得较高诊断性能，但缺少临床报告工作流和可解释证据链。通用多模态大模型可处理图像和文本，但在超声细节识别、医学指南遵循和幻觉控制方面仍存在风险。

本研究提出一个基于指南约束的多模态甲状腺超声 AI 智能体。系统将图像证据、指南规则、RAG 证据和医生审核分离：专家视觉模型负责检测和特征识别；TI-RADS 规则引擎负责确定性分级；大模型负责证据整合、解释和报告草稿；报告质控模块负责漏项、矛盾和不符合指南的提示；医生最终确认或修订所有输出。

## Results

### Public dataset curation

TN5000 detection archive was curated with strict quality control. Two samples with XML/image size mismatch and one sample with an out-of-bound bounding box were excluded. Exact duplicate image hashes were merged while preserving multiple valid bounding boxes. The cleaned dataset contained 4,871 unique images and 4,997 bounding boxes. A fixed 80/20 split with seed 20260510 yielded 3,897 training images with 3,999 boxes and 974 validation images with 998 boxes.

### Expert detector development

Three detector families were evaluated on the same cleaned TN5000 split. RF-DETR-Medium achieved mAP50 0.97141, mAP50-95 0.64611, precision 0.93922, and recall 0.95992. YOLO11m achieved mAP50 0.95886, mAP50-95 0.62583, precision 0.95133, and recall 0.92385. RT-DETR-L achieved mAP50 0.91289 in best-checkpoint validation but showed training instability and was not selected for default deployment.

### Dual-detector arbitration

RF-DETR-Medium is selected as the primary detector because it had the highest recall and mAP50. YOLO11m is retained as a stable real-time comparator. Detection outputs are intended to be matched by IoU, center distance, area difference, and confidence. Matched detections are marked as model-consistent. RF-DETR-only, YOLO-only, or localization-conflict detections are surfaced for physician review rather than automatically accepted.

### Guideline-constrained TI-RADS workflow

The platform implements ACR TI-RADS 2017 rule calculation as a deterministic engine. The planned TI-RADS workflow will not allow the language model to directly assign a category. Instead, visual feature outputs will be mapped to structured descriptors and then scored by the rule engine. The language model may explain the rule evidence but must not override the deterministic score without physician review.

### Report quality-control workflow

The report workflow includes draft generation, safety review, physician confirmation or rejection, and audit logging. The planned report quality-control evaluation will measure completeness errors, descriptor-conclusion inconsistencies, guideline-inconsistent management recommendations, unsupported statements, and physician modification rate.

### Multicentre external validation [pending]

This section requires clinical data. It should report patient characteristics, centre distribution, device distribution, nodule size distribution, TI-RADS distribution, pathology/FNA/follow-up reference standards, and external validation performance.

### Reader study [pending]

This section requires a multi-reader multi-case study comparing physicians without AI and with AI assistance. It should report AUC, sensitivity, specificity, weighted kappa, reading time, confidence, and report error rate by physician seniority.

## Discussion

当前结果支持两个有限结论：第一，公开 TN5000 数据上已经完成严格检测数据清洗和高性能结节检测模型训练；第二，工程系统已经具备将检测结果、TI-RADS 规则、RAG 证据、报告草稿、安全审核和医生复核串联起来的验证版工作流。当前结果尚不能支持 TI-RADS 分级、良恶性诊断或临床效率改善的结论。

与单一视觉模型相比，本系统的潜在优势在于工作流完整性和可审核性。与通用多模态模型相比，本系统使用专家视觉模型和确定性 TI-RADS 规则降低大模型幻觉。与商业化工作流系统相比，本研究的目标是提供可复现的数据清洗、模型训练、外部验证和统计分析证据。

## Methods

### Study design

Development and validation study of a thyroid ultrasound AI agent. Current public-data development uses cleaned TN5000. Future clinical validation should use multicentre retrospective datasets with patient-level splits and at least one external test centre.

### Dataset curation

Describe TN5000 raw archive, quality checks, duplicate merging, invalid annotation exclusion, fixed split, and label policy. Detection labels are collapsed to single-class `thyroid_nodule`; benign/malignant metadata are used only for stratification and are not used as detection classes.

### Expert vision models

Describe YOLO11m, RT-DETR-L, and RF-DETR-Medium training settings. Report image size, batch size, epochs, early stopping, augmentation policy, hardware, software versions, and model selection criteria.

### AI agent workflow

Describe image QC, detection, feature classification placeholder/future model, TI-RADS rule calculation, report drafting, safety review, physician review, audit logging, and artifact provenance.

### Statistical analysis

Detection metrics use mAP50, mAP50-95, precision, recall, and F1. Future clinical validation should use AUC, DeLong test, McNemar test, weighted kappa, bootstrap 95% CI, calibration curve, Brier score, and decision curve analysis.

## Data availability

Public-data processing manifests, summaries, and derived annotations are stored locally under `data/artifacts/datasets`. Raw public datasets are not committed to Git. Clinical data are not yet available in this repository.

## Code availability

Training and evaluation scripts are available in `scripts/`. The platform implementation is under `src/`, `services/`, `packages/`, and `web-react/`.

