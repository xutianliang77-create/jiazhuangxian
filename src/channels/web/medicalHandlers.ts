import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type Database from "better-sqlite3";

import {
  MedicalCaseRepo,
  type ImageInput,
  type PatientInput,
  type ReportReviewAction,
  type StudyInput,
} from "../../medical/storage/caseRepo";
import { authenticate, jsonResponse, readJsonBody, type HandlerDeps } from "./handlers";

type JsonObject = Record<string, unknown>;

interface CountRow {
  count: number;
}

interface StatusCountRow {
  status: string;
  count: number;
}

interface RecentStudyRow {
  id: string;
  patient_id: string | null;
  external_patient_id: string | null;
  accession_no: string | null;
  modality: string;
  body_part: string;
  study_time: number | null;
  status: string;
  source_type: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  image_count: number;
  nodule_count: number;
  latest_analysis_status: string | null;
  latest_report_status: string | null;
}

const MEDICAL_ANALYSIS_TASKS = [
  { agentName: "ImageQcAgent", taskType: "image_qc", toolName: "thyroid.ImageQC" },
  { agentName: "NoduleDetectionAgent", taskType: "detect_nodules", toolName: "thyroid.DetectNodules" },
  {
    agentName: "TiradsFeatureAgent",
    taskType: "classify_tirads_features",
    toolName: "thyroid.ClassifyTiradsFeatures",
  },
  { agentName: "TiradsRuleAgent", taskType: "calculate_tirads", toolName: "thyroid.CalculateTirads" },
  { agentName: "ReportDraftAgent", taskType: "draft_report", toolName: "medical.GetReportTemplate" },
  { agentName: "SafetyReviewAgent", taskType: "safety_review", toolName: "medical.SearchGuideline" },
] as const;

