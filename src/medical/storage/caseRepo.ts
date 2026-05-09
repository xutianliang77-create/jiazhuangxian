import type Database from "better-sqlite3";
import { ulid } from "ulid";

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

export type ReportReviewAction = "approve" | "revise" | "reject";

export interface ReportReviewInput {
  id?: string;
  reportId: string;
  reviewerName: string;
  action: ReportReviewAction;
  comment?: string | null;
  finalText?: string | null;
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

export interface StudyBundle {
  patient: PatientRecord | null;
  study: StudyRecord;
  images: ImageRecord[];
  nodules: NoduleRecord[];
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

  reviewReport(input: ReportReviewInput): { report: ReportRecord; doctorReview: DoctorReviewRecord } {
    const now = input.now ?? Date.now();
    const id = input.id ?? ulid();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.getReport(input.reportId);
      if (!before) throw new Error(`Report not found: ${input.reportId}`);
      const nextStatus = input.action === "reject" ? "rejected" : "confirmed";
      const nextFinalText = input.action === "reject" ? before.finalText : input.finalText ?? before.finalText ?? before.draftText;
      const confirmedBy = input.action === "reject" ? null : input.reviewerName;
      const confirmedAt = input.action === "reject" ? null : now;
      this.db
        .prepare<[string, string | null, string | null, number | null, number, string]>(
          `UPDATE report
           SET status = ?, final_text = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextStatus, nextFinalText ?? null, confirmedBy, confirmedAt, now, input.reportId);
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

function reportReviewSnapshot(report: ReportRecord): JsonObject {
  return {
    id: report.id,
    study_id: report.studyId,
    status: report.status,
    draft_text: report.draftText,
    final_text: report.finalText,
    confirmed_by: report.confirmedBy,
    confirmed_at: report.confirmedAt,
    updated_at: report.updatedAt,
  };
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
