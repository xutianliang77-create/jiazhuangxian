# 论文证据登记表

更新时间：2026-05-10

## 1. 可直接引用的当前工程证据

| 编号 | 证据 | 文件/路径 | 关键数值或事实 | 论文用途 |
|---|---|---|---|---|
| E01 | 项目定位 | `README.md` | 甲状腺超声 AI 智能体验证版，含 image-worker、model-gateway、RAG、报告模型、医生工作台 | Introduction / Methods |
| E02 | 系统架构 | `docs/TECHNICAL_DESIGN.md` | 医学事实来自知识库，图像特征来自专用模型，分级来自规则引擎，报告由大模型辅助，最终医生确认 | System overview |
| E03 | TN5000 清洗 | `docs/TN5000_YOLO11M_TRAINING_REPORT_20260510.md` | 4,871 unique images，4,997 boxes；剔除 2 个尺寸不一致和 1 个越界样本；119 个重复图像组合并 | Dataset curation |
| E04 | TN5000 切分 | `docs/TN5000_YOLO11M_TRAINING_REPORT_20260510.md` | train 3,897 images / 3,999 boxes；val 974 images / 998 boxes；seed 20260510 | Methods |
| E05 | YOLO11m 检测 | `data/artifacts/model-training/tn5000-yolo/summaries/*.json` | mAP50 0.95886，precision 0.95133，recall 0.92385，mAP50-95 0.62583 | Expert detector baseline |
| E06 | RF-DETR 检测 | `data/artifacts/model-training/tn5000-rfdetr/summaries/*.json` | mAP50 0.97141，precision 0.93922，recall 0.95992，mAP50-95 0.64611，EMA mAP50 0.97515 | Primary detector |
| E07 | RT-DETR 对照 | `data/artifacts/model-training/tn5000-rtdetr/summaries/tn5000-clean-rtdetr-l-best-val.json` | mAP50 0.91289，precision 0.89959，recall 0.86473 | Research comparator |
| E08 | 模型决策 | `docs/TN5000_DETECTOR_MODEL_COMPARISON_20260510.md` | RF-DETR-Medium 主模型，YOLO11m 对照模型，RT-DETR-L 暂缓主用 | Dual-detector strategy |
| E09 | 数据集状态 | `docs/PUBLIC_THYROID_ULTRASOUND_DATASETS.md` | TN3K 已下载；TN5000 已用于检测；ThyroidXL/ThyUS2Path/Stanford cine-clip 待获取 | Limitations / Future work |
| E10 | TI-RADS 规则 | `packages/medical-mcp/src/tirads.ts`，seed rules | ACR TI-RADS 2017 规则计算与 evidence rule codes | Guideline constraint |
| E11 | 工作流实现 | `src/medical/agentWorker.ts` | image QC、detect_nodules、classify_tirads_features、calculate_tirads、draft_report、safety_review 任务链 | Agent workflow |
| E12 | 医生审核 | `src/medical/storage/caseRepo.ts`，`web-react/src/components/panels/MedicalPanel.tsx` | 报告确认/驳回、bbox 修订、overlay 拖拽、审计日志 | Human-in-the-loop |

## 2. 当前证据边界

| 研究问题 | 当前状态 | 是否可在主文声称 |
|---|---|---|
| 结节检测是否有效 | 有 TN5000 清洗验证集检测指标 | 可以声称公开数据集检测验证 |
| TI-RADS 分级是否准确 | 规则引擎已实现，但缺结节特征模型和临床标注验证 | 不可声称 |
| 良恶性风险是否准确 | 检测训练折叠了良恶性标签为单类，只用于 stratify | 不可声称 |
| 报告质控是否有效 | 系统有安全审核/报告工作流，但缺专家质控标签和评价 | 不可声称 |
| AI 是否提升医生表现 | 缺 reader study | 不可声称 |
| 系统是否多中心临床有效 | 缺院内/多中心外部验证 | 不可声称 |

## 3. 论文图表建议

| 图/表 | 内容 | 依赖 |
|---|---|---|
| Figure 1 | 系统架构：专家模型、规则引擎、垂直大模型、报告质控、医生审核 | 当前可画 |
| Figure 2 | TN5000 数据清洗与纳排流程 | 当前可画 |
| Figure 3 | 三类检测模型性能对比 | 当前已有图 |
| Figure 4 | 双检测模型冲突仲裁流程 | 当前可画，后续需真实案例 |
| Figure 5 | Reader study 设计和结果 | 待补 |
| Table 1 | 数据集特征 | 当前可列公开数据，临床数据待补 |
| Table 2 | 检测模型性能 | 当前可列 |
| Table 3 | TI-RADS 分级和良恶性性能 | 待补 |
| Table 4 | 报告质控性能 | 待补 |
| Table 5 | 消融实验 | 待补 |

