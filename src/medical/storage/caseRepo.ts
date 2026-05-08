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

export interface StudyBundle {
  patient: PatientRecord | null;
  study: StudyRecord;
  images: ImageRecord[];
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
    return { patient, study, images, analysisSessions, agentTasks };
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

function stringifyJson(value: JsonObject): string {
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
