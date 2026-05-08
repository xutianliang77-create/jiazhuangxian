-- Medical validation schema for the thyroid ultrasound AI platform.
-- Verification version uses SQLite only and intentionally does not create RBAC tables.

CREATE TABLE IF NOT EXISTS patient (
  id TEXT PRIMARY KEY,
  external_patient_id TEXT UNIQUE,
  name_hash TEXT,
  sex TEXT,
  birth_year INTEGER,
  deidentified INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS study (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patient(id) ON DELETE SET NULL,
  accession_no TEXT UNIQUE,
  study_instance_uid TEXT UNIQUE,
  modality TEXT NOT NULL DEFAULT 'US',
  body_part TEXT NOT NULL DEFAULT 'thyroid',
  study_time INTEGER,
  status TEXT NOT NULL DEFAULT 'created',
  clinical_context TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS image (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES study(id) ON DELETE CASCADE,
  series_instance_uid TEXT,
  sop_instance_uid TEXT,
  file_uri TEXT NOT NULL,
  preview_uri TEXT,
  model_ready_uri TEXT,
  file_type TEXT NOT NULL DEFAULT 'unknown',
  checksum_sha256 TEXT,
  width INTEGER,
  height INTEGER,
  pixel_spacing TEXT,
  dicom_metadata TEXT NOT NULL DEFAULT '{}',
  image_quality TEXT,
  quality_score REAL,
  processing_status TEXT NOT NULL DEFAULT 'uploaded',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(study_id, sop_instance_uid)
);

CREATE TABLE IF NOT EXISTS image_import_job (
  id TEXT PRIMARY KEY,
  study_id TEXT REFERENCES study(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_session (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES study(id) ON DELETE CASCADE,
  team_run_id TEXT,
  status TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_task (
  id TEXT PRIMARY KEY,
  analysis_session_id TEXT NOT NULL REFERENCES analysis_session(id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES agent_task(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_call_log (
  id TEXT PRIMARY KEY,
  agent_task_id TEXT REFERENCES agent_task(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '{}',
  response_json TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  error_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_job (
  id TEXT PRIMARY KEY,
  study_id TEXT REFERENCES study(id) ON DELETE CASCADE,
  image_id TEXT REFERENCES image(id) ON DELETE CASCADE,
  agent_task_id TEXT REFERENCES agent_task(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_json TEXT,
  model_name TEXT,
  model_version TEXT,
  weights_hash TEXT,
  artifact_uri TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS nodule (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES study(id) ON DELETE CASCADE,
  image_id TEXT REFERENCES image(id) ON DELETE SET NULL,
  nodule_index INTEGER NOT NULL,
  location TEXT,
  bbox TEXT,
  mask_uri TEXT,
  detection_confidence REAL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(study_id, nodule_index)
);

CREATE TABLE IF NOT EXISTS measurement (
  id TEXT PRIMARY KEY,
  nodule_id TEXT NOT NULL REFERENCES nodule(id) ON DELETE CASCADE,
  long_axis_mm REAL,
  short_axis_mm REAL,
  ap_axis_mm REAL,
  area_mm2 REAL,
  aspect_ratio REAL,
  measurement_source TEXT NOT NULL,
  confidence REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tirads_feature (
  id TEXT PRIMARY KEY,
  nodule_id TEXT NOT NULL REFERENCES nodule(id) ON DELETE CASCADE,
  system_name TEXT NOT NULL,
  features TEXT NOT NULL DEFAULT '{}',
  confidence TEXT NOT NULL DEFAULT '{}',
  source_model TEXT,
  requires_review INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tirads_result (
  id TEXT PRIMARY KEY,
  nodule_id TEXT NOT NULL REFERENCES nodule(id) ON DELETE CASCADE,
  system_name TEXT NOT NULL,
  system_version TEXT NOT NULL,
  score INTEGER,
  category TEXT,
  recommendation TEXT,
  evidence_rules TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS report (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES study(id) ON DELETE CASCADE,
  analysis_session_id TEXT REFERENCES analysis_session(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL,
  status TEXT NOT NULL,
  template_id TEXT,
  draft_text TEXT,
  final_text TEXT,
  structured_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_by_agent TEXT,
  confirmed_by TEXT,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor_review (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS medical_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  version TEXT NOT NULL,
  language TEXT NOT NULL,
  effective_date TEXT,
  file_uri TEXT,
  review_status TEXT NOT NULL,
  approved_by TEXT,
  approved_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS medical_chunk_metadata (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  rag_chunk_id TEXT NOT NULL UNIQUE,
  section_title TEXT,
  chunk_type TEXT NOT NULL,
  topic TEXT,
  page_no INTEGER,
  source_type TEXT NOT NULL,
  guideline_version TEXT,
  evidence_level TEXT,
  tirads_system TEXT,
  body_part TEXT,
  review_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS medical_terms (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  synonyms_json TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL,
  description TEXT,
  standard_code TEXT,
  forbidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tirads_rules (
  id TEXT PRIMARY KEY,
  system_name TEXT NOT NULL,
  system_version TEXT NOT NULL,
  rule_code TEXT NOT NULL,
  feature_group TEXT,
  feature_name TEXT,
  points INTEGER,
  category TEXT,
  min_score INTEGER,
  max_score INTEGER,
  recommendation TEXT,
  rule_json TEXT NOT NULL DEFAULT '{}',
  evidence_document_id TEXT REFERENCES medical_documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(system_name, system_version, rule_code)
);

CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  scene TEXT NOT NULL,
  tirads_category TEXT,
  template_text TEXT NOT NULL,
  required_fields_json TEXT NOT NULL DEFAULT '[]',
  forbidden_phrases_json TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  rag_chunk_id TEXT NOT NULL,
  document_id TEXT REFERENCES medical_documents(id) ON DELETE SET NULL,
  evidence_role TEXT NOT NULL,
  quote_text TEXT,
  confidence REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS safety_rules (
  id TEXT PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  pattern TEXT,
  rule_json TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_job (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES medical_documents(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS case_knowledge (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES study(id) ON DELETE CASCADE,
  nodule_id TEXT REFERENCES nodule(id) ON DELETE SET NULL,
  doctor_final_result_json TEXT NOT NULL DEFAULT '{}',
  ai_result_json TEXT NOT NULL DEFAULT '{}',
  doctor_revision_json TEXT NOT NULL DEFAULT '{}',
  approved_for_learning INTEGER NOT NULL DEFAULT 0,
  deidentified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  study_id TEXT REFERENCES study(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  trace_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_external_id ON patient(external_patient_id);
CREATE INDEX IF NOT EXISTS idx_study_patient ON study(patient_id);
CREATE INDEX IF NOT EXISTS idx_study_status ON study(status, created_at);
CREATE INDEX IF NOT EXISTS idx_image_study ON image(study_id);
CREATE INDEX IF NOT EXISTS idx_image_processing ON image(processing_status, created_at);
CREATE INDEX IF NOT EXISTS idx_import_job_status ON image_import_job(status, created_at);
CREATE INDEX IF NOT EXISTS idx_analysis_session_study ON analysis_session(study_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_task_session ON agent_task(analysis_session_id, status);
CREATE INDEX IF NOT EXISTS idx_tool_call_task ON tool_call_log(agent_task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_model_job_status ON model_job(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_model_job_study ON model_job(study_id);
CREATE INDEX IF NOT EXISTS idx_nodule_study ON nodule(study_id);
CREATE INDEX IF NOT EXISTS idx_measurement_nodule ON measurement(nodule_id);
CREATE INDEX IF NOT EXISTS idx_tirads_feature_nodule ON tirads_feature(nodule_id, system_name);
CREATE INDEX IF NOT EXISTS idx_tirads_result_nodule ON tirads_result(nodule_id, system_name);
CREATE INDEX IF NOT EXISTS idx_report_study ON report(study_id, status);
CREATE INDEX IF NOT EXISTS idx_doctor_review_report ON doctor_review(report_id, created_at);
CREATE INDEX IF NOT EXISTS idx_medical_documents_source ON medical_documents(source_type, source_name, version);
CREATE INDEX IF NOT EXISTS idx_medical_chunk_document ON medical_chunk_metadata(document_id, chunk_type);
CREATE INDEX IF NOT EXISTS idx_medical_chunk_filter ON medical_chunk_metadata(tirads_system, body_part, review_status);
CREATE INDEX IF NOT EXISTS idx_medical_terms_name ON medical_terms(canonical_name);
CREATE INDEX IF NOT EXISTS idx_tirads_rules_lookup ON tirads_rules(system_name, system_version, rule_code);
CREATE INDEX IF NOT EXISTS idx_report_templates_scene ON report_templates(scene, tirads_category, status);
CREATE INDEX IF NOT EXISTS idx_evidence_links_source ON evidence_links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_safety_rules_status ON safety_rules(rule_type, severity, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_ingestion_status ON knowledge_ingestion_job(status, created_at);
CREATE INDEX IF NOT EXISTS idx_case_knowledge_study ON case_knowledge(study_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_study ON audit_log(study_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_trace ON audit_log(trace_id);
