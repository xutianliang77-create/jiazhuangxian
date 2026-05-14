import type Database from "better-sqlite3";
import { ulid } from "ulid";

import {
  searchMedicalKnowledge,
  type MedicalKnowledgeSearchInput,
  type MedicalKnowledgeSearchOptions,
  type MedicalKnowledgeSearchResult,
} from "../knowledge/search";

type JsonObject = Record<string, unknown>;

export interface PatientInput {
  id?: string;
  externalPatientId?: string;
  nameHash?: string;
  sex?: string;
  birthYear?: number;
  deidentified?: boolean;
  meta?: JsonObject;
  now?: number;
}

export interface PatientRecord {
  id: string;
  externalPatientId: string | null;
  nameHash: string | null;
  sex: string | null;
  birthYear: number | null;
  deidentified: boolean;
  meta: JsonObject;
  createdAt: number;
  updatedAt: number;
}

export interface StudyInput {
  id?: string;
  patientId?: string;
  accessionNo?: string;
  studyInstanceUid?: string;
  modality?: string;
  bodyPart?: string;
  studyTime?: number;
  status?: string;
  clinicalContext?: string;
  sourceType?: string;
  createdBy?: string;
  now?: number;
}

export interface StudyRecord {
  id: string;
  patientId: string | null;
  accessionNo: string | null;
  studyInstanceUid: string | null;
  modality: string;
  bodyPart: string;
  studyTime: number | null;
  status: string;
  clinicalContext: string | null;
  sourceType: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImageInput {
  id?: string;
  studyId: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  fileUri: string;
  previewUri?: string;
  modelReadyUri?: string;
  fileType?: string;
  checksumSha256?: string;
  width?: number;
  height?: number;
  pixelSpacing?: JsonObject;
  dicomMetadata?: JsonObject;
  imageQuality?: string;
  qualityScore?: number;
  processingStatus?: string;
  now?: number;
}

export interface ImageRecord {
  id: string;
  studyId: string;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  fileUri: string;
  previewUri: string | null;
  modelReadyUri: string | null;
  fileType: string;
  checksumSha256: string | null;
  width: number | null;
  height: number | null;
  pixelSpacing: JsonObject;
  dicomMetadata: JsonObject;
  imageQuality: string | null;
  qualityScore: number | null;
  processingStatus: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImageQualityUpdate {
  imageId: string;
  imageQuality?: string;
  qualityScore?: number;
  processingStatus?: string;
  now?: number;
}

export interface AnalysisSessionInput {
  id?: string;
  studyId: string;
  teamRunId?: string;
  status?: string;
  triggerSource?: string;
  summary?: JsonObject;
  error?: JsonObject;
  startedAt?: number;
  completedAt?: number;
  createdBy?: string;
  now?: number;
}

export interface AnalysisSessionRecord {
  id: string;
  studyId: string;
  teamRunId: string | null;
  status: string;
  triggerSource: string;
  summary: JsonObject;
  error: JsonObject | null;
  startedAt: number | null;
  completedAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTaskInput {
  id?: string;
  analysisSessionId: string;
  parentTaskId?: string;
  agentName: string;
  taskType: string;
  status?: string;
  input?: JsonObject;
  output?: JsonObject;
  error?: JsonObject;
  startedAt?: number;
  completedAt?: number;
  now?: number;
}

export interface AgentTaskRecord {
  id: string;
  analysisSessionId: string;
  parentTaskId: string | null;
  agentName: string;
  taskType: string;
  status: string;
  input: JsonObject;
  output: JsonObject | null;
  error: JsonObject | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ModelJobInput {
  id?: string;
  studyId?: string;
  imageId?: string;
  agentTaskId?: string;
  jobType: string;
  status?: string;
  priority?: number;
  attempts?: number;
  maxAttempts?: number;
  input?: JsonObject;
  output?: JsonObject;
  error?: JsonObject;
  modelName?: string;
  modelVersion?: string;
  weightsHash?: string;
  artifactUri?: string;
  startedAt?: number;
  completedAt?: number;
  now?: number;
}

export interface ModelJobUpdateInput {
  id: string;
  status?: string;
  attempts?: number;
  maxAttempts?: number;
  output?: JsonObject | null;
  error?: JsonObject | null;
  artifactUri?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  now?: number;
}

export interface ModelJobRecord {
  id: string;
  studyId: string | null;
  imageId: string | null;
  agentTaskId: string | null;
  jobType: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  input: JsonObject;
  output: JsonObject | null;
  error: JsonObject | null;
  modelName: string | null;
  modelVersion: string | null;
  weightsHash: string | null;
  artifactUri: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface NoduleInput {
  id?: string;
  studyId: string;
  imageId?: string | null;
  noduleIndex: number;
  location?: string;
  bbox?: unknown;
  maskUri?: string;
  detectionConfidence?: number;
  source?: string;
  status?: string;
  now?: number;
}

export interface NoduleRecord {
  id: string;
  studyId: string;
  imageId: string | null;
  noduleIndex: number;
  location: string | null;
  bbox: unknown;
  maskUri: string | null;
  detectionConfidence: number | null;
  source: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface NoduleRevisionInput {
  noduleId: string;
  bbox?: unknown;
  location?: string | null;
  status?: string;
  now?: number;
}

export interface NoduleRevisionResult {
  before: NoduleRecord;
  nodule: NoduleRecord;
}

export interface MeasurementInput {
  id?: string;
  noduleId: string;
  longAxisMm?: number | null;
  shortAxisMm?: number | null;
  apAxisMm?: number | null;
  areaMm2?: number | null;
  aspectRatio?: number | null;
  measurementSource: string;
  confidence?: number | null;
  now?: number;
}

export interface MeasurementRecord {
  id: string;
  noduleId: string;
  longAxisMm: number | null;
  shortAxisMm: number | null;
  apAxisMm: number | null;
  areaMm2: number | null;
  aspectRatio: number | null;
  measurementSource: string;
  confidence: number | null;
  createdAt: number;
}

export interface TiradsFeatureInput {
  id?: string;
  noduleId: string;
  systemName?: string;
  features?: JsonObject;
  confidence?: JsonObject;
  sourceModel?: string;
  requiresReview?: boolean;
  now?: number;
}

export interface TiradsFeatureRecord {
  id: string;
  noduleId: string;
  systemName: string;
  features: JsonObject;
  confidence: JsonObject;
  sourceModel: string | null;
  requiresReview: boolean;
  createdAt: number;
}

export interface TiradsResultInput {
  id?: string;
  noduleId: string;
  systemName?: string;
  systemVersion?: string;
  score?: number;
  category?: string;
  recommendation?: string;
  evidenceRules?: unknown[];
  warnings?: string[];
  now?: number;
}

export interface TiradsResultRecord {
  id: string;
  noduleId: string;
  systemName: string;
  systemVersion: string;
  score: number | null;
  category: string | null;
  recommendation: string | null;
  evidenceRules: unknown[];
  warnings: string[];
  createdAt: number;
}

export interface TiradsRuleRecord {
  id: string;
  systemName: string;
  systemVersion: string;
  ruleCode: string;
  featureGroup: string | null;
  featureName: string | null;
  points: number | null;
  category: string | null;
  minScore: number | null;
  maxScore: number | null;
  recommendation: string | null;
  rule: JsonObject;
  evidenceDocumentId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReportInput {
  id?: string;
  studyId: string;
  analysisSessionId?: string | null;
  reportType?: string;
  status?: string;
  templateId?: string | null;
  draftText?: string | null;
  finalText?: string | null;
  structured?: JsonObject;
  evidence?: unknown[];
  createdByAgent?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: number | null;
  now?: number;
}

export interface ReportRecord {
  id: string;
  studyId: string;
  analysisSessionId: string | null;
  reportType: string;
  status: string;
  templateId: string | null;
  draftText: string | null;
  finalText: string | null;
  structured: JsonObject;
  evidence: unknown[];
  createdByAgent: string | null;
  confirmedBy: string | null;
  confirmedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SafetyRuleRecord {
  id: string;
  ruleCode: string;
  ruleType: string;
  severity: string;
  pattern: string | null;
  rule: JsonObject;
  message: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuditLogInput {
  id?: string;
  studyId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: JsonObject;
  traceId?: string | null;
  now?: number;
}

export interface AuditLogRecord {
  id: string;
  studyId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: JsonObject;
  traceId: string | null;
  createdAt: number;
}

export type ReportReviewAction = "approve" | "revise" | "reject" | "archive";

export interface ReportReviewInput {
  id?: string;
  reportId: string;
  reviewerName: string;
  action: ReportReviewAction;
  comment?: string | null;
  finalText?: string | null;
  structured?: JsonObject | null;
  now?: number;
}

export interface DoctorReviewRecord {
  id: string;
  reportId: string;
  reviewerName: string;
  action: string;
  comment: string | null;
  before: JsonObject | null;
  after: JsonObject | null;
  createdAt: number;
}

export interface FinalValidationRunInput {
  id?: string;
  datasetId: string;
  datasetRoot?: string | null;
  datasetManifestUri?: string | null;
  caseId?: string | null;
  pipelineMode: string;
  status?: string;
  remoteModelGatewayUrl?: string | null;
  dataDbPath?: string | null;
  ragDbPath?: string | null;
  reportJsonUri?: string | null;
  reportMarkdownUri?: string | null;
  summary?: JsonObject;
  createdBy?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  now?: number;
}

export interface FinalValidationRunUpdateInput {
  status?: string;
  reportJsonUri?: string | null;
  reportMarkdownUri?: string | null;
  summary?: JsonObject;
  completedAt?: number | null;
  now?: number;
}

export interface FinalValidationRunRecord {
  id: string;
  datasetId: string;
  datasetRoot: string | null;
  datasetManifestUri: string | null;
  caseId: string | null;
  pipelineMode: string;
  status: string;
  remoteModelGatewayUrl: string | null;
  dataDbPath: string | null;
  ragDbPath: string | null;
  reportJsonUri: string | null;
  reportMarkdownUri: string | null;
  summary: JsonObject;
  createdBy: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FinalValidationImageResultInput {
  id?: string;
  runId: string;
  studyId?: string | null;
  imageId?: string | null;
  analysisSessionId?: string | null;
  datasetImageId: string;
  datasetLabel?: string | null;
  sourceRelativePath?: string | null;
  artifactUri: string;
  localStagedPath?: string | null;
  remoteUpload?: JsonObject;
  expected?: JsonObject;
  detection?: JsonObject;
  measurement?: JsonObject;
  tirads?: JsonObject;
  report?: JsonObject;
  safetyReview?: JsonObject;
  modelArtifacts?: unknown[];
  taskEvents?: unknown[];
  note?: string | null;
  status?: string;
  error?: JsonObject | null;
  reviewStatus?: string;
  reviewComment?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
  completedAt?: number | null;
  now?: number;
}

export interface FinalValidationImageResultListOptions {
  reviewStatus?: string;
  status?: string;
  limit?: number;
}

export interface FinalValidationImageReviewInput {
  resultId: string;
  reviewStatus: string;
  reviewComment?: string | null;
  reviewedBy?: string | null;
  now?: number;
}

export interface FinalValidationImageResultRecord {
  id: string;
  runId: string;
  studyId: string | null;
  imageId: string | null;
  analysisSessionId: string | null;
  datasetImageId: string;
  datasetLabel: string | null;
  sourceRelativePath: string | null;
  artifactUri: string;
  localStagedPath: string | null;
  remoteUpload: JsonObject;
  expected: JsonObject;
  detection: JsonObject;
  measurement: JsonObject;
  tirads: JsonObject;
  report: JsonObject;
  safetyReview: JsonObject;
  modelArtifacts: unknown[];
  taskEvents: unknown[];
  note: string | null;
  status: string;
  error: JsonObject | null;
  reviewStatus: string;
  reviewComment: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface StudyBundle {
  patient: PatientRecord | null;
  study: StudyRecord;
  images: ImageRecord[];
  nodules: NoduleRecord[];
  measurements: MeasurementRecord[];
  tiradsFeatures: TiradsFeatureRecord[];
  tiradsResults: TiradsResultRecord[];
  reports: ReportRecord[];
  auditLogs: AuditLogRecord[];
  doctorReviews: DoctorReviewRecord[];
  modelJobs: ModelJobRecord[];
  analysisSessions: AnalysisSessionRecord[];
  agentTasks: AgentTaskRecord[];
}

interface PatientRow {
  id: string;
  external_patient_id: string | null;
  name_hash: string | null;
  sex: string | null;
  birth_year: number | null;
  deidentified: number;
  meta_json: string;
  created_at: number;
  updated_at: number;
}

interface StudyRow {
  id: string;
  patient_id: string | null;
  accession_no: string | null;
  study_instance_uid: string | null;
  modality: string;
  body_part: string;
  study_time: number | null;
  status: string;
  clinical_context: string | null;
  source_type: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface ImageRow {
  id: string;
  study_id: string;
  series_instance_uid: string | null;
  sop_instance_uid: string | null;
  file_uri: string;
  preview_uri: string | null;
  model_ready_uri: string | null;
  file_type: string;
  checksum_sha256: string | null;
  width: number | null;
  height: number | null;
  pixel_spacing: string | null;
  dicom_metadata: string;
  image_quality: string | null;
  quality_score: number | null;
  processing_status: string;
  created_at: number;
  updated_at: number;
}

interface AnalysisSessionRow {
  id: string;
  study_id: string;
  team_run_id: string | null;
  status: string;
  trigger_source: string;
  summary_json: string;
  error_json: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface AgentTaskRow {
  id: string;
  analysis_session_id: string;
  parent_task_id: string | null;
  agent_name: string;
  task_type: string;
  status: string;
  input_json: string;
  output_json: string | null;
  error_json: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ModelJobRow {
  id: string;
  study_id: string | null;
  image_id: string | null;
  agent_task_id: string | null;
  job_type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  input_json: string;
  output_json: string | null;
  error_json: string | null;
  model_name: string | null;
  model_version: string | null;
  weights_hash: string | null;
  artifact_uri: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface NoduleRow {
  id: string;
  study_id: string;
  image_id: string | null;
  nodule_index: number;
  location: string | null;
  bbox: string | null;
  mask_uri: string | null;
  detection_confidence: number | null;
  source: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface MeasurementRow {
  id: string;
  nodule_id: string;
  long_axis_mm: number | null;
  short_axis_mm: number | null;
  ap_axis_mm: number | null;
  area_mm2: number | null;
  aspect_ratio: number | null;
  measurement_source: string;
  confidence: number | null;
  created_at: number;
}

interface TiradsFeatureRow {
  id: string;
  nodule_id: string;
  system_name: string;
  features: string;
  confidence: string;
  source_model: string | null;
  requires_review: number;
  created_at: number;
}

interface TiradsResultRow {
  id: string;
  nodule_id: string;
  system_name: string;
  system_version: string;
  score: number | null;
  category: string | null;
  recommendation: string | null;
  evidence_rules: string;
  warnings: string;
  created_at: number;
}

interface TiradsRuleRow {
  id: string;
  system_name: string;
  system_version: string;
  rule_code: string;
  feature_group: string | null;
  feature_name: string | null;
  points: number | null;
  category: string | null;
  min_score: number | null;
  max_score: number | null;
  recommendation: string | null;
  rule_json: string;
  evidence_document_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

interface ReportRow {
  id: string;
  study_id: string;
  analysis_session_id: string | null;
  report_type: string;
  status: string;
  template_id: string | null;
  draft_text: string | null;
  final_text: string | null;
  structured_json: string;
  evidence_json: string;
  created_by_agent: string | null;
  confirmed_by: string | null;
  confirmed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface SafetyRuleRow {
  id: string;
  rule_code: string;
  rule_type: string;
  severity: string;
  pattern: string | null;
  rule_json: string;
  message: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface AuditLogRow {
  id: string;
  study_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail_json: string;
  trace_id: string | null;
  created_at: number;
}

interface DoctorReviewRow {
  id: string;
  report_id: string;
  reviewer_name: string;
  action: string;
  comment: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: number;
}

interface FinalValidationRunRow {
  id: string;
  dataset_id: string;
  dataset_root: string | null;
  dataset_manifest_uri: string | null;
  case_id: string | null;
  pipeline_mode: string;
  status: string;
  remote_model_gateway_url: string | null;
  data_db_path: string | null;
  rag_db_path: string | null;
  report_json_uri: string | null;
  report_markdown_uri: string | null;
  summary_json: string;
  created_by: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface FinalValidationImageResultRow {
  id: string;
  run_id: string;
  study_id: string | null;
  image_id: string | null;
  analysis_session_id: string | null;
  dataset_image_id: string;
  dataset_label: string | null;
  source_relative_path: string | null;
  artifact_uri: string;
  local_staged_path: string | null;
  remote_upload_json: string;
  expected_json: string;
  detection_json: string;
  measurement_json: string;
  tirads_json: string;
  report_json: string;
  safety_review_json: string;
  model_artifacts_json: string;
  task_events_json: string;
  note: string | null;
  status: string;
  error_json: string | null;
  review_status: string;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export class MedicalCaseRepo {
  constructor(private readonly db: Database.Database) {}

  upsertPatient(input: PatientInput = {}): PatientRecord {
    if (input.externalPatientId) {
      const existing = this.db
        .prepare<[string], PatientRow>("SELECT * FROM patient WHERE external_patient_id = ?")
        .get(input.externalPatientId);
      if (existing) {
        return this.updatePatient(existing.id, input);
      }
    }

    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO patient(
           id, external_patient_id, name_hash, sex, birth_year, deidentified,
           meta_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.externalPatientId ?? null,
        input.nameHash ?? null,
        input.sex ?? null,
        input.birthYear ?? null,
        input.deidentified === false ? 0 : 1,
        stringifyJson(input.meta ?? {}),
        now,
        now
      );
    return this.getPatient(id)!;
  }

  createStudy(input: StudyInput): StudyRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO study(
           id, patient_id, accession_no, study_instance_uid, modality, body_part,
           study_time, status, clinical_context, source_type, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.patientId ?? null,
        input.accessionNo ?? null,
        input.studyInstanceUid ?? null,
        input.modality ?? "US",
        input.bodyPart ?? "thyroid",
        input.studyTime ?? null,
        input.status ?? "created",
        input.clinicalContext ?? null,
        input.sourceType ?? "manual",
        input.createdBy ?? null,
        now,
        now
      );
    return this.getStudy(id)!;
  }

  addImage(input: ImageInput): ImageRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO image(
           id, study_id, series_instance_uid, sop_instance_uid, file_uri, preview_uri,
           model_ready_uri, file_type, checksum_sha256, width, height, pixel_spacing,
           dicom_metadata, image_quality, quality_score, processing_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.studyId,
        input.seriesInstanceUid ?? null,
        input.sopInstanceUid ?? null,
        input.fileUri,
        input.previewUri ?? null,
        input.modelReadyUri ?? null,
        input.fileType ?? "unknown",
        input.checksumSha256 ?? null,
        input.width ?? null,
        input.height ?? null,
        stringifyJson(input.pixelSpacing ?? {}),
        stringifyJson(input.dicomMetadata ?? {}),
        input.imageQuality ?? null,
        input.qualityScore ?? null,
        input.processingStatus ?? "uploaded",
        now,
        now
      );
    return this.getImage(id)!;
  }

  createAnalysisSession(input: AnalysisSessionInput): AnalysisSessionRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO analysis_session(
           id, study_id, team_run_id, status, trigger_source, summary_json, error_json,
           started_at, completed_at, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.studyId,
        input.teamRunId ?? null,
        input.status ?? "created",
        input.triggerSource ?? "manual",
        stringifyJson(input.summary ?? {}),
        input.error ? stringifyJson(input.error) : null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.createdBy ?? null,
        now,
        now
      );
    return this.getAnalysisSession(id)!;
  }

  createAgentTask(input: AgentTaskInput): AgentTaskRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO agent_task(
           id, analysis_session_id, parent_task_id, agent_name, task_type, status,
           input_json, output_json, error_json, started_at, completed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.analysisSessionId,
        input.parentTaskId ?? null,
        input.agentName,
        input.taskType,
        input.status ?? "queued",
        stringifyJson(input.input ?? {}),
        input.output ? stringifyJson(input.output) : null,
        input.error ? stringifyJson(input.error) : null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        now,
        now
      );
    return this.getAgentTask(id)!;
  }

  cancelAgentTasks(taskIds: string[], reason: JsonObject, now = Date.now()): AgentTaskRecord[] {
    const uniqueIds = Array.from(new Set(taskIds)).filter(Boolean);
    if (uniqueIds.length === 0) return [];
    const sessionIds = new Set<string>();
    const cancelled: AgentTaskRecord[] = [];
    const errorJson = stringifyJson(reason);

    for (const taskId of uniqueIds) {
      const row = this.db
        .prepare<[string], { analysis_session_id: string }>(
          "SELECT analysis_session_id FROM agent_task WHERE id = ?"
        )
        .get(taskId);
      const updated = this.db
        .prepare<[string, number, number, string]>(
          `UPDATE agent_task
           SET status = 'cancelled', error_json = ?, completed_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running', 'waiting_model')`
        )
        .run(errorJson, now, now, taskId);
      if (updated.changes !== 1) continue;
      if (row) sessionIds.add(row.analysis_session_id);
      this.db
        .prepare<[string, number, number, string]>(
          `UPDATE model_job
           SET status = 'cancelled', error_json = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
           WHERE agent_task_id = ? AND status IN ('queued', 'running')`
        )
        .run(errorJson, now, now, taskId);
      const task = this.getAgentTask(taskId);
      if (task) cancelled.push(task);
    }

    for (const sessionId of sessionIds) {
      this.refreshAnalysisSessionStatus(sessionId, now);
    }
    return cancelled;
  }

  createModelJob(input: ModelJobInput): ModelJobRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO model_job(
           id, study_id, image_id, agent_task_id, job_type, status, priority,
           attempts, max_attempts, input_json, output_json, error_json, model_name,
           model_version, weights_hash, artifact_uri, created_at, updated_at, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.studyId ?? null,
        input.imageId ?? null,
        input.agentTaskId ?? null,
        input.jobType,
        input.status ?? "queued",
        input.priority ?? 100,
        input.attempts ?? 0,
        input.maxAttempts ?? 1,
        stringifyJson(input.input ?? {}),
        input.output ? stringifyJson(input.output) : null,
        input.error ? stringifyJson(input.error) : null,
        input.modelName ?? null,
        input.modelVersion ?? null,
        input.weightsHash ?? null,
        input.artifactUri ?? null,
        now,
        now,
        input.startedAt ?? null,
        input.completedAt ?? null
      );
    return this.getModelJob(id)!;
  }

  updateModelJob(input: ModelJobUpdateInput): ModelJobRecord | null {
    const current = this.getModelJob(input.id);
    if (!current) return null;
    const now = input.now ?? Date.now();
    const output = input.output === undefined ? current.output : input.output;
    const error = input.error === undefined ? current.error : input.error;
    this.db
      .prepare(
        `UPDATE model_job
         SET status = ?,
             attempts = ?,
             max_attempts = ?,
             output_json = ?,
             error_json = ?,
             artifact_uri = ?,
             started_at = ?,
             completed_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.status ?? current.status,
        input.attempts ?? current.attempts,
        input.maxAttempts ?? current.maxAttempts,
        output === null ? null : stringifyJson(output),
        error === null ? null : stringifyJson(error),
        input.artifactUri === undefined ? current.artifactUri : input.artifactUri,
        input.startedAt === undefined ? current.startedAt : input.startedAt,
        input.completedAt === undefined ? current.completedAt : input.completedAt,
        now,
        input.id
      );
    return this.getModelJob(input.id);
  }

  upsertNodule(input: NoduleInput): NoduleRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO nodule(
           id, study_id, image_id, nodule_index, location, bbox, mask_uri,
           detection_confidence, source, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(study_id, nodule_index) DO UPDATE SET
           image_id = excluded.image_id,
           location = excluded.location,
           bbox = excluded.bbox,
           mask_uri = excluded.mask_uri,
           detection_confidence = excluded.detection_confidence,
           source = excluded.source,
           status = excluded.status,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.studyId,
        input.imageId ?? null,
        input.noduleIndex,
        input.location ?? null,
        stringifyJsonValue(input.bbox ?? null),
        input.maskUri ?? null,
        input.detectionConfidence ?? null,
        input.source ?? "ai",
        input.status ?? "detected",
        now,
        now
      );
    return this.getNoduleByStudyIndex(input.studyId, input.noduleIndex)!;
  }

  reviseNodule(input: NoduleRevisionInput): NoduleRevisionResult {
    const before = this.getNodule(input.noduleId);
    if (!before) {
      throw new Error(`nodule not found: ${input.noduleId}`);
    }
    const now = input.now ?? Date.now();
    const nextBbox = input.bbox !== undefined ? input.bbox : before.bbox;
    this.db
      .prepare<[string, string | null, string, number, string]>(
        `UPDATE nodule
         SET bbox = ?,
             location = ?,
             source = 'doctor',
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        stringifyJsonValue(nextBbox ?? null),
        input.location ?? before.location,
        input.status ?? "doctor_revised",
        now,
        input.noduleId
      );
    return {
      before,
      nodule: this.getNodule(input.noduleId)!,
    };
  }

  updateNoduleMask(noduleId: string, maskUri: string, now = Date.now()): NoduleRecord {
    this.db
      .prepare<[string, number, string]>(
        `UPDATE nodule
         SET mask_uri = ?,
             status = CASE WHEN status = 'detected' THEN 'segmented' ELSE status END,
             updated_at = ?
         WHERE id = ?`
      )
      .run(maskUri, now, noduleId);
    const nodule = this.getNodule(noduleId);
    if (!nodule) throw new Error(`nodule not found: ${noduleId}`);
    return nodule;
  }

  createMeasurement(input: MeasurementInput): MeasurementRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO measurement(
           id, nodule_id, long_axis_mm, short_axis_mm, ap_axis_mm, area_mm2,
           aspect_ratio, measurement_source, confidence, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.noduleId,
        input.longAxisMm ?? null,
        input.shortAxisMm ?? null,
        input.apAxisMm ?? null,
        input.areaMm2 ?? null,
        input.aspectRatio ?? null,
        input.measurementSource,
        input.confidence ?? null,
        now
      );
    const measurement = this.getMeasurement(id);
    if (!measurement) throw new Error(`measurement not found after insert: ${id}`);
    return measurement;
  }

  getMeasurement(id: string): MeasurementRecord | null {
    const row = this.db.prepare<[string], MeasurementRow>("SELECT * FROM measurement WHERE id = ?").get(id);
    return row ? mapMeasurement(row) : null;
  }

  createTiradsFeature(input: TiradsFeatureInput): TiradsFeatureRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO tirads_feature(
           id, nodule_id, system_name, features, confidence, source_model, requires_review, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.noduleId,
        input.systemName ?? "ACR_TI_RADS",
        stringifyJson(input.features ?? {}),
        stringifyJson(input.confidence ?? {}),
        input.sourceModel ?? null,
        input.requiresReview ? 1 : 0,
        now
      );
    return this.getTiradsFeature(id)!;
  }

  createTiradsResult(input: TiradsResultInput): TiradsResultRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO tirads_result(
           id, nodule_id, system_name, system_version, score, category, recommendation,
           evidence_rules, warnings, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.noduleId,
        input.systemName ?? "ACR_TI_RADS",
        input.systemVersion ?? "2017",
        input.score ?? null,
        input.category ?? null,
        input.recommendation ?? null,
        stringifyJsonValue(input.evidenceRules ?? []),
        stringifyJsonValue(input.warnings ?? []),
        now
      );
    return this.getTiradsResult(id)!;
  }

  createReport(input: ReportInput): ReportRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO report(
           id, study_id, analysis_session_id, report_type, status, template_id,
           draft_text, final_text, structured_json, evidence_json, created_by_agent,
           confirmed_by, confirmed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.studyId,
        input.analysisSessionId ?? null,
        input.reportType ?? "thyroid_ultrasound",
        input.status ?? "draft",
        input.templateId ?? null,
        input.draftText ?? null,
        input.finalText ?? null,
        stringifyJson(input.structured ?? {}),
        stringifyJsonValue(input.evidence ?? []),
        input.createdByAgent ?? null,
        input.confirmedBy ?? null,
        input.confirmedAt ?? null,
        now,
        now
      );
    return this.getReport(id)!;
  }

  updateReportStructured(reportId: string, structured: JsonObject, now: number = Date.now()): ReportRecord {
    this.db
      .prepare<[string, number, string]>(
        `UPDATE report
         SET structured_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(stringifyJson(structured), now, reportId);
    const report = this.getReport(reportId);
    if (!report) throw new Error(`report not found: ${reportId}`);
    return report;
  }

  createAuditLog(input: AuditLogInput): AuditLogRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO audit_log(
           id, study_id, actor_type, actor_id, action, target_type, target_id,
           detail_json, trace_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.studyId ?? null,
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        stringifyJson(input.detail ?? {}),
        input.traceId ?? null,
      now
    );
    return this.getAuditLog(id)!;
  }

  createFinalValidationRun(input: FinalValidationRunInput): FinalValidationRunRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO final_validation_run(
           id, dataset_id, dataset_root, dataset_manifest_uri, case_id, pipeline_mode,
           status, remote_model_gateway_url, data_db_path, rag_db_path,
           report_json_uri, report_markdown_uri, summary_json, created_by,
           started_at, completed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.datasetId,
        input.datasetRoot ?? null,
        input.datasetManifestUri ?? null,
        input.caseId ?? null,
        input.pipelineMode,
        input.status ?? "running",
        input.remoteModelGatewayUrl ?? null,
        input.dataDbPath ?? null,
        input.ragDbPath ?? null,
        input.reportJsonUri ?? null,
        input.reportMarkdownUri ?? null,
        stringifyJson(input.summary ?? {}),
        input.createdBy ?? null,
        input.startedAt ?? now,
        input.completedAt ?? null,
        now,
        now
      );
    return this.getFinalValidationRun(id)!;
  }

  updateFinalValidationRun(id: string, input: FinalValidationRunUpdateInput): FinalValidationRunRecord {
    const current = this.getFinalValidationRun(id);
    if (!current) throw new Error(`final validation run not found: ${id}`);
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `UPDATE final_validation_run
         SET status = ?,
             report_json_uri = ?,
             report_markdown_uri = ?,
             summary_json = ?,
             completed_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.status ?? current.status,
        input.reportJsonUri === undefined ? current.reportJsonUri : input.reportJsonUri,
        input.reportMarkdownUri === undefined ? current.reportMarkdownUri : input.reportMarkdownUri,
        input.summary === undefined ? stringifyJson(current.summary) : stringifyJson(input.summary),
        input.completedAt === undefined ? current.completedAt : input.completedAt,
        now,
        id
      );
    return this.getFinalValidationRun(id)!;
  }

  getFinalValidationRun(id: string): FinalValidationRunRecord | null {
    const row = this.db
      .prepare<[string], FinalValidationRunRow>("SELECT * FROM final_validation_run WHERE id = ?")
      .get(id);
    return row ? mapFinalValidationRun(row) : null;
  }

  listFinalValidationRuns(limit = 50): FinalValidationRunRecord[] {
    return this.db
      .prepare<[number], FinalValidationRunRow>(
        "SELECT * FROM final_validation_run ORDER BY created_at DESC, id DESC LIMIT ?"
      )
      .all(limit)
      .map(mapFinalValidationRun);
  }

  upsertFinalValidationImageResult(input: FinalValidationImageResultInput): FinalValidationImageResultRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO final_validation_image_result(
           id, run_id, study_id, image_id, analysis_session_id, dataset_image_id,
           dataset_label, source_relative_path, artifact_uri, local_staged_path,
           remote_upload_json, expected_json, detection_json, measurement_json,
           tirads_json, report_json, safety_review_json, model_artifacts_json,
           task_events_json, note, status, error_json, review_status,
           review_comment, reviewed_by, reviewed_at, created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, dataset_image_id) DO UPDATE SET
           study_id = excluded.study_id,
           image_id = excluded.image_id,
           analysis_session_id = excluded.analysis_session_id,
           dataset_label = excluded.dataset_label,
           source_relative_path = excluded.source_relative_path,
           artifact_uri = excluded.artifact_uri,
           local_staged_path = excluded.local_staged_path,
           remote_upload_json = excluded.remote_upload_json,
           expected_json = excluded.expected_json,
           detection_json = excluded.detection_json,
           measurement_json = excluded.measurement_json,
           tirads_json = excluded.tirads_json,
           report_json = excluded.report_json,
           safety_review_json = excluded.safety_review_json,
           model_artifacts_json = excluded.model_artifacts_json,
           task_events_json = excluded.task_events_json,
           note = excluded.note,
           status = excluded.status,
           error_json = excluded.error_json,
           review_status = excluded.review_status,
           review_comment = excluded.review_comment,
           reviewed_by = excluded.reviewed_by,
           reviewed_at = excluded.reviewed_at,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at`
      )
      .run(
        id,
        input.runId,
        input.studyId ?? null,
        input.imageId ?? null,
        input.analysisSessionId ?? null,
        input.datasetImageId,
        input.datasetLabel ?? null,
        input.sourceRelativePath ?? null,
        input.artifactUri,
        input.localStagedPath ?? null,
        stringifyJson(input.remoteUpload ?? {}),
        stringifyJson(input.expected ?? {}),
        stringifyJson(input.detection ?? {}),
        stringifyJson(input.measurement ?? {}),
        stringifyJson(input.tirads ?? {}),
        stringifyJson(input.report ?? {}),
        stringifyJson(input.safetyReview ?? {}),
        stringifyJsonValue(input.modelArtifacts ?? []),
        stringifyJsonValue(input.taskEvents ?? []),
        input.note ?? null,
        input.status ?? "succeeded",
        input.error === null ? null : input.error ? stringifyJson(input.error) : null,
        input.reviewStatus ?? "unreviewed",
        input.reviewComment ?? null,
        input.reviewedBy ?? null,
        input.reviewedAt ?? null,
        now,
        now,
        input.completedAt ?? now
      );
    const result = this.getFinalValidationImageResult(input.runId, input.datasetImageId);
    if (!result) throw new Error(`final validation image result not found after insert: ${input.datasetImageId}`);
    return result;
  }

  getFinalValidationImageResult(runId: string, datasetImageId: string): FinalValidationImageResultRecord | null {
    const row = this.db
      .prepare<[string, string], FinalValidationImageResultRow>(
        "SELECT * FROM final_validation_image_result WHERE run_id = ? AND dataset_image_id = ?"
      )
      .get(runId, datasetImageId);
    return row ? mapFinalValidationImageResult(row) : null;
  }

  getFinalValidationImageResultById(id: string): FinalValidationImageResultRecord | null {
    const row = this.db
      .prepare<[string], FinalValidationImageResultRow>("SELECT * FROM final_validation_image_result WHERE id = ?")
      .get(id);
    return row ? mapFinalValidationImageResult(row) : null;
  }

  listFinalValidationImageResults(
    runId: string,
    options: FinalValidationImageResultListOptions = {}
  ): FinalValidationImageResultRecord[] {
    const clauses = ["run_id = ?"];
    const params: Array<string | number> = [runId];
    if (options.reviewStatus) {
      clauses.push("review_status = ?");
      params.push(options.reviewStatus);
    }
    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 200;
    params.push(limit);
    return this.db
      .prepare(
        `SELECT * FROM final_validation_image_result
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(...params)
      .map((row) => mapFinalValidationImageResult(row as FinalValidationImageResultRow));
  }

  reviewFinalValidationImageResult(input: FinalValidationImageReviewInput): FinalValidationImageResultRecord {
    const current = this.getFinalValidationImageResultById(input.resultId);
    if (!current) throw new Error(`final validation image result not found: ${input.resultId}`);
    const now = input.now ?? Date.now();
    this.db
      .prepare<[string, string | null, string | null, number, number, string]>(
        `UPDATE final_validation_image_result
         SET review_status = ?,
             review_comment = ?,
             reviewed_by = ?,
             reviewed_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.reviewStatus,
        input.reviewComment ?? null,
        input.reviewedBy ?? null,
        now,
        now,
        input.resultId
      );
    return this.getFinalValidationImageResultById(input.resultId)!;
  }

  reviewReport(input: ReportReviewInput): { report: ReportRecord; doctorReview: DoctorReviewRecord } {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.getReport(input.reportId);
      if (!before) throw new Error(`Report not found: ${input.reportId}`);
      assertReportReviewActionAllowed(before, input.action);
      const nextStatus = reportStatusForReviewAction(input.action);
      const editedText = input.finalText ?? before.finalText ?? before.draftText;
      const nextDraftText = input.action === "reject"
        ? before.draftText
        : editedText ?? before.draftText;
      const nextFinalText = input.action === "approve"
        ? editedText ?? before.finalText ?? before.draftText
        : input.action === "archive"
          ? before.finalText ?? before.draftText
          : before.finalText;
      const nextStructured = input.structured ?? before.structured;
      const confirmedBy = input.action === "approve"
        ? input.reviewerName
        : input.action === "archive"
          ? before.confirmedBy ?? input.reviewerName
          : null;
      const confirmedAt = input.action === "approve"
        ? now
        : input.action === "archive"
          ? before.confirmedAt ?? now
          : null;
      this.db
        .prepare<[string, string | null, string | null, string, string | null, number | null, number, string]>(
          `UPDATE report
           SET status = ?, draft_text = ?, final_text = ?, structured_json = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextStatus,
          nextDraftText ?? null,
          nextFinalText ?? null,
          stringifyJson(nextStructured),
          confirmedBy,
          confirmedAt,
          now,
          input.reportId
        );
      const after = this.getReport(input.reportId)!;
      this.db
        .prepare(
          `INSERT INTO doctor_review(
             id, report_id, reviewer_name, action, comment, before_json, after_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.reportId,
          input.reviewerName,
          input.action,
          input.comment ?? null,
          stringifyJson(reportReviewSnapshot(before)),
          stringifyJson(reportReviewSnapshot(after)),
          now
        );
      const doctorReview = this.getDoctorReview(id)!;
      this.db.exec("COMMIT");
      return { report: after, doctorReview };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getPatient(id: string): PatientRecord | null {
    const row = this.db.prepare<[string], PatientRow>("SELECT * FROM patient WHERE id = ?").get(id);
    return row ? mapPatient(row) : null;
  }

  getStudy(id: string): StudyRecord | null {
    const row = this.db.prepare<[string], StudyRow>("SELECT * FROM study WHERE id = ?").get(id);
    return row ? mapStudy(row) : null;
  }

  getImage(id: string): ImageRecord | null {
    const row = this.db.prepare<[string], ImageRow>("SELECT * FROM image WHERE id = ?").get(id);
    return row ? mapImage(row) : null;
  }

  updateImageQuality(input: ImageQualityUpdate): ImageRecord | null {
    const now = input.now ?? Date.now();
    const updated = this.db
      .prepare<[string | null, number | null, string | null, number, string]>(
        `UPDATE image
         SET image_quality = COALESCE(?, image_quality),
             quality_score = COALESCE(?, quality_score),
             processing_status = COALESCE(?, processing_status),
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.imageQuality ?? null,
        input.qualityScore ?? null,
        input.processingStatus ?? null,
        now,
        input.imageId
      );
    return updated.changes === 1 ? this.getImage(input.imageId) : null;
  }

  getAnalysisSession(id: string): AnalysisSessionRecord | null {
    const row = this.db
      .prepare<[string], AnalysisSessionRow>("SELECT * FROM analysis_session WHERE id = ?")
      .get(id);
    return row ? mapAnalysisSession(row) : null;
  }

  getAgentTask(id: string): AgentTaskRecord | null {
    const row = this.db
      .prepare<[string], AgentTaskRow>("SELECT * FROM agent_task WHERE id = ?")
      .get(id);
    return row ? mapAgentTask(row) : null;
  }

  getModelJob(id: string): ModelJobRecord | null {
    const row = this.db
      .prepare<[string], ModelJobRow>("SELECT * FROM model_job WHERE id = ?")
      .get(id);
    return row ? mapModelJob(row) : null;
  }

  getNodule(id: string): NoduleRecord | null {
    const row = this.db.prepare<[string], NoduleRow>("SELECT * FROM nodule WHERE id = ?").get(id);
    return row ? mapNodule(row) : null;
  }

  getNoduleByStudyIndex(studyId: string, noduleIndex: number): NoduleRecord | null {
    const row = this.db
      .prepare<[string, number], NoduleRow>(
        "SELECT * FROM nodule WHERE study_id = ? AND nodule_index = ?"
      )
      .get(studyId, noduleIndex);
    return row ? mapNodule(row) : null;
  }

  listNodulesByStudy(studyId: string): NoduleRecord[] {
    return this.db
      .prepare<[string], NoduleRow>(
        "SELECT * FROM nodule WHERE study_id = ? ORDER BY nodule_index ASC, created_at ASC"
      )
      .all(studyId)
      .map(mapNodule);
  }

  listMeasurementsByStudy(studyId: string): MeasurementRecord[] {
    return this.db
      .prepare<[string], MeasurementRow>(
        `SELECT m.*
         FROM measurement m
         JOIN nodule n ON n.id = m.nodule_id
         WHERE n.study_id = ?
         ORDER BY n.nodule_index ASC, m.created_at ASC, m.id ASC`
      )
      .all(studyId)
      .map(mapMeasurement);
  }

  getTiradsFeature(id: string): TiradsFeatureRecord | null {
    const row = this.db
      .prepare<[string], TiradsFeatureRow>("SELECT * FROM tirads_feature WHERE id = ?")
      .get(id);
    return row ? mapTiradsFeature(row) : null;
  }

  listTiradsFeaturesByStudy(studyId: string, systemName = "ACR_TI_RADS"): TiradsFeatureRecord[] {
    return this.db
      .prepare<[string, string], TiradsFeatureRow>(
        `SELECT tf.*
         FROM tirads_feature tf
         JOIN nodule n ON n.id = tf.nodule_id
         WHERE n.study_id = ? AND tf.system_name = ?
         ORDER BY n.nodule_index ASC, tf.created_at DESC, tf.id DESC`
      )
      .all(studyId, systemName)
      .map(mapTiradsFeature);
  }

  getTiradsResult(id: string): TiradsResultRecord | null {
    const row = this.db
      .prepare<[string], TiradsResultRow>("SELECT * FROM tirads_result WHERE id = ?")
      .get(id);
    return row ? mapTiradsResult(row) : null;
  }

  listTiradsResultsByStudy(studyId: string, systemName = "ACR_TI_RADS"): TiradsResultRecord[] {
    return this.db
      .prepare<[string, string], TiradsResultRow>(
        `SELECT tr.*
         FROM tirads_result tr
         JOIN nodule n ON n.id = tr.nodule_id
         WHERE n.study_id = ? AND tr.system_name = ?
         ORDER BY n.nodule_index ASC, tr.created_at ASC, tr.id ASC`
      )
      .all(studyId, systemName)
      .map(mapTiradsResult);
  }

  getReport(id: string): ReportRecord | null {
    const row = this.db.prepare<[string], ReportRow>("SELECT * FROM report WHERE id = ?").get(id);
    return row ? mapReport(row) : null;
  }

  listReportsByStudy(studyId: string): ReportRecord[] {
    return this.db
      .prepare<[string], ReportRow>(
        "SELECT * FROM report WHERE study_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(studyId)
      .map(mapReport);
  }

  getActiveReportTemplateText(templateId: string): string | null {
    const row = this.db
      .prepare<[string], { template_text: string }>(
        "SELECT template_text FROM report_templates WHERE id = ? AND status = 'active'"
      )
      .get(templateId);
    return row?.template_text ?? null;
  }

  listActiveTiradsRulesByCodes(
    ruleCodes: string[],
    systemName = "ACR_TI_RADS",
    systemVersion = "2017"
  ): TiradsRuleRecord[] {
    const codes = [...new Set(ruleCodes.filter((code) => code.trim().length > 0))].sort();
    if (codes.length === 0) return [];
    const placeholders = codes.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT *
         FROM tirads_rules
         WHERE system_name = ?
           AND system_version = ?
           AND status = 'active'
           AND rule_code IN (${placeholders})
         ORDER BY rule_code ASC`
      )
      .all(systemName, systemVersion, ...codes)
      .map((row) => mapTiradsRule(row as TiradsRuleRow));
  }

  searchMedicalKnowledge(
    input: MedicalKnowledgeSearchInput,
    options: Omit<MedicalKnowledgeSearchOptions, "dataDb"> = {}
  ): MedicalKnowledgeSearchResult {
    return searchMedicalKnowledge(input, {
      ...options,
      dataDb: this.db,
    });
  }

  listActiveSafetyRules(): SafetyRuleRecord[] {
    return this.db
      .prepare<[], SafetyRuleRow>(
        "SELECT * FROM safety_rules WHERE status = 'active' ORDER BY severity ASC, rule_code ASC"
      )
      .all()
      .map(mapSafetyRule);
  }

  getAuditLog(id: string): AuditLogRecord | null {
    const row = this.db.prepare<[string], AuditLogRow>("SELECT * FROM audit_log WHERE id = ?").get(id);
    return row ? mapAuditLog(row) : null;
  }

  listAuditLogsByStudy(studyId: string): AuditLogRecord[] {
    return this.db
      .prepare<[string], AuditLogRow>(
        "SELECT * FROM audit_log WHERE study_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(studyId)
      .map(mapAuditLog);
  }

  getDoctorReview(id: string): DoctorReviewRecord | null {
    const row = this.db.prepare<[string], DoctorReviewRow>("SELECT * FROM doctor_review WHERE id = ?").get(id);
    return row ? mapDoctorReview(row) : null;
  }

  listDoctorReviewsByStudy(studyId: string): DoctorReviewRecord[] {
    return this.db
      .prepare<[string], DoctorReviewRow>(
        `SELECT dr.*
         FROM doctor_review dr
         JOIN report r ON r.id = dr.report_id
         WHERE r.study_id = ?
         ORDER BY dr.created_at ASC, dr.id ASC`
      )
      .all(studyId)
      .map(mapDoctorReview);
  }

  listModelJobsByStudy(studyId: string): ModelJobRecord[] {
    return this.db
      .prepare<[string], ModelJobRow>(
        "SELECT * FROM model_job WHERE study_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(studyId)
      .map(mapModelJob);
  }

  findModelJobByAgentTask(agentTaskId: string, jobType?: string): ModelJobRecord | null {
    const row = jobType
      ? this.db
          .prepare<[string, string], ModelJobRow>(
            `SELECT *
             FROM model_job
             WHERE agent_task_id = ? AND job_type = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1`
          )
          .get(agentTaskId, jobType)
      : this.db
          .prepare<[string], ModelJobRow>(
            `SELECT *
             FROM model_job
             WHERE agent_task_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1`
          )
          .get(agentTaskId);
    return row ? mapModelJob(row) : null;
  }

  claimNextAgentTask(now = Date.now()): AgentTaskRecord | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare<[], { id: string }>(
          `SELECT t.id
           FROM agent_task t
           LEFT JOIN agent_task parent ON parent.id = t.parent_task_id
           WHERE t.status = 'queued'
             AND (t.parent_task_id IS NULL OR parent.status = 'succeeded')
           ORDER BY t.created_at ASC, t.id ASC
           LIMIT 1`
        )
        .get();
      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }

      const updated = this.db
        .prepare<[number, number, string]>(
          `UPDATE agent_task
           SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error_json = NULL
           WHERE id = ? AND status = 'queued'`
        )
        .run(now, now, row.id);
      if (updated.changes !== 1) {
        this.db.exec("ROLLBACK");
        return null;
      }

      const task = this.getAgentTask(row.id);
      if (task) this.markSessionRunning(task.analysisSessionId, now);
      this.db.exec("COMMIT");
      return task;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  listWaitingModelAgentTasks(limit = 20): AgentTaskRecord[] {
    return this.db
      .prepare<[number], AgentTaskRow>(
        `SELECT *
         FROM agent_task
         WHERE status = 'waiting_model'
         ORDER BY updated_at ASC, created_at ASC, id ASC
         LIMIT ?`
      )
      .all(limit)
      .map(mapAgentTask);
  }

  markAgentTaskWaitingModel(taskId: string, output: JsonObject, now = Date.now()): AgentTaskRecord | null {
    const row = this.db
      .prepare<[string], { analysis_session_id: string }>(
        "SELECT analysis_session_id FROM agent_task WHERE id = ?"
      )
      .get(taskId);
    const updated = this.db
      .prepare<[string, number, string]>(
        `UPDATE agent_task
         SET status = 'waiting_model', output_json = ?, error_json = NULL, updated_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(stringifyJson(output), now, taskId);
    if (updated.changes !== 1) return null;
    if (row) this.markSessionRunning(row.analysis_session_id, now);
    return this.getAgentTask(taskId);
  }

  requeueAgentTask(taskId: string, output: JsonObject, now = Date.now()): AgentTaskRecord | null {
    const row = this.db
      .prepare<[string], { analysis_session_id: string }>(
        "SELECT analysis_session_id FROM agent_task WHERE id = ?"
      )
      .get(taskId);
    const updated = this.db
      .prepare<[string, number, string]>(
        `UPDATE agent_task
         SET status = 'queued', output_json = ?, error_json = NULL, updated_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(stringifyJson(output), now, taskId);
    if (updated.changes !== 1) return null;
    if (row) this.markSessionRunning(row.analysis_session_id, now);
    return this.getAgentTask(taskId);
  }

  completeAgentTask(taskId: string, output: JsonObject, now = Date.now()): AgentTaskRecord | null {
    const row = this.db
      .prepare<[string], { analysis_session_id: string }>(
        "SELECT analysis_session_id FROM agent_task WHERE id = ?"
      )
      .get(taskId);
    const updated = this.db
      .prepare<[string, number, number, string]>(
        `UPDATE agent_task
         SET status = 'succeeded', output_json = ?, error_json = NULL, completed_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('running', 'waiting_model')`
      )
      .run(stringifyJson(output), now, now, taskId);
    if (updated.changes !== 1) return null;
    if (row) this.refreshAnalysisSessionStatus(row.analysis_session_id, now);
    return this.getAgentTask(taskId);
  }

  failAgentTask(taskId: string, error: JsonObject, now = Date.now()): AgentTaskRecord | null {
    const row = this.db
      .prepare<[string], { analysis_session_id: string }>(
        "SELECT analysis_session_id FROM agent_task WHERE id = ?"
      )
      .get(taskId);
    const updated = this.db
      .prepare<[string, number, number, string]>(
        `UPDATE agent_task
         SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('running', 'waiting_model')`
      )
      .run(stringifyJson(error), now, now, taskId);
    if (updated.changes !== 1) return null;
    if (row) {
      const blockedError = stringifyJson({
        code: "parent_task_failed",
        message: "An upstream medical agent task failed.",
        detail: { failed_task_id: taskId },
      });
      this.db
        .prepare<[string, number, number, string]>(
          `UPDATE agent_task
           SET status = 'blocked', error_json = ?, completed_at = ?, updated_at = ?
           WHERE analysis_session_id = ? AND status = 'queued'`
        )
        .run(blockedError, now, now, row.analysis_session_id);
      this.db
        .prepare<[string, number, number, string]>(
          `UPDATE analysis_session
           SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(stringifyJson(error), now, now, row.analysis_session_id);
    }
    return this.getAgentTask(taskId);
  }

  getStudyBundle(studyId: string): StudyBundle | null {
    const study = this.getStudy(studyId);
    if (!study) return null;
    const patient = study.patientId ? this.getPatient(study.patientId) : null;
    const images = this.db
      .prepare<[string], ImageRow>(
        "SELECT * FROM image WHERE study_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(studyId)
      .map(mapImage);
    const analysisSessions = this.db
      .prepare<[string], AnalysisSessionRow>(
        "SELECT * FROM analysis_session WHERE study_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(studyId)
      .map(mapAnalysisSession);
    const agentTasks = this.db
      .prepare<[string], AgentTaskRow>(
        `SELECT t.*
         FROM agent_task t
         JOIN analysis_session a ON a.id = t.analysis_session_id
         WHERE a.study_id = ?
         ORDER BY a.created_at ASC, t.created_at ASC, t.id ASC`
      )
      .all(studyId)
      .map(mapAgentTask);
    return {
      patient,
      study,
      images,
      nodules: this.listNodulesByStudy(studyId),
      measurements: this.listMeasurementsByStudy(studyId),
      tiradsFeatures: this.listTiradsFeaturesByStudy(studyId),
      tiradsResults: this.listTiradsResultsByStudy(studyId),
      reports: this.listReportsByStudy(studyId),
      auditLogs: this.listAuditLogsByStudy(studyId),
      doctorReviews: this.listDoctorReviewsByStudy(studyId),
      modelJobs: this.listModelJobsByStudy(studyId),
      analysisSessions,
      agentTasks,
    };
  }

  private markSessionRunning(analysisSessionId: string, now: number): void {
    this.db
      .prepare<[number, number, string]>(
        `UPDATE analysis_session
         SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ? AND status IN ('created', 'queued')`
      )
      .run(now, now, analysisSessionId);
  }

  private refreshAnalysisSessionStatus(analysisSessionId: string, now: number): void {
    const row = this.db
      .prepare<[string], { open_count: number; failed_count: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('queued', 'running', 'waiting_model') THEN 1 ELSE 0 END), 0) AS open_count,
           COALESCE(SUM(CASE WHEN status IN ('failed', 'blocked') THEN 1 ELSE 0 END), 0) AS failed_count
         FROM agent_task
         WHERE analysis_session_id = ?`
      )
      .get(analysisSessionId);
    if (!row || row.open_count > 0) return;
    if (row.failed_count > 0) {
      this.db
        .prepare<[number, number, string]>(
          `UPDATE analysis_session
           SET status = 'failed', completed_at = COALESCE(completed_at, ?), updated_at = ?
           WHERE id = ?`
        )
        .run(now, now, analysisSessionId);
      return;
    }
    this.db
      .prepare<[number, number, string]>(
        `UPDATE analysis_session
         SET status = 'succeeded', completed_at = COALESCE(completed_at, ?), updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, analysisSessionId);
  }

  private updatePatient(id: string, input: PatientInput): PatientRecord {
    const current = this.getPatient(id);
    if (!current) throw new Error(`Patient not found: ${id}`);
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `UPDATE patient
         SET name_hash = ?, sex = ?, birth_year = ?, deidentified = ?, meta_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.nameHash ?? current.nameHash,
        input.sex ?? current.sex,
        input.birthYear ?? current.birthYear,
        input.deidentified === undefined ? (current.deidentified ? 1 : 0) : input.deidentified ? 1 : 0,
        stringifyJson(input.meta ?? current.meta),
        now,
        id
      );
    return this.getPatient(id)!;
  }
}

function mapPatient(row: PatientRow): PatientRecord {
  return {
    id: row.id,
    externalPatientId: row.external_patient_id,
    nameHash: row.name_hash,
    sex: row.sex,
    birthYear: row.birth_year,
    deidentified: row.deidentified === 1,
    meta: parseJson(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStudy(row: StudyRow): StudyRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    accessionNo: row.accession_no,
    studyInstanceUid: row.study_instance_uid,
    modality: row.modality,
    bodyPart: row.body_part,
    studyTime: row.study_time,
    status: row.status,
    clinicalContext: row.clinical_context,
    sourceType: row.source_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImage(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    seriesInstanceUid: row.series_instance_uid,
    sopInstanceUid: row.sop_instance_uid,
    fileUri: row.file_uri,
    previewUri: row.preview_uri,
    modelReadyUri: row.model_ready_uri,
    fileType: row.file_type,
    checksumSha256: row.checksum_sha256,
    width: row.width,
    height: row.height,
    pixelSpacing: parseJson(row.pixel_spacing, {}),
    dicomMetadata: parseJson(row.dicom_metadata, {}),
    imageQuality: row.image_quality,
    qualityScore: row.quality_score,
    processingStatus: row.processing_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAnalysisSession(row: AnalysisSessionRow): AnalysisSessionRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    teamRunId: row.team_run_id,
    status: row.status,
    triggerSource: row.trigger_source,
    summary: parseJson(row.summary_json, {}),
    error: row.error_json ? parseJson(row.error_json, {}) : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentTask(row: AgentTaskRow): AgentTaskRecord {
  return {
    id: row.id,
    analysisSessionId: row.analysis_session_id,
    parentTaskId: row.parent_task_id,
    agentName: row.agent_name,
    taskType: row.task_type,
    status: row.status,
    input: parseJson(row.input_json, {}),
    output: row.output_json ? parseJson(row.output_json, {}) : null,
    error: row.error_json ? parseJson(row.error_json, {}) : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapModelJob(row: ModelJobRow): ModelJobRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    imageId: row.image_id,
    agentTaskId: row.agent_task_id,
    jobType: row.job_type,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    input: parseJson(row.input_json, {}),
    output: row.output_json ? parseJson(row.output_json, {}) : null,
    error: row.error_json ? parseJson(row.error_json, {}) : null,
    modelName: row.model_name,
    modelVersion: row.model_version,
    weightsHash: row.weights_hash,
    artifactUri: row.artifact_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapNodule(row: NoduleRow): NoduleRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    imageId: row.image_id,
    noduleIndex: row.nodule_index,
    location: row.location,
    bbox: parseJsonValue(row.bbox),
    maskUri: row.mask_uri,
    detectionConfidence: row.detection_confidence,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMeasurement(row: MeasurementRow): MeasurementRecord {
  return {
    id: row.id,
    noduleId: row.nodule_id,
    longAxisMm: row.long_axis_mm,
    shortAxisMm: row.short_axis_mm,
    apAxisMm: row.ap_axis_mm,
    areaMm2: row.area_mm2,
    aspectRatio: row.aspect_ratio,
    measurementSource: row.measurement_source,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

function mapTiradsFeature(row: TiradsFeatureRow): TiradsFeatureRecord {
  return {
    id: row.id,
    noduleId: row.nodule_id,
    systemName: row.system_name,
    features: parseJson(row.features, {}),
    confidence: parseJson(row.confidence, {}),
    sourceModel: row.source_model,
    requiresReview: row.requires_review === 1,
    createdAt: row.created_at,
  };
}

function mapTiradsResult(row: TiradsResultRow): TiradsResultRecord {
  return {
    id: row.id,
    noduleId: row.nodule_id,
    systemName: row.system_name,
    systemVersion: row.system_version,
    score: row.score,
    category: row.category,
    recommendation: row.recommendation,
    evidenceRules: parseJsonArray(row.evidence_rules),
    warnings: parseStringArray(row.warnings),
    createdAt: row.created_at,
  };
}

function mapTiradsRule(row: TiradsRuleRow): TiradsRuleRecord {
  return {
    id: row.id,
    systemName: row.system_name,
    systemVersion: row.system_version,
    ruleCode: row.rule_code,
    featureGroup: row.feature_group,
    featureName: row.feature_name,
    points: row.points,
    category: row.category,
    minScore: row.min_score,
    maxScore: row.max_score,
    recommendation: row.recommendation,
    rule: parseJson(row.rule_json, {}),
    evidenceDocumentId: row.evidence_document_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReport(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    analysisSessionId: row.analysis_session_id,
    reportType: row.report_type,
    status: row.status,
    templateId: row.template_id,
    draftText: row.draft_text,
    finalText: row.final_text,
    structured: parseJson(row.structured_json, {}),
    evidence: parseJsonArray(row.evidence_json),
    createdByAgent: row.created_by_agent,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSafetyRule(row: SafetyRuleRow): SafetyRuleRecord {
  return {
    id: row.id,
    ruleCode: row.rule_code,
    ruleType: row.rule_type,
    severity: row.severity,
    pattern: row.pattern,
    rule: parseJson(row.rule_json, {}),
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAuditLog(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: parseJson(row.detail_json, {}),
    traceId: row.trace_id,
    createdAt: row.created_at,
  };
}

function mapDoctorReview(row: DoctorReviewRow): DoctorReviewRecord {
  return {
    id: row.id,
    reportId: row.report_id,
    reviewerName: row.reviewer_name,
    action: row.action,
    comment: row.comment,
    before: row.before_json ? parseJson(row.before_json, {}) : null,
    after: row.after_json ? parseJson(row.after_json, {}) : null,
    createdAt: row.created_at,
  };
}

function mapFinalValidationRun(row: FinalValidationRunRow): FinalValidationRunRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    datasetRoot: row.dataset_root,
    datasetManifestUri: row.dataset_manifest_uri,
    caseId: row.case_id,
    pipelineMode: row.pipeline_mode,
    status: row.status,
    remoteModelGatewayUrl: row.remote_model_gateway_url,
    dataDbPath: row.data_db_path,
    ragDbPath: row.rag_db_path,
    reportJsonUri: row.report_json_uri,
    reportMarkdownUri: row.report_markdown_uri,
    summary: parseJson(row.summary_json, {}),
    createdBy: row.created_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFinalValidationImageResult(row: FinalValidationImageResultRow): FinalValidationImageResultRecord {
  return {
    id: row.id,
    runId: row.run_id,
    studyId: row.study_id,
    imageId: row.image_id,
    analysisSessionId: row.analysis_session_id,
    datasetImageId: row.dataset_image_id,
    datasetLabel: row.dataset_label,
    sourceRelativePath: row.source_relative_path,
    artifactUri: row.artifact_uri,
    localStagedPath: row.local_staged_path,
    remoteUpload: parseJson(row.remote_upload_json, {}),
    expected: parseJson(row.expected_json, {}),
    detection: parseJson(row.detection_json, {}),
    measurement: parseJson(row.measurement_json, {}),
    tirads: parseJson(row.tirads_json, {}),
    report: parseJson(row.report_json, {}),
    safetyReview: parseJson(row.safety_review_json, {}),
    modelArtifacts: parseJsonArray(row.model_artifacts_json),
    taskEvents: parseJsonArray(row.task_events_json),
    note: row.note,
    status: row.status,
    error: row.error_json ? parseJson(row.error_json, {}) : null,
    reviewStatus: row.review_status,
    reviewComment: row.review_comment,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function reportReviewSnapshot(report: ReportRecord): JsonObject {
  return {
    id: report.id,
    study_id: report.studyId,
    status: report.status,
    draft_text: report.draftText,
    final_text: report.finalText,
    structured: report.structured,
    structured_sections: reportStructuredSections(report),
    evidence: report.evidence,
    evidence_count: report.evidence.length,
    evidence_sources: reportEvidenceSources(report),
    confirmed_by: report.confirmedBy,
    confirmed_at: report.confirmedAt,
    updated_at: report.updatedAt,
  };
}

function reportStatusForReviewAction(action: ReportReviewAction): string {
  if (action === "reject") return "rejected";
  if (action === "revise") return "pending_review";
  if (action === "archive") return "archived";
  return "confirmed";
}

function assertReportReviewActionAllowed(report: ReportRecord, action: ReportReviewAction): void {
  if (action === "archive") {
    if (report.status !== "confirmed") throw new Error("only confirmed reports can be archived");
    return;
  }
  if (report.status !== "draft" && report.status !== "pending_review") {
    throw new Error("only draft or pending_review reports can be reviewed");
  }
}

function reportStructuredSections(report: ReportRecord): unknown[] {
  const sections = report.structured.sections;
  return Array.isArray(sections) ? sections : [];
}

function reportEvidenceSources(report: ReportRecord): string[] {
  const sources = new Set<string>();
  for (const item of report.evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = (item as JsonObject).source;
    if (typeof source === "string" && source.length > 0) sources.add(source);
  }
  return Array.from(sources);
}

function stringifyJson(value: JsonObject): string {
  return JSON.stringify(value);
}

function stringifyJsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson(value: string | null | undefined, fallback: JsonObject): JsonObject {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonValue(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function parseStringArray(value: string | null | undefined): string[] {
  return parseJsonArray(value).filter((item): item is string => typeof item === "string");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