export async function handleMedicalSummary(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL
): Promise<void> {
  if (!authenticate(req, res, deps)) return;
  if (!deps.dataDb) {
    jsonResponse(res, 200, {
      enabled: false,
      message: "medical storage disabled (no data.db)",
      counts: emptyCounts(),
      queues: emptyQueues(),
      recentStudies: [],
      warnings: ["data_db_not_configured"],
    });
    return;
  }

  try {
    const limit = queryLimit(url, 12, 50);
    jsonResponse(res, 200, {
      enabled: true,
      counts: readCounts(deps.dataDb),
      queues: readQueues(deps.dataDb),
      recentStudies: readRecentStudies(deps.dataDb, limit),
      warnings: [],
    });
  } catch (err) {
    jsonResponse(res, 503, {
      error: {
        code: "medical-schema-unavailable",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

export async function handleReadMedicalStudy(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  studyId: string
): Promise<void> {
  const ctx = authenticateMedicalStorage(req, res, deps);
  if (!ctx) return;

  try {
    const repo = new MedicalCaseRepo(ctx.db);
    const bundle = repo.getStudyBundle(studyId);
    if (!bundle) {
      throw new MedicalRequestError(404, "study-not-found", `study not found: ${studyId}`);
    }
    jsonResponse(res, 200, { bundle });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleCreateMedicalPatient(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const patient = repo.upsertPatient(patientInput(body));
    jsonResponse(res, 201, { patient });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleCreateMedicalStudy(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const study = repo.createStudy({
      ...studyInput(body),
      createdBy: stringField(body, "createdBy", "created_by") ?? ctx.userId,
    });
    jsonResponse(res, 201, { study });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleCreateMedicalImage(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const image = repo.addImage(imageInput(body));
    jsonResponse(res, 201, { image });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleStartMedicalAnalysis(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  studyId: string
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const bundle = repo.getStudyBundle(studyId);
    if (!bundle) {
      throw new MedicalRequestError(404, "study-not-found", `study not found: ${studyId}`);
    }

    const requestedImageId = stringField(body, "imageId", "image_id");
    const image = requestedImageId
      ? bundle.images.find((candidate) => candidate.id === requestedImageId)
      : bundle.images[0];
    if (requestedImageId && !image) {
      throw new MedicalRequestError(400, "invalid-reference", "image does not belong to study");
    }
    if (!image) {
      throw new MedicalRequestError(400, "image-required", "study must have a registered image before analysis");
    }

    const now = Date.now();
    const analysisSession = repo.createAnalysisSession({
      studyId,
      status: "queued",
      triggerSource: stringField(body, "triggerSource", "trigger_source") ?? "web_manual",
      createdBy: ctx.userId,
      summary: {
        selected_image_id: image.id,
        task_count: MEDICAL_ANALYSIS_TASKS.length,
        task_types: MEDICAL_ANALYSIS_TASKS.map((task) => task.taskType),
      },
      now,
    });

    let parentTaskId: string | undefined;
    const agentTasks = MEDICAL_ANALYSIS_TASKS.map((task, index) => {
      const created = repo.createAgentTask({
        analysisSessionId: analysisSession.id,
        parentTaskId,
        agentName: task.agentName,
        taskType: task.taskType,
        status: "queued",
        input: {
          study_id: studyId,
          image_id: image.id,
          tool_name: task.toolName,
          sequence: index + 1,
          source: "web_manual_analysis",
        },
        now: now + index,
      });
      parentTaskId = created.id;
      return created;
    });

    jsonResponse(res, 201, {
      analysisSession,
      agentTasks,
      bundle: repo.getStudyBundle(studyId),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleReviewMedicalReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  reportId: string
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const report = repo.getReport(reportId);
    if (!report) {
      throw new MedicalRequestError(404, "report-not-found", `report not found: ${reportId}`);
    }
    const action = reviewAction(body);
    const reviewerName = stringField(body, "reviewerName", "reviewer_name") ?? ctx.userId;
    const comment = stringField(body, "comment");
    const finalText = stringField(body, "finalText", "final_text");
    const now = Date.now();
    const reviewed = repo.reviewReport({
      reportId,
      reviewerName,
      action,
      comment,
      finalText,
      now,
    });
    const auditLog = repo.createAuditLog({
      studyId: reviewed.report.studyId,
      actorType: "doctor",
      actorId: reviewerName,
      action: `medical.report.${action}`,
      targetType: "report",
      targetId: reportId,
      detail: {
        doctor_review_id: reviewed.doctorReview.id,
        report_status: reviewed.report.status,
        comment: comment ?? null,
      },
      traceId: reviewed.doctorReview.id,
      now,
    });
    jsonResponse(res, 200, {
      report: reviewed.report,
      doctorReview: reviewed.doctorReview,
      auditLog,
      bundle: repo.getStudyBundle(reviewed.report.studyId),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

function readCounts(db: Database.Database): Record<string, number> {
  return {
    patients: count(db, "patient"),
    studies: count(db, "study"),
    images: count(db, "image"),
    analysisSessions: count(db, "analysis_session"),
    nodules: count(db, "nodule"),
    reports: count(db, "report"),
    pendingReviews: count(db, "report", "status IN ('draft', 'pending_review')"),
  };
}

function readQueues(db: Database.Database): Record<string, Record<string, number>> {
  return {
    modelJobs: statusCounts(db, "model_job"),
    agentTasks: statusCounts(db, "agent_task"),
  };
}

function readRecentStudies(db: Database.Database, limit: number): Array<Record<string, unknown>> {
  return db
    .prepare<[number], RecentStudyRow>(
      `SELECT
         s.id,
         s.patient_id,
         p.external_patient_id,
         s.accession_no,
         s.modality,
         s.body_part,
         s.study_time,
         s.status,
         s.source_type,
         s.created_by,
         s.created_at,
         s.updated_at,
         (SELECT COUNT(*) FROM image i WHERE i.study_id = s.id) AS image_count,
         (SELECT COUNT(*) FROM nodule n WHERE n.study_id = s.id) AS nodule_count,
         (
           SELECT a.status
           FROM analysis_session a
           WHERE a.study_id = s.id
           ORDER BY a.updated_at DESC, a.created_at DESC, a.id DESC
           LIMIT 1
         ) AS latest_analysis_status,
         (
           SELECT r.status
           FROM report r
           WHERE r.study_id = s.id
           ORDER BY r.updated_at DESC, r.created_at DESC, r.id DESC
           LIMIT 1
         ) AS latest_report_status
       FROM study s
       LEFT JOIN patient p ON p.id = s.patient_id
       ORDER BY s.updated_at DESC, s.created_at DESC, s.id DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      externalPatientId: row.external_patient_id,
      accessionNo: row.accession_no,
      modality: row.modality,
      bodyPart: row.body_part,
      studyTime: row.study_time,
      status: row.status,
      sourceType: row.source_type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      imageCount: row.image_count,
      noduleCount: row.nodule_count,
      latestAnalysisStatus: row.latest_analysis_status,
      latestReportStatus: row.latest_report_status,
    }));
}

function count(db: Database.Database, table: string, where?: string): number {
  const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return (db.prepare(sql).get() as CountRow).count;
}

function statusCounts(db: Database.Database, table: string): Record<string, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status ORDER BY status ASC`)
    .all() as StatusCountRow[];
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function queryLimit(url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.trunc(value))) : fallback;
}

function emptyCounts(): Record<string, number> {
  return {
    patients: 0,
    studies: 0,
    images: 0,
    analysisSessions: 0,
    nodules: 0,
    reports: 0,
    pendingReviews: 0,
  };
}

function emptyQueues(): Record<string, Record<string, number>> {
  return {
    modelJobs: {},
    agentTasks: {},
  };
}

function authenticateMedicalWrite(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): { db: Database.Database; userId: string } | null {
  return authenticateMedicalStorage(req, res, deps);
}

function authenticateMedicalStorage(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): { db: Database.Database; userId: string } | null {
  const auth = authenticate(req, res, deps);
  if (!auth) return null;
  if (!deps.dataDb) {
    jsonResponse(res, 503, {
      error: {
        code: "medical-storage-disabled",
        message: "medical storage disabled (no data.db)",
      },
    });
    return null;
  }
  return { db: deps.dataDb, userId: auth.userId };
}

function patientInput(body: JsonObject): PatientInput {
  return {
    id: stringField(body, "id"),
    externalPatientId: stringField(body, "externalPatientId", "external_patient_id"),
    nameHash: stringField(body, "nameHash", "name_hash"),
    sex: stringField(body, "sex"),
    birthYear: numberField(body, "birthYear", "birth_year"),
    deidentified: booleanField(body, "deidentified"),
    meta: objectField(body, "meta", "meta_json"),
  };
}

function studyInput(body: JsonObject): StudyInput {
  return {
    id: stringField(body, "id"),
    patientId: stringField(body, "patientId", "patient_id"),
    accessionNo: stringField(body, "accessionNo", "accession_no"),
    studyInstanceUid: stringField(body, "studyInstanceUid", "study_instance_uid"),
    modality: stringField(body, "modality"),
    bodyPart: stringField(body, "bodyPart", "body_part"),
    studyTime: numberField(body, "studyTime", "study_time"),
    status: stringField(body, "status"),
    clinicalContext: stringField(body, "clinicalContext", "clinical_context"),
    sourceType: stringField(body, "sourceType", "source_type") ?? "manual",
  };
}

function imageInput(body: JsonObject): ImageInput {
  return {
    id: stringField(body, "id"),
    studyId: requiredString(body, "studyId", "study_id"),
    seriesInstanceUid: stringField(body, "seriesInstanceUid", "series_instance_uid"),
    sopInstanceUid: stringField(body, "sopInstanceUid", "sop_instance_uid"),
    fileUri: requiredString(body, "fileUri", "file_uri"),
    previewUri: stringField(body, "previewUri", "preview_uri"),
    modelReadyUri: stringField(body, "modelReadyUri", "model_ready_uri"),
    fileType: stringField(body, "fileType", "file_type"),
    checksumSha256: stringField(body, "checksumSha256", "checksum_sha256"),
    width: numberField(body, "width"),
    height: numberField(body, "height"),
    pixelSpacing: objectField(body, "pixelSpacing", "pixel_spacing"),
    dicomMetadata: objectField(body, "dicomMetadata", "dicom_metadata"),
    imageQuality: stringField(body, "imageQuality", "image_quality"),
    qualityScore: numberField(body, "qualityScore", "quality_score"),
    processingStatus: stringField(body, "processingStatus", "processing_status"),
  };
}

function reviewAction(body: JsonObject): ReportReviewAction {
  const action = requiredString(body, "action");
  if (action === "approve" || action === "revise" || action === "reject") return action;
  throw new MedicalRequestError(400, "invalid-request", "action must be approve, revise, or reject");
}

function requireBodyObject(body: unknown): JsonObject {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MedicalRequestError(400, "invalid-request", "JSON body must be an object");
  }
  return body as JsonObject;
}

function requiredString(body: JsonObject, camelKey: string, snakeKey?: string): string {
  const value = stringField(body, camelKey, snakeKey);
  if (!value) throw new MedicalRequestError(400, "invalid-request", `${camelKey} is required`);
  return value;
}

function stringField(body: JsonObject, camelKey: string, snakeKey?: string): string | undefined {
  const value = body[camelKey] ?? (snakeKey ? body[snakeKey] : undefined);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new MedicalRequestError(400, "invalid-request", `${camelKey} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberField(body: JsonObject, camelKey: string, snakeKey?: string): number | undefined {
  const value = body[camelKey] ?? (snakeKey ? body[snakeKey] : undefined);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MedicalRequestError(400, "invalid-request", `${camelKey} must be a finite number`);
  }
  return value;
}

function booleanField(body: JsonObject, camelKey: string, snakeKey?: string): boolean | undefined {
  const value = body[camelKey] ?? (snakeKey ? body[snakeKey] : undefined);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new MedicalRequestError(400, "invalid-request", `${camelKey} must be a boolean`);
  }
  return value;
}

function objectField(body: JsonObject, camelKey: string, snakeKey?: string): JsonObject | undefined {
  const value = body[camelKey] ?? (snakeKey ? body[snakeKey] : undefined);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new MedicalRequestError(400, "invalid-request", `${camelKey} must be an object`);
  }
  return value as JsonObject;
}

function medicalWriteError(res: ServerResponse, err: unknown): void {
  if (err instanceof MedicalRequestError) {
    jsonResponse(res, err.status, { error: { code: err.code, message: err.message } });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SyntaxError) {
    jsonResponse(res, 400, {
      error: { code: "invalid-json", message },
    });
    return;
  }
  if (/body too large/i.test(message)) {
    jsonResponse(res, 413, {
      error: { code: "request-too-large", message },
    });
    return;
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    jsonResponse(res, 400, {
      error: { code: "invalid-reference", message },
    });
    return;
  }
  if (/UNIQUE constraint failed/i.test(message)) {
    jsonResponse(res, 409, {
      error: { code: "duplicate-medical-record", message },
    });
    return;
  }
  jsonResponse(res, 503, {
    error: {
      code: "medical-schema-unavailable",
      message,
    },
  });
}

class MedicalRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
