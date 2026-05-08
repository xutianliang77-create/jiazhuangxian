---
document:
  id: doc-validation-acr-tirads-markdown-v1
  title: 验证版 ACR TI-RADS Markdown 知识摘要
  source_type: guideline_summary
  source_name: local_validation_markdown
  version: v1
  language: zh-CN
  effective_date: "2026-05-08"
  file_uri: artifact://examples/medical-knowledge/acr-tirads-validation.md
  review_status: approved
  approved_by: validation_owner
  approved_at: 1778241600000
  metadata:
    body_part: thyroid
    modality: ultrasound
    scope: validation_only
chunk_defaults:
  chunk_type: guideline_summary
  topic: tirads
  evidence_level: local_summary
  tirads_system: ACR_TI_RADS
  body_part: thyroid
report_templates:
  - id: tpl-validation-thyroid-markdown-evidence-v1
    template_name: 验证版 Markdown TI-RADS 证据说明模板
    scene: tirads_evidence_summary
    tirads_category: null
    template_text: "结节 {nodule_index}：特征为 {feature_summary}，证据：{evidence_summary}。本内容为辅助草稿，需医生审核。"
    required_fields:
      - nodule_index
      - feature_summary
      - evidence_summary
    forbidden_phrases:
      - 确诊
      - 排除恶性
    version: v1
    status: active
---

# TI-RADS 特征组

ACR TI-RADS 评分应按 composition、echogenicity、shape、margin、echogenic foci 五组特征分别给分，再汇总为 TR1 至 TR5 分级。

AI 报告必须保留每个特征项的来源和置信度。

## 报告安全约束

AI 只能生成辅助草稿，不得写成最终诊断。

涉及 FNA、随访或恶性风险表达时，必须引用 TI-RADS 规则、结节大小和医生审核状态。
