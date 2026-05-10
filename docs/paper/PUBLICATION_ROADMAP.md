# 甲状腺超声 AI 智能体论文发表路线图

更新时间：2026-05-10

## 1. 推荐论文题目

建议使用英文题目作为投稿主标题：

> Guideline-constrained multimodal thyroid ultrasound AI agent with expert vision models for nodule detection, TI-RADS stratification, and report quality control: development and multicentre validation

中文工作题目：

> 基于指南约束的多模态甲状腺超声 AI 智能体与专家视觉模型协同用于结节检测、TI-RADS 分级和报告质控的多中心验证研究

题目策略：

- 保留 `guideline-constrained`，突出 TI-RADS 规则硬约束，避免被审稿人认为是大模型自由生成诊断。
- 保留 `expert vision models`，对应当前 RF-DETR-Medium + YOLO11m 检测证据，也为后续分割、特征识别模型留接口。
- 保留 `report quality control`，区别于普通甲状腺结节分类论文。
- 在完成多中心数据前，副标题不应写 `clinical validation`；完成外部验证和 reader study 后再使用。

## 2. 目标期刊匹配度

| 期刊 | 最合适投稿版本 | 当前差距 | 建议优先级 |
|---|---|---|---|
| Information Fusion | 强调多模态融合、多模型冲突仲裁、证据融合算法 | 需要补充融合算法创新、消融实验和多源外部验证 | P2 |
| Medical Image Analysis | 强调检测、分割、特征识别、模型泛化和严谨算法评估 | 需要补充分割/TI-RADS 特征识别、外部公开/院内测试集 | P1 |
| Radiology: Artificial Intelligence | 强调医学影像 AI 系统、外部验证、reader study | 需要 reader study、病理/FNA/随访金标准、医生对照 | P0 |
| Radiology | 强调影像临床价值和放射科工作流改善 | 需要更强临床验证、reader study 和真实报告效率改善 | P1 |
| The Lancet Digital Health | 强调患者管理、临床结局、真实世界影响 | 需要前瞻性或强真实世界部署，不宜作为第一投稿目标 | P3 |
| npj Digital Medicine | 强调数字医学系统、AI 工作流、可复现临床验证 | 需要多中心外部验证、reader study、统计严谨和代码/数据说明 | P0 |

当前最现实路线：

1. 第一阶段冲 `Radiology: Artificial Intelligence` 或 `npj Digital Medicine`。
2. 如果后续算法创新更强、外部公开数据充分，可转 `Medical Image Analysis`。
3. 若多模态融合/仲裁机制成为核心方法学贡献，可冲 `Information Fusion`。
4. `The Lancet Digital Health` 需要真实世界管理结局或前瞻性验证，作为长期目标。

## 3. 当前已有证据

| 证据模块 | 当前材料 | 可用于论文的表述 |
|---|---|---|
| 平台系统 | `docs/TECHNICAL_DESIGN.md`，`README.md`，医疗 Web/API、model-gateway、image-worker、medical-agent-worker | 已实现面向甲状腺超声的本地验证版 AI 智能体平台骨架 |
| 数据集清洗 | `docs/PUBLIC_THYROID_ULTRASOUND_DATASETS.md`，TN5000 清洗脚本和 summary | 对公开 TN5000 detection archive 做严格去重、异常剔除和固定切分 |
| 检测模型 | `docs/TN5000_YOLO11M_TRAINING_REPORT_20260510.md`，`docs/TN5000_DETECTOR_MODEL_COMPARISON_20260510.md` | RF-DETR-Medium 和 YOLO11m 在同一清洗验证集上达到较高结节检测性能 |
| 双模型策略 | `docs/TN5000_DETECTOR_MODEL_COMPARISON_20260510.md` | 主检测模型 RF-DETR-Medium + 对照模型 YOLO11m，用于冲突提示和医生复核 |
| 规则引擎 | `packages/medical-mcp/src/tirads.ts`，seed rules | ACR TI-RADS 2017 规则以确定性规则引擎实现 |
| 报告与审核 | `src/medical/agentWorker.ts`，`src/medical/storage/caseRepo.ts`，MedicalPanel | 已有报告草稿、安全审核、医生确认/驳回和审计链路 |
| 医学知识库 | `examples/medical-knowledge/thyroid-guidelines-v1.manifest.json` | 已建立 ACR/ATA/EU-TIRADS/C-TIRADS 参考边界和 RAG 证据入口 |

