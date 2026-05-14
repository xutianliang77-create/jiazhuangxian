-- Store final validation runs and per-image results for later doctor/model review.

CREATE TABLE IF NOT EXISTS final_validation_run (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  dataset_root TEXT,
  dataset_manifest_uri TEXT,
  case_id TEXT,
  pipeline_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  remote_model_gateway_url TEXT,
  data_db_path TEXT,
  rag_db_path TEXT,
  report_json_uri TEXT,
  report_markdown_uri TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS final_validation_image_result (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES final_validation_run(id) ON DELETE CASCADE,
  study_id TEXT REFERENCES study(id) ON DELETE SET NULL,
  image_id TEXT REFERENCES image(id) ON DELETE SET NULL,
  analysis_session_id TEXT REFERENCES analysis_session(id) ON DELETE SET NULL,
  dataset_image_id TEXT NOT NULL,
  dataset_label TEXT,
  source_relative_path TEXT,
  artifact_uri TEXT NOT NULL,
  local_staged_path TEXT,
  remote_upload_json TEXT NOT NULL DEFAULT '{}',
  expected_json TEXT NOT NULL DEFAULT '{}',
  detection_json TEXT NOT NULL DEFAULT '{}',
  measurement_json TEXT NOT NULL DEFAULT '{}',
  tirads_json TEXT NOT NULL DEFAULT '{}',
  report_json TEXT NOT NULL DEFAULT '{}',
  safety_review_json TEXT NOT NULL DEFAULT '{}',
  model_artifacts_json TEXT NOT NULL DEFAULT '[]',
  task_events_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  status TEXT NOT NULL,
  error_json TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  review_comment TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(run_id, dataset_image_id)
);

CREATE INDEX IF NOT EXISTS idx_final_validation_run_dataset ON final_validation_run(dataset_id, created_at);
CREATE INDEX IF NOT EXISTS idx_final_validation_run_status ON final_validation_run(status, created_at);
CREATE INDEX IF NOT EXISTS idx_final_validation_image_run ON final_validation_image_result(run_id, status);
CREATE INDEX IF NOT EXISTS idx_final_validation_image_label ON final_validation_image_result(dataset_label, status);
CREATE INDEX IF NOT EXISTS idx_final_validation_image_review ON final_validation_image_result(review_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_final_validation_image_study ON final_validation_image_result(study_id);
