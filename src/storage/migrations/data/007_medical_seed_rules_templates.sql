-- Seed medical rules and templates for the validation build.
-- These rows are versioned, deterministic, and safe to run once through the migration system.

INSERT OR IGNORE INTO medical_documents(
  id, title, source_type, source_name, version, language, effective_date,
  file_uri, review_status, approved_by, approved_at, metadata_json, created_at, updated_at
) VALUES
(
  'doc-acr-tirads-2017',
  'ACR Thyroid Imaging Reporting and Data System 2017',
  'guideline',
  'American College of Radiology',
  '2017',
  'en',
  '2017-05-01',
  'https://www.acr.org/Clinical-Resources/Clinical-Tools-and-Reference/Reporting-and-Data-Systems/TI-RADS',
  'approved',
  'system_seed',
  1778241600000,
  '{"evidence_type":"guideline","body_part":"thyroid","modality":"ultrasound"}',
  1778241600000,
  1778241600000
),
(
  'doc-local-report-templates-v1',
  'Thyroid Ultrasound AI Report Templates',
  'local_template',
  'jiazhuangxian',
  'v1',
  'zh-CN',
  '2026-05-08',
  'artifact://knowledge/templates/thyroid-report-templates-v1.md',
  'approved',
  'system_seed',
  1778241600000,
  '{"evidence_type":"template","body_part":"thyroid","modality":"ultrasound"}',
  1778241600000,
  1778241600000
),
(
  'doc-local-safety-rules-v1',
  'Medical AI Safety Rules',
  'local_policy',
  'jiazhuangxian',
  'v1',
  'zh-CN',
  '2026-05-08',
  'artifact://knowledge/safety/medical-safety-rules-v1.md',
  'approved',
  'system_seed',
  1778241600000,
  '{"evidence_type":"safety_policy","scope":"validation"}',
  1778241600000,
  1778241600000
);