当前不能声称：

- 不能声称已经完成 TI-RADS 自动分级临床验证。
- 不能声称已经完成良恶性诊断模型验证。
- 不能声称系统能提高医生 AUC、Kappa 或报告效率。
- 不能用 TN5000 内部验证结果替代多中心临床外部验证。

## 4. 建议论文主线

核心论点：

> 单一视觉模型和通用多模态大模型均难以覆盖甲状腺超声真实诊断流程。本研究提出一个指南约束的多模态甲状腺超声 AI 智能体：由专家视觉模型生成可验证图像证据，由 TI-RADS 规则引擎完成确定性分级，由大模型整合证据并生成可审核报告，由报告质控与医生复核闭环降低幻觉和自动化偏倚。

论文贡献建议写成四点：

1. 构建甲状腺超声 AI 智能体平台，将结节检测、TI-RADS 规则、RAG 证据、报告草稿、安全审核和医生复核纳入统一可审计工作流。
2. 提出双专家检测模型协同机制，使用 RF-DETR-Medium 作为主检测模型、YOLO11m 作为对照模型，通过 IoU 匹配和冲突仲裁生成医生复核优先级。
3. 建立严格公开数据清洗与检测验证流程，剔除异常标注、合并重复图像并固定患者/图像级可追溯切分。
4. 设计面向期刊验证的多中心临床评估方案，覆盖 TI-RADS 分级、良恶性风险、报告质控、reader study 和消融实验。

## 5. 推荐 Manuscript 结构

```text
Abstract
Introduction
Results
  Dataset curation and system overview
  Development and validation of expert nodule detectors
  Dual-detector agreement and conflict arbitration
  Guideline-constrained TI-RADS reasoning workflow
  Report quality-control workflow
  External validation and reader study [待补]
  Ablation and failure analysis [待补]
Discussion
Methods
  Study design
  Public dataset curation
  Clinical dataset and reference standards [待补]
  Expert vision model development
  Dual-model detection arbitration
  TI-RADS rule engine
  Multimodal AI agent and RAG evidence grounding
  Report quality-control module
  Reader study [待补]
  Statistical analysis
Data availability
Code availability
Acknowledgements
References
```

## 6. 长期补充清单

### P0：投稿门槛补齐

- 获取至少一个院内或合作医院甲状腺超声数据集。
- 建立患者级数据表、图像表、结节表、报告表和病理/FNA/随访金标准。
- 完成结节级人工标注：bbox、mask、TI-RADS 五大特征、TR 等级。
- 完成报告质控标注：漏项、矛盾、指南不符合、幻觉/无证据描述。
- 完成外部测试集：至少一个未参与训练的中心或数据源。
- 完成 reader study：低/中/高年资医生，无 AI vs 有 AI。
- 完成统计分析：AUC、敏感度、特异度、Kappa、DeLong、McNemar、bootstrap 95% CI。

### P1：模型与系统补齐

- 将 RF-DETR-Medium 完整训练到预设 early-stop 或补充完整训练曲线。
- 将 RF-DETR-Medium 和 YOLO11m 接入统一 model-gateway 推理接口。
- 实现双模型 bbox 对比器：IoU、中心距、面积差、匹配状态、冲突类型。
- 训练或接入分割模型：MedSAM/MedSAM2、nnU-Net 或 Swin U-Net。
- 训练 TI-RADS 特征识别模型：composition、echogenicity、shape、margin、echogenic foci。
- 训练良恶性风险模型，并与 TI-RADS 规则输出分离评估。
- 建立阈值校准：高敏感度策略、低置信度转人工复核策略。

### P2：高水平期刊增强

- 增加 ThyroidXL、ThyUS2Path、Stanford thyroid cine-clip 等公开外部数据。
- 做跨设备、跨中心、不同结节大小、不同 TI-RADS 等级的亚组分析。
- 增加 calibration curve、Brier score、decision curve analysis。
- 增加失败案例图：漏检、定位偏移、低质量图像、报告矛盾、模型冲突。
- 公开去标识化实验配置、标注 schema、统计代码和模型推理配置。

### P3：Lancet Digital Health 级别长期目标

- 前瞻性真实世界部署。
- 评估不必要 FNA 减少、漏诊率不增加、随访建议一致性和报告 turnaround time。
- 纳入患者管理终点，而不只是模型性能指标。
- 完成伦理审批、临床试验注册或真实世界部署方案。

