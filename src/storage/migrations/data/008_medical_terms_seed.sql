-- Seed a small terminology dictionary for validation-time medical.NormalizeTerm.

INSERT OR IGNORE INTO medical_terms(
  id, canonical_name, synonyms_json, category, description, standard_code,
  forbidden, created_at, updated_at
) VALUES
(
  'term-thyroid-nodule',
  'thyroid_nodule',
  '["甲状腺结节","结节","thyroid nodule","nodule"]',
  'anatomy_finding',
  '甲状腺结节',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-solid',
  'solid',
  '["实性","实质性","solid"]',
  'tirads_feature',
  'ACR TI-RADS composition feature: solid or almost completely solid',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-cystic',
  'cystic',
  '["囊性","囊性或几乎完全囊性","cystic","almost completely cystic"]',
  'tirads_feature',
  'ACR TI-RADS composition feature: cystic or almost completely cystic',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-hypoechoic',
  'hypoechoic',
  '["低回声","hypoechoic"]',
  'tirads_feature',
  'ACR TI-RADS echogenicity feature: hypoechoic',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-very-hypoechoic',
  'very_hypoechoic',
  '["极低回声","显著低回声","very hypoechoic","very_hypoechoic"]',
  'tirads_feature',
  'ACR TI-RADS echogenicity feature: very hypoechoic',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-taller-than-wide',
  'taller_than_wide',
  '["纵横比大于1","纵横比>1","高大于宽","taller than wide","taller_than_wide"]',
  'tirads_feature',
  'ACR TI-RADS shape feature: taller-than-wide',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-irregular-margin',
  'irregular',
  '["边缘不规则","不规则边缘","irregular margin","irregular"]',
  'tirads_feature',
  'ACR TI-RADS margin feature: irregular',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-punctate-echogenic-foci',
  'punctate_echogenic_foci',
  '["点状强回声","微钙化","点状钙化","punctate echogenic foci","microcalcifications"]',
  'tirads_feature',
  'ACR TI-RADS echogenic foci feature: punctate echogenic foci',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-fna',
  'fna',
  '["细针穿刺","细针穿刺活检","FNA","fine needle aspiration"]',
  'recommendation',
  'Fine needle aspiration recommendation',
  NULL,
  0,
  1778241600000,
  1778241600000
),
(
  'term-follow-up',
  'follow_up',
  '["随访","超声随访","follow-up","follow up","ultrasound follow-up"]',
  'recommendation',
  'Ultrasound follow-up recommendation',
  NULL,
  0,
  1778241600000,
  1778241600000
);