INSERT OR IGNORE INTO tirads_rules(
  id, system_name, system_version, rule_code, feature_group, feature_name,
  points, category, min_score, max_score, recommendation, rule_json,
  evidence_document_id, status, created_at, updated_at
) VALUES
('tirads-acr-2017-composition-cystic', 'ACR_TI_RADS', '2017', 'ACR_2017_composition_cystic', 'composition', 'cystic', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Cystic or almost completely cystic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-composition-almost-completely-cystic', 'ACR_TI_RADS', '2017', 'ACR_2017_composition_almost_completely_cystic', 'composition', 'almost_completely_cystic', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Almost completely cystic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-composition-spongiform', 'ACR_TI_RADS', '2017', 'ACR_2017_composition_spongiform', 'composition', 'spongiform', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Spongiform"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-composition-mixed-cystic-solid', 'ACR_TI_RADS', '2017', 'ACR_2017_composition_mixed_cystic_solid', 'composition', 'mixed_cystic_solid', 1, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Mixed cystic and solid"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-composition-solid', 'ACR_TI_RADS', '2017', 'ACR_2017_composition_solid', 'composition', 'solid', 2, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Solid"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-composition-almost-completely-solid', 'ACR_TI_RADS', '2017', 'ACR_2017_composition_almost_completely_solid', 'composition', 'almost_completely_solid', 2, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Almost completely solid"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),

('tirads-acr-2017-echogenicity-anechoic', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenicity_anechoic', 'echogenicity', 'anechoic', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Anechoic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-echogenicity-hyperechoic', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenicity_hyperechoic', 'echogenicity', 'hyperechoic', 1, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Hyperechoic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-echogenicity-isoechoic', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenicity_isoechoic', 'echogenicity', 'isoechoic', 1, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Isoechoic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-echogenicity-hypoechoic', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenicity_hypoechoic', 'echogenicity', 'hypoechoic', 2, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Hypoechoic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-echogenicity-very-hypoechoic', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenicity_very_hypoechoic', 'echogenicity', 'very_hypoechoic', 3, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Very hypoechoic"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),

('tirads-acr-2017-shape-wider-than-tall', 'ACR_TI_RADS', '2017', 'ACR_2017_shape_wider_than_tall', 'shape', 'wider_than_tall', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Wider-than-tall"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-shape-taller-than-wide', 'ACR_TI_RADS', '2017', 'ACR_2017_shape_taller_than_wide', 'shape', 'taller_than_wide', 3, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Taller-than-wide"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),

('tirads-acr-2017-margin-smooth', 'ACR_TI_RADS', '2017', 'ACR_2017_margin_smooth', 'margin', 'smooth', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Smooth"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-margin-ill-defined', 'ACR_TI_RADS', '2017', 'ACR_2017_margin_ill_defined', 'margin', 'ill_defined', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Ill-defined"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-margin-lobulated', 'ACR_TI_RADS', '2017', 'ACR_2017_margin_lobulated', 'margin', 'lobulated', 2, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Lobulated"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-margin-irregular', 'ACR_TI_RADS', '2017', 'ACR_2017_margin_irregular', 'margin', 'irregular', 2, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Irregular"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-margin-extrathyroidal-extension', 'ACR_TI_RADS', '2017', 'ACR_2017_margin_extrathyroidal_extension', 'margin', 'extrathyroidal_extension', 3, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Extrathyroidal extension"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),

('tirads-acr-2017-foci-none', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenic_foci_none', 'echogenic_foci', 'none', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"None"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-foci-large-comet-tail', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenic_foci_large_comet_tail', 'echogenic_foci', 'large_comet_tail', 0, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Large comet-tail artifact"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-foci-macrocalcifications', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenic_foci_macrocalcifications', 'echogenic_foci', 'macrocalcifications', 1, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Macrocalcifications"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-foci-peripheral-rim-calcifications', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenic_foci_peripheral_rim_calcifications', 'echogenic_foci', 'peripheral_rim_calcifications', 2, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Peripheral rim calcifications"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-foci-punctate-echogenic-foci', 'ACR_TI_RADS', '2017', 'ACR_2017_echogenic_foci_punctate_echogenic_foci', 'echogenic_foci', 'punctate_echogenic_foci', 3, NULL, NULL, NULL, NULL, '{"kind":"feature_score","display":"Punctate echogenic foci"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),

('tirads-acr-2017-category-tr1', 'ACR_TI_RADS', '2017', 'ACR_2017_category_TR1', 'category', NULL, NULL, 'TR1', 0, 0, 'Benign. No FNA or routine follow-up.', '{"kind":"category","risk_label":"benign"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-category-tr2', 'ACR_TI_RADS', '2017', 'ACR_2017_category_TR2', 'category', NULL, NULL, 'TR2', 1, 2, 'Not suspicious. No FNA or routine follow-up.', '{"kind":"category","risk_label":"not_suspicious"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-category-tr3', 'ACR_TI_RADS', '2017', 'ACR_2017_category_TR3', 'category', NULL, NULL, 'TR3', 3, 3, 'Mildly suspicious.', '{"kind":"category","risk_label":"mildly_suspicious"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-category-tr4', 'ACR_TI_RADS', '2017', 'ACR_2017_category_TR4', 'category', NULL, NULL, 'TR4', 4, 6, 'Moderately suspicious.', '{"kind":"category","risk_label":"moderately_suspicious"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-category-tr5', 'ACR_TI_RADS', '2017', 'ACR_2017_category_TR5', 'category', NULL, NULL, 'TR5', 7, NULL, 'Highly suspicious.', '{"kind":"category","risk_label":"highly_suspicious"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),

('tirads-acr-2017-recommend-tr1-none', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR1_none', 'recommendation', NULL, NULL, 'TR1', NULL, NULL, 'No FNA or routine follow-up.', '{"kind":"recommendation","recommendation_code":"none"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr2-none', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR2_none', 'recommendation', NULL, NULL, 'TR2', NULL, NULL, 'No FNA or routine follow-up.', '{"kind":"recommendation","recommendation_code":"none"}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr3-followup', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR3_followup', 'recommendation', NULL, NULL, 'TR3', NULL, NULL, 'Ultrasound follow-up when long axis is at least 15 mm.', '{"kind":"recommendation","recommendation_code":"follow_up","min_long_axis_mm":15}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr3-fna', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR3_fna', 'recommendation', NULL, NULL, 'TR3', NULL, NULL, 'Consider FNA when long axis is at least 25 mm.', '{"kind":"recommendation","recommendation_code":"fna","min_long_axis_mm":25}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr4-followup', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR4_followup', 'recommendation', NULL, NULL, 'TR4', NULL, NULL, 'Ultrasound follow-up when long axis is at least 10 mm.', '{"kind":"recommendation","recommendation_code":"follow_up","min_long_axis_mm":10}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr4-fna', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR4_fna', 'recommendation', NULL, NULL, 'TR4', NULL, NULL, 'Consider FNA when long axis is at least 15 mm.', '{"kind":"recommendation","recommendation_code":"fna","min_long_axis_mm":15}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr5-followup', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR5_followup', 'recommendation', NULL, NULL, 'TR5', NULL, NULL, 'Ultrasound follow-up when long axis is at least 5 mm.', '{"kind":"recommendation","recommendation_code":"follow_up","min_long_axis_mm":5}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000),
('tirads-acr-2017-recommend-tr5-fna', 'ACR_TI_RADS', '2017', 'ACR_2017_recommend_TR5_fna', 'recommendation', NULL, NULL, 'TR5', NULL, NULL, 'Consider FNA when long axis is at least 10 mm.', '{"kind":"recommendation","recommendation_code":"fna","min_long_axis_mm":10}', 'doc-acr-tirads-2017', 'active', 1778241600000, 1778241600000);

INSERT OR IGNORE INTO report_templates(
  id, template_name, scene, tirads_category, template_text,
  required_fields_json, forbidden_phrases_json, version, status, created_at, updated_at
) VALUES
(
  'tpl-thyroid-ultrasound-draft-v1',
  '甲状腺超声AI辅助报告草稿',
  'thyroid_ultrasound_report',
  NULL,
  '甲状腺超声AI辅助报告（草稿）

检查所见：
{thyroid_description}

结节描述：
{nodule_descriptions}

AI辅助分级：
{tirads_summary}

建议：
{recommendation}

证据：
{evidence_summary}

提示：本报告为AI辅助草稿，需医生审核确认后生效。',
  '["thyroid_description","nodule_descriptions","tirads_summary","recommendation","evidence_summary"]',
  '["确诊","排除恶性","保证","无需医生确认"]',
  'v1',
  'active',
  1778241600000,
  1778241600000
),
(
  'tpl-thyroid-tirads-explanation-v1',
  'TI-RADS分级解释模板',
  'tirads_explanation',
  NULL,
  '该结节ACR TI-RADS评分为{score}分，分级为{category}。评分依据包括：{feature_evidence}。处理建议依据规则版本{rule_version}生成，最终结论需由医生结合临床信息确认。',
  '["score","category","feature_evidence","rule_version"]',
  '["确诊","一定","保证"]',
  'v1',
  'active',
  1778241600000,
  1778241600000
),
(
  'tpl-thyroid-doctor-review-summary-v1',
  '医生审核摘要模板',
  'doctor_review_summary',
  NULL,
  '医生审核意见：{doctor_comment}

AI草稿修改摘要：{revision_summary}

最终报告状态：{report_status}',
  '["doctor_comment","revision_summary","report_status"]',
  '["AI最终诊断","自动确诊"]',
  'v1',
  'active',
  1778241600000,
  1778241600000
);

INSERT OR IGNORE INTO safety_rules(
  id, rule_code, rule_type, severity, pattern, rule_json,
  message, status, created_at, updated_at
) VALUES
(
  'safety-no-final-diagnosis-without-doctor',
  'NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR',
  'report_generation',
  'critical',
  '(确诊|诊断为|排除恶性|保证)',
  '{"block_final_report":true,"requires_doctor_confirmation":true}',
  'AI只能生成辅助草稿，不得在医生确认前输出最终诊断表达。',
  'active',
  1778241600000,
  1778241600000
),
(
  'safety-no-unsupported-fna-recommendation',
  'NO_UNSUPPORTED_FNA_RECOMMENDATION',
  'evidence',
  'high',
  NULL,
  '{"required_evidence_sources":["tirads_rules"],"applies_to":["fna","follow_up"]}',
  'FNA或随访建议必须能追溯到TI-RADS规则或已审核指南证据。',
  'active',
  1778241600000,
  1778241600000
),
(
  'safety-block-low-confidence-automation',
  'BLOCK_LOW_CONFIDENCE_AUTOMATION',
  'confidence',
  'high',
  NULL,
  '{"min_image_quality_score":0.55,"min_detection_confidence":0.5,"action":"require_manual_review"}',
  '低质量图像或低置信度模型结果必须进入医生复核，不得自动生成建议。',
  'active',
  1778241600000,
  1778241600000
),
(
  'safety-require-calibration-for-mm',
  'REQUIRE_MANUAL_CALIBRATION_FOR_MM',
  'measurement',
  'high',
  NULL,
  '{"requires_pixel_spacing":true,"blocked_outputs":["long_axis_mm","short_axis_mm","area_mm2"]}',
  '缺少pixel spacing或标定信息时不得输出毫米级测量结论。',
  'active',
  1778241600000,
  1778241600000
),
(
  'safety-phi-not-allowed-in-model-log',
  'PHI_NOT_ALLOWED_IN_MODEL_LOG',
  'privacy',
  'critical',
  '(姓名|身份证|手机号|住院号|门诊号)',
  '{"redact_before_model_log":true,"redact_before_prompt":true}',
  '患者身份信息不得进入模型提示、模型日志或普通调试日志。',
  'active',
  1778241600000,
  1778241600000
);
