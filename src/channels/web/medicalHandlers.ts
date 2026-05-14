import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import type Database from "better-sqlite3";

import {
  MedicalCaseRepo,
  type AgentTaskRecord,
  type AnalysisSessionRecord,
  type AuditLogRecord,
  type ImageInput,
  type ModelJobRecord,
  type NoduleRevisionResult,
  type NoduleRecord,
  type PatientInput,
  type ReportRecord,
  type ReportReviewAction,
  type StudyBundle,
  type StudyInput,
  type TiradsFeatureInput,
  type TiradsFeatureRecord,
} from "../../medical/storage/caseRepo";
import { runMedicalAgentWorkerOnceAsync } from "../../medical/agentWorker";
import { searchMedicalKnowledge } from "../../medical/knowledge/search";
import { loadRuntimeSelection } from "../../provider/registry";
import type { ProviderStatus } from "../../provider/types";
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

interface StudyOpenTaskRow {
  task_type: string;
  status: string;
}

interface StudyQueueState {
  queueStage: string;
  queueReason: string;
  queuePriority: number;
}

const MEDICAL_ANALYSIS_TASKS = [
  { agentName: "ImageQcAgent", taskType: "image_qc", toolName: "thyroid.ImageQC" },
  { agentName: "NoduleDetectionAgent", taskType: "detect_nodules", toolName: "thyroid.DetectNodules" },
  { agentName: "SegmentationAgent", taskType: "segment_nodules", toolName: "thyroid.SegmentNodule" },
  { agentName: "MeasurementAgent", taskType: "measure_nodules", toolName: "thyroid.MeasureNodule" },
  {
    agentName: "TiradsFeatureAgent",
    taskType: "classify_tirads_features",
    toolName: "thyroid.ClassifyTiradsFeatures",
  },
  { agentName: "TiradsRuleAgent", taskType: "calculate_tirads", toolName: "thyroid.CalculateTirads" },
  { agentName: "ReportDraftAgent", taskType: "draft_report", toolName: "medical.GetReportTemplate" },
  { agentName: "SafetyReviewAgent", taskType: "safety_review", toolName: "medical.SearchGuideline" },
] as const;

const DOCTOR_BBOX_REVISION_TASKS = [
  {
    agentName: "SegmentationAgent",
    taskType: "segment_nodules",
    toolName: "thyroid.SegmentNodule",
    model: "nnunet-tight-roi-segmenter",
    modelVersion: "tn3k-tight-roi-5fold-best",
  },
  {
    agentName: "MeasurementAgent",
    taskType: "measure_nodules",
    toolName: "thyroid.MeasureNodule",
    model: "mask-measurement-worker",
    modelVersion: "validation-measurement-v1",
  },
  { agentName: "ReportDraftAgent", taskType: "draft_report", toolName: "medical.GetReportTemplate" },
] as const;

const DOCTOR_TIRADS_FEATURE_TASKS = [
  { agentName: "TiradsRuleAgent", taskType: "calculate_tirads", toolName: "thyroid.CalculateTirads" },
  { agentName: "ReportDraftAgent", taskType: "draft_report", toolName: "medical.GetReportTemplate" },
  { agentName: "SafetyReviewAgent", taskType: "safety_review", toolName: "medical.SearchGuideline" },
] as const;

const TIRADS_FEATURE_ENUMS: Record<string, Set<string>> = {
  composition: new Set(["cystic", "almost_completely_cystic", "spongiform", "mixed_cystic_solid", "solid", "almost_completely_solid"]),
  echogenicity: new Set(["anechoic", "hyperechoic", "isoechoic", "hypoechoic", "very_hypoechoic"]),
  shape: new Set(["wider_than_tall", "taller_than_wide"]),
  margin: new Set(["smooth", "ill_defined", "lobulated", "irregular", "extrathyroidal_extension"]),
  echogenic_foci: new Set(["none", "large_comet_tail", "macrocalcifications", "peripheral_rim_calcifications", "punctate_echogenic_foci"]),
};

const MEDICAL_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024;
const REMOTE_MEDICAL_ARTIFACT_TIMEOUT_MS = 5000;
const MEDICAL_WEB_AUTO_RUN_MAX_STEPS = 600;
const MEDICAL_WEB_AUTO_RUN_INTERVAL_MS = 2000;
const MEDICAL_WEB_AUTO_RUN_WORKER_ID = "medical-web-auto-runner";
const MEDICAL_QWEN_PROVIDER_ID = "lmstudio:qwen35-9b";
const MEDICAL_QWEN_MODEL = "qwen/qwen3.5-9b";
const REQUIRED_TIRADS_FEATURE_KEYS = ["composition", "echogenicity", "shape", "margin", "echogenic_foci"] as const;
const activeMedicalAutoRuns = new Set<string>();
const MEDICAL_ARTIFACT_MIME: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

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

export async function handleMedicalModelGatewayCheck(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): Promise<void> {
  if (!authenticate(req, res, deps)) return;

  const gatewayUrl = modelGatewayBaseUrl();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${gatewayUrl}/model/v1/config/check`, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => null) as unknown;
    const payloadObject = isJsonObject(payload) ? payload : {};
    const warnings = stringArray(payloadObject.warnings);
    if (!response.ok) {
      jsonResponse(res, 200, {
        gatewayUrl,
        reachable: true,
        httpStatus: response.status,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        result: null,
        warnings: [...warnings, "model_gateway_http_error"],
        error: {
          code: "model-gateway-http-error",
          message: `model-gateway config check returned HTTP ${response.status}`,
        },
      });
      return;
    }
    jsonResponse(res, 200, {
      gatewayUrl,
      reachable: true,
      httpStatus: response.status,
      checkedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      result: isJsonObject(payloadObject.result) ? payloadObject.result : payloadObject,
      warnings,
    });
  } catch (err) {
    jsonResponse(res, 200, {
      gatewayUrl,
      reachable: false,
      httpStatus: null,
      checkedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      result: null,
      warnings: ["model_gateway_unreachable"],
      error: {
        code: "model-gateway-unreachable",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function handleMedicalKnowledgeSearch(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): Promise<void> {
  if (!authenticate(req, res, deps)) return;
  if (!deps.dataDb) {
    jsonResponse(res, 200, {
      enabled: false,
      mode: "bm25",
      query: "",
      count: 0,
      evidence: [],
      warnings: ["data_db_not_configured"],
    });
    return;
  }

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const query = requiredString(body, "query");
    const result = searchMedicalKnowledge({
      query,
      topK: numberField(body, "topK", "top_k"),
      filters: medicalKnowledgeFilters(body),
    }, {
      dataDb: deps.dataDb,
      dataDbPath: deps.dataDbPath,
      workspace: deps.workspace,
    });
    jsonResponse(res, 200, result);
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleListMedicalFinalValidationRuns(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL
): Promise<void> {
  const ctx = authenticateMedicalStorage(req, res, deps);
  if (!ctx) return;

  try {
    const repo = new MedicalCaseRepo(ctx.db);
    const runs = repo.listFinalValidationRuns(queryLimit(url, 20, 100));
    jsonResponse(res, 200, {
      runs,
      reviewQueues: readFinalValidationReviewQueues(ctx.db),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleListMedicalFinalValidationResults(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL,
  runId: string
): Promise<void> {
  const ctx = authenticateMedicalStorage(req, res, deps);
  if (!ctx) return;

  try {
    const repo = new MedicalCaseRepo(ctx.db);
    const run = repo.getFinalValidationRun(runId);
    if (!run) throw new MedicalRequestError(404, "final-validation-run-not-found", `final validation run not found: ${runId}`);
    const reviewStatus = finalValidationReviewStatus(url.searchParams.get("reviewStatus") ?? url.searchParams.get("review_status"), {
      optional: true,
    });
    const status = url.searchParams.get("status")?.trim() || undefined;
    const results = repo.listFinalValidationImageResults(runId, {
      reviewStatus,
      status,
      limit: queryLimit(url, 100, 500),
    });
    jsonResponse(res, 200, {
      run,
      results,
      reviewCounts: countFinalValidationReviewStatus(ctx.db, runId),
      statusCounts: countFinalValidationResultStatus(ctx.db, runId),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleReviewMedicalFinalValidationResult(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  resultId: string
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const reviewStatus = finalValidationReviewStatus(requiredString(body, "reviewStatus", "review_status"));
    const repo = new MedicalCaseRepo(ctx.db);
    const result = repo.reviewFinalValidationImageResult({
      resultId,
      reviewStatus,
      reviewComment: stringField(body, "comment", "review_comment") ?? null,
      reviewedBy: stringField(body, "reviewedBy", "reviewed_by") ?? ctx.userId,
    });
    const auditLog = repo.createAuditLog({
      studyId: result.studyId,
      actorType: "doctor",
      actorId: result.reviewedBy ?? ctx.userId,
      action: "medical.final_validation.review",
      targetType: "final_validation_image_result",
      targetId: result.id,
      detail: {
        run_id: result.runId,
        dataset_image_id: result.datasetImageId,
        dataset_label: result.datasetLabel,
        review_status: result.reviewStatus,
        review_comment: result.reviewComment,
      },
      traceId: result.id,
    });
    jsonResponse(res, 200, { result, auditLog });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleReadMedicalArtifact(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL
): Promise<void> {
  if (!authenticate(req, res, deps)) return;

  try {
    const artifactUri = url.searchParams.get("uri")?.trim();
    if (!artifactUri) {
      throw new MedicalRequestError(400, "invalid-request", "uri is required");
    }
    const artifactPath = resolveMedicalArtifactPath(artifactUri, deps);
    let stat;
    try {
      stat = statSync(artifactPath);
    } catch {
      const cached = await cacheRemoteMedicalArtifact(artifactUri, artifactPath);
      if (!cached) {
        throw new MedicalRequestError(404, "artifact-not-found", "artifact was not found");
      }
      stat = statSync(artifactPath);
    }
    if (!stat.isFile()) {
      throw new MedicalRequestError(404, "artifact-not-found", "artifact was not found");
    }
    if (stat.size > MEDICAL_ARTIFACT_MAX_BYTES) {
      throw new MedicalRequestError(413, "artifact-too-large", "artifact exceeds validation preview size limit");
    }
    const ext = path.extname(artifactPath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("content-type", MEDICAL_ARTIFACT_MIME[ext] ?? "application/octet-stream");
    res.setHeader("content-length", String(stat.size));
    res.setHeader("cache-control", "no-store");
    res.end(readFileSync(artifactPath));
  } catch (err) {
    medicalWriteError(res, err);
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
    const bundle = readMedicalStudyBundle(repo, studyId);
    if (!bundle) {
      throw new MedicalRequestError(404, "study-not-found", `study not found: ${studyId}`);
    }
    if (hasAutoRunnableMedicalWork(ctx.db, studyId)) {
      scheduleMedicalWebAutoRun(deps, studyId, "study_read_resume");
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

    const autoRun = scheduleMedicalWebAutoRun(deps, studyId, "analysis_started");
    jsonResponse(res, 201, {
      analysisSession,
      agentTasks,
      autoRun,
      bundle: readMedicalStudyBundle(repo, studyId),
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
    const structured = objectField(body, "structured") ?? undefined;
    if (action === "archive" && report.status !== "confirmed") {
      throw new MedicalRequestError(400, "invalid-request", "only confirmed reports can be archived");
    }
    if (action !== "archive" && report.status !== "draft" && report.status !== "pending_review") {
      throw new MedicalRequestError(400, "invalid-request", "only draft or pending_review reports can be reviewed");
    }
    const now = Date.now();
    const reviewed = repo.reviewReport({
      reportId,
      reviewerName,
      action,
      comment,
      finalText,
      structured,
      now,
    });
    const structuredSections = Array.isArray(reviewed.report.structured.sections)
      ? reviewed.report.structured.sections.length
      : 0;
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
        evidence_count: reviewed.report.evidence.length,
        evidence_sources: reportEvidenceSources(reviewed.report),
        structured_section_count: structuredSections,
        report_text_length: (reviewed.report.finalText ?? reviewed.report.draftText ?? "").length,
        comment: comment ?? null,
      },
      traceId: reviewed.doctorReview.id,
      now,
    });
    jsonResponse(res, 200, {
      report: reviewed.report,
      doctorReview: reviewed.doctorReview,
      auditLog,
      bundle: readMedicalStudyBundle(repo, reviewed.report.studyId),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleReviseMedicalNodule(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  noduleId: string
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const existingNodule = repo.getNodule(noduleId);
    if (!existingNodule) {
      throw new MedicalRequestError(404, "nodule-not-found", `nodule not found: ${noduleId}`);
    }
    const existingImage = existingNodule.imageId ? repo.getImage(existingNodule.imageId) : null;
    if (!existingImage || existingImage.studyId !== existingNodule.studyId) {
      throw new MedicalRequestError(400, "image-required", "nodule must be linked to an image before segmentation rerun");
    }

    const bbox = requiredBbox(body);
    const location = stringField(body, "location");
    const status = stringField(body, "status") ?? "doctor_revised";
    const comment = stringField(body, "comment");
    if (isNoopNoduleRevision(existingNodule, bbox, location)) {
      const auditLog = repo.createAuditLog({
        studyId: existingNodule.studyId,
        actorType: "doctor",
        actorId: ctx.userId,
        action: "medical.nodule.revise.noop",
        targetType: "nodule",
        targetId: noduleId,
        detail: {
          reason: "unchanged_bbox_location",
          bbox,
          location: location ?? existingNodule.location,
          status: existingNodule.status,
          comment: comment ?? null,
        },
        traceId: noduleId,
        now: Date.now(),
      });
      jsonResponse(res, 200, {
        nodule: existingNodule,
        analysisSession: null,
        agentTasks: [],
        auditLog,
        dedupe: { skipped: true, reason: "unchanged_bbox_location" },
        bundle: readMedicalStudyBundle(repo, existingNodule.studyId),
      });
      return;
    }
    const now = Date.now();
    const { revised, analysisSession, agentTasks, auditLog } = ctx.db.transaction(() => {
      const cancelledTaskIds = cancelSupersededMedicalRerunTasks(repo, existingNodule.studyId, noduleId, ["doctor_bbox_revision"], now);
      const revised = repo.reviseNodule({
        noduleId,
        bbox,
        location,
        status,
        now,
      });
      const { analysisSession, agentTasks } = createDoctorBboxRevisionRerun(repo, revised, ctx.userId, now + 1);
      const auditLog = repo.createAuditLog({
        studyId: revised.nodule.studyId,
        actorType: "doctor",
        actorId: ctx.userId,
        action: "medical.nodule.revise",
        targetType: "nodule",
        targetId: noduleId,
        detail: {
          before: noduleAuditSnapshot(revised.before),
          after: noduleAuditSnapshot(revised.nodule),
          comment: comment ?? null,
          cancelled_superseded_task_ids: cancelledTaskIds,
          rerun_analysis_session_id: analysisSession.id,
          rerun_agent_task_ids: agentTasks.map((task) => task.id),
          rerun_task_types: agentTasks.map((task) => task.taskType),
        },
        traceId: noduleId,
        now: now + 4,
      });
      return { revised, analysisSession, agentTasks, auditLog };
    })();
    jsonResponse(res, 200, {
      nodule: revised.nodule,
      analysisSession,
      agentTasks,
      auditLog,
      bundle: readMedicalStudyBundle(repo, revised.nodule.studyId),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

export async function handleSubmitMedicalTiradsFeatures(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  noduleId: string
): Promise<void> {
  const ctx = authenticateMedicalWrite(req, res, deps);
  if (!ctx) return;

  try {
    const body = requireBodyObject(await readJsonBody(req));
    const repo = new MedicalCaseRepo(ctx.db);
    const nodule = repo.getNodule(noduleId);
    if (!nodule) {
      throw new MedicalRequestError(404, "nodule-not-found", `nodule not found: ${noduleId}`);
    }
    const now = Date.now();
    const featureInput = manualTiradsFeatureInput(repo, nodule, body, now);
    const featureSystemName = featureInput.systemName ?? "ACR_TI_RADS";
    const latestFeature = latestTiradsFeatureForNodule(repo, nodule.studyId, nodule.id, featureSystemName);
    if (latestFeature && isSameTiradsFeature(latestFeature, featureInput)) {
      const auditLog = repo.createAuditLog({
        studyId: nodule.studyId,
        actorType: "doctor",
        actorId: ctx.userId,
        action: "medical.tirads_feature.noop",
        targetType: "nodule",
        targetId: noduleId,
        detail: {
          reason: "unchanged_tirads_features",
          tirads_feature_id: latestFeature.id,
          features: latestFeature.features,
          confidence: latestFeature.confidence,
          source_model: latestFeature.sourceModel,
          requires_review: latestFeature.requiresReview,
          comment: stringField(body, "comment") ?? null,
        },
        traceId: latestFeature.id,
        now,
      });
      jsonResponse(res, 200, {
        tiradsFeature: latestFeature,
        analysisSession: null,
        agentTasks: [],
        auditLog,
        dedupe: { skipped: true, reason: "unchanged_tirads_features" },
        bundle: readMedicalStudyBundle(repo, nodule.studyId),
      });
      return;
    }
    const { tiradsFeature, analysisSession, agentTasks, auditLog } = ctx.db.transaction(() => {
      const cancelledTaskIds = cancelSupersededMedicalRerunTasks(repo, nodule.studyId, nodule.id, ["doctor_tirads_feature_input"], now);
      const tiradsFeature = repo.createTiradsFeature(featureInput);
      const { analysisSession, agentTasks } = createDoctorTiradsFeatureRerun(repo, nodule, tiradsFeature.id, ctx.userId, now + 1);
      const auditLog = repo.createAuditLog({
        studyId: nodule.studyId,
        actorType: "doctor",
        actorId: ctx.userId,
        action: "medical.tirads_feature.submit",
        targetType: "nodule",
        targetId: noduleId,
        detail: {
          tirads_feature_id: tiradsFeature.id,
          features: tiradsFeature.features,
          confidence: tiradsFeature.confidence,
          source_model: tiradsFeature.sourceModel,
          requires_review: tiradsFeature.requiresReview,
          cancelled_superseded_task_ids: cancelledTaskIds,
          rerun_analysis_session_id: analysisSession.id,
          rerun_agent_task_ids: agentTasks.map((task) => task.id),
          rerun_task_types: agentTasks.map((task) => task.taskType),
          comment: stringField(body, "comment") ?? null,
        },
        traceId: tiradsFeature.id,
        now: now + 4,
      });
      return { tiradsFeature, analysisSession, agentTasks, auditLog };
    })();
    const autoRun = scheduleMedicalWebAutoRun(deps, nodule.studyId, "tirads_features_submitted");
    jsonResponse(res, 200, {
      tiradsFeature,
      analysisSession,
      agentTasks,
      auditLog,
      autoRun,
      bundle: readMedicalStudyBundle(repo, nodule.studyId),
    });
  } catch (err) {
    medicalWriteError(res, err);
  }
}

function scheduleMedicalWebAutoRun(
  deps: HandlerDeps,
  studyId: string,
  reason: string
): { scheduled: boolean; reason: string; workerId: string } {
  if (!medicalWebAutoRunEnabled()) {
    return { scheduled: false, reason: "medical_web_auto_run_disabled", workerId: MEDICAL_WEB_AUTO_RUN_WORKER_ID };
  }
  if (!deps.dataDb) {
    return { scheduled: false, reason: "medical_storage_unavailable", workerId: MEDICAL_WEB_AUTO_RUN_WORKER_ID };
  }
  if (activeMedicalAutoRuns.has(studyId)) {
    return { scheduled: false, reason: "medical_web_auto_run_already_active", workerId: MEDICAL_WEB_AUTO_RUN_WORKER_ID };
  }

  activeMedicalAutoRuns.add(studyId);
  setTimeout(() => {
    void runMedicalWebAutoRun(deps, studyId, reason).finally(() => {
      activeMedicalAutoRuns.delete(studyId);
    });
  }, 0);
  return { scheduled: true, reason, workerId: MEDICAL_WEB_AUTO_RUN_WORKER_ID };
}

async function runMedicalWebAutoRun(deps: HandlerDeps, studyId: string, reason: string): Promise<void> {
  if (!deps.dataDb) return;
  const repo = new MedicalCaseRepo(deps.dataDb);
  let qwenProvider: ProviderStatus | null = null;

  for (let step = 0; step < MEDICAL_WEB_AUTO_RUN_MAX_STEPS; step += 1) {
    const gate = await medicalAutoRunGate(deps, studyId, qwenProvider);
    if (gate.stop) {
      if (gate.status === "waiting_qwen_model") {
        await sleep(MEDICAL_WEB_AUTO_RUN_INTERVAL_MS);
        continue;
      }
      await writeMedicalAutoRunAudit(repo, studyId, reason, gate, step);
      return;
    }
    qwenProvider = gate.qwenProvider ?? qwenProvider;

    const result = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: MEDICAL_WEB_AUTO_RUN_WORKER_ID,
      remoteModelGatewayUrl: medicalRemoteModelGatewayUrl(),
      dataDbPath: deps.dataDbPath,
      ragDbPath: process.env.JZX_RAG_DB,
      workspace: deps.workspace ?? process.cwd(),
      knowledgeTopK: positiveIntEnv("JZX_MEDICAL_KNOWLEDGE_TOP_K", 3),
      llmProvider: qwenProvider,
    });

    if (result.status === "failed") {
      await writeMedicalAutoRunAudit(repo, studyId, reason, {
        status: "failed",
        detail: { result },
      }, step + 1);
      return;
    }
    if (result.status === "waiting_doctor_input") {
      await writeMedicalAutoRunAudit(repo, studyId, reason, {
        status: "waiting_doctor_tirads_features",
        detail: { result },
      }, step + 1);
      return;
    }
    if (result.status === "idle" && countWaitingModelTasks(deps.dataDb) === 0) {
      await writeMedicalAutoRunAudit(repo, studyId, reason, {
        status: "idle",
        detail: { result },
      }, step + 1);
      return;
    }
    if (result.status === "waiting_model" || result.status === "idle") {
      await sleep(MEDICAL_WEB_AUTO_RUN_INTERVAL_MS);
    }
  }

  await writeMedicalAutoRunAudit(repo, studyId, reason, {
    status: "max_steps_reached",
    detail: { max_steps: MEDICAL_WEB_AUTO_RUN_MAX_STEPS },
  }, MEDICAL_WEB_AUTO_RUN_MAX_STEPS);
}

async function medicalAutoRunGate(
  deps: HandlerDeps,
  studyId: string,
  qwenProvider: ProviderStatus | null
): Promise<{ stop: boolean; status: string; detail: JsonObject; qwenProvider?: ProviderStatus | null }> {
  if (!deps.dataDb) return { stop: true, status: "medical_storage_unavailable", detail: {} };
  if (countWaitingModelTasks(deps.dataDb) > 0) return { stop: false, status: "waiting_model_poll", detail: {} };

  const next = nextRunnableMedicalTask(deps.dataDb);
  if (!next) return { stop: false, status: "no_runnable_task", detail: {} };
  if (next.studyId && next.studyId !== studyId) {
    return { stop: false, status: "other_study_runnable", detail: { task_id: next.id, study_id: next.studyId } };
  }

  if (next.taskType === "calculate_tirads" && !hasConfirmedTiradsFeatures(deps.dataDb, studyId)) {
    return {
      stop: true,
      status: "waiting_doctor_tirads_features",
      detail: {
        task_id: next.id,
        study_id: studyId,
        message: "TI-RADS auto-prefill is waiting for doctor confirmation.",
      },
    };
  }

  if (next.taskType === "draft_report") {
    const provider = qwenProvider ?? await resolveMedicalQwenProvider();
    const readiness = provider ? await checkMedicalQwenReadiness(provider) : null;
    if (!provider || !readiness?.ready) {
      return {
        stop: true,
        status: "waiting_qwen_model",
        detail: {
          task_id: next.id,
          study_id: studyId,
          provider: provider ? providerSnapshot(provider) : null,
          readiness,
          message: `Load ${MEDICAL_QWEN_MODEL} on the 5090 before report generation.`,
        },
      };
    }
    return { stop: false, status: "qwen_ready", detail: { readiness }, qwenProvider: provider };
  }

  return { stop: false, status: "ready", detail: { task_id: next.id, task_type: next.taskType } };
}

function medicalWebAutoRunEnabled(): boolean {
  if (process.env.JZX_MEDICAL_WEB_AUTO_RUN === "0") return false;
  if (process.env.JZX_MEDICAL_WEB_AUTO_RUN === "1") return true;
  return Boolean(medicalRemoteModelGatewayUrl());
}

function hasAutoRunnableMedicalWork(db: Database.Database, studyId: string): boolean {
  if (countWaitingModelTasks(db) > 0) return true;
  const next = nextRunnableMedicalTask(db);
  if (!next || next.studyId !== studyId) return false;
  if (next.taskType === "calculate_tirads" && !hasConfirmedTiradsFeatures(db, studyId)) return false;
  return true;
}

function medicalRemoteModelGatewayUrl(): string | undefined {
  const raw = process.env.JZX_REMOTE_MODEL_GATEWAY_URL?.trim() || process.env.JZX_MODEL_GATEWAY_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

function nextRunnableMedicalTask(db: Database.Database): { id: string; taskType: string; studyId?: string } | null {
  const row = db
    .prepare<[], { id: string; task_type: string; input_json: string }>(
      `SELECT t.id, t.task_type, t.input_json
       FROM agent_task t
       LEFT JOIN agent_task parent ON parent.id = t.parent_task_id
       WHERE t.status = 'queued'
         AND (t.parent_task_id IS NULL OR parent.status = 'succeeded')
       ORDER BY t.created_at ASC, t.id ASC
       LIMIT 1`
    )
    .get();
  if (!row) return null;
  const input = parseJsonObject(row.input_json);
  return { id: row.id, taskType: row.task_type, studyId: stringField(input, "study_id") };
}

function countWaitingModelTasks(db: Database.Database): number {
  return db
    .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM agent_task WHERE status = 'waiting_model'")
    .get()?.count ?? 0;
}

function hasConfirmedTiradsFeatures(db: Database.Database, studyId: string): boolean {
  const repo = new MedicalCaseRepo(db);
  const nodules = repo.listNodulesByStudy(studyId);
  if (nodules.length === 0) return true;
  const latestByNodule = new Map<string, TiradsFeatureRecord>();
  for (const feature of repo.listTiradsFeaturesByStudy(studyId)) {
    if (!latestByNodule.has(feature.noduleId)) latestByNodule.set(feature.noduleId, feature);
  }
  return nodules.every((nodule) => {
    const feature = latestByNodule.get(nodule.id);
    return Boolean(feature && !feature.requiresReview && isCompleteTiradsFeature(feature.features));
  });
}

function isCompleteTiradsFeature(features: JsonObject): boolean {
  return REQUIRED_TIRADS_FEATURE_KEYS.every((key) => {
    const value = features[key];
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
  });
}

async function resolveMedicalQwenProvider(): Promise<ProviderStatus | null> {
  try {
    const runtime = await loadRuntimeSelection();
    const providerId = process.env.JZX_MEDICAL_LLM_PROVIDER?.trim() || MEDICAL_QWEN_PROVIDER_ID;
    const provider = runtime.registry.get(providerId) ?? null;
    return provider?.available ? medicalQwenProviderWithModelOverride(provider) : null;
  } catch {
    return null;
  }
}

function medicalQwenProviderWithModelOverride(provider: ProviderStatus): ProviderStatus {
  const model = process.env.JZX_MEDICAL_QWEN_MODEL?.trim();
  return model ? { ...provider, model } : provider;
}

async function checkMedicalQwenReadiness(provider: ProviderStatus): Promise<JsonObject & { ready: boolean }> {
  if (provider.type !== "lmstudio") {
    return { ready: true, reason: "non_lmstudio_provider_available", model: provider.model };
  }
  const expectedModel = process.env.JZX_MEDICAL_QWEN_MODEL?.trim() || provider.model || MEDICAL_QWEN_MODEL;
  const base = provider.baseUrl.replace(/\/+$/, "");
  const urls = [base.replace(/\/v1$/i, "/api/v0/models"), `${base}/models`];
  for (const url of urls) {
    const result = await checkMedicalModelEndpoint(url, expectedModel);
    if (result.ready || result.matched) return result;
  }
  return { ready: false, matched: false, model: expectedModel, reason: "model_not_listed" };
}

async function checkMedicalModelEndpoint(url: string, expectedModel: string): Promise<JsonObject & { ready: boolean; matched: boolean }> {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ready: false, matched: false, model: expectedModel, url, reason: `http_${response.status}` };
    const body = await response.json() as unknown;
    const model = modelRecords(body).find((item) => modelNameMatches(modelId(item), expectedModel));
    if (!model) return { ready: false, matched: false, model: expectedModel, url, reason: "model_not_listed" };
    const loaded = loadedModelFlag(model);
    return {
      ready: loaded ?? /\/v1\/models$/i.test(url),
      matched: true,
      model: expectedModel,
      url,
      reason: loaded === false ? "model_listed_but_not_loaded" : "model_ready",
    };
  } catch (err) {
    return {
      ready: false,
      matched: false,
      model: expectedModel,
      url,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function modelRecords(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isJsonObject);
  if (!isJsonObject(value)) return [];
  const data = value.data ?? value.models;
  return Array.isArray(data) ? data.filter(isJsonObject) : [];
}

function modelId(value: JsonObject): string | undefined {
  return stringField(value, "id") ?? stringField(value, "model") ?? stringField(value, "name");
}

function modelNameMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = actual.trim().toLowerCase();
  const right = expected.trim().toLowerCase();
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function loadedModelFlag(value: JsonObject): boolean | undefined {
  if (typeof value.loaded === "boolean") return value.loaded;
  if (typeof value.is_loaded === "boolean") return value.is_loaded;
  const state = stringField(value, "state") ?? stringField(value, "status");
  if (!state) return undefined;
  const normalized = state.toLowerCase();
  if (normalized.includes("not") || normalized.includes("unload")) return false;
  if (normalized.includes("load") || normalized === "ready" || normalized === "running") return true;
  return undefined;
}

function providerSnapshot(provider: ProviderStatus): JsonObject {
  return {
    instance_id: provider.instanceId,
    type: provider.type,
    model: provider.model,
    display_name: provider.displayName,
  };
}

async function writeMedicalAutoRunAudit(
  repo: MedicalCaseRepo,
  studyId: string,
  reason: string,
  gate: { status: string; detail: JsonObject },
  steps: number
): Promise<void> {
  try {
    repo.createAuditLog({
      studyId,
      actorType: "agent",
      actorId: MEDICAL_WEB_AUTO_RUN_WORKER_ID,
      action: "medical.web_auto_run.stop",
      targetType: "study",
      targetId: studyId,
      detail: {
        trigger_reason: reason,
        stop_status: gate.status,
        steps,
        ...gate.detail,
      },
      traceId: studyId,
      now: Date.now(),
    });
  } catch {
    // Best-effort audit only; never break the web request lifecycle.
  }
}

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoopNoduleRevision(nodule: NoduleRecord, bbox: number[], location: string | undefined): boolean {
  const sameBbox = bboxStrictlyEqual(nodule.bbox, bbox);
  const sameLocation = location === undefined || location === nodule.location;
  return sameBbox && sameLocation;
}

function bboxStrictlyEqual(left: unknown, right: unknown): boolean {
  const leftBbox = bboxTuple(left);
  const rightBbox = bboxTuple(right);
  if (!leftBbox || !rightBbox) return false;
  return leftBbox.every((value, index) => Math.abs(value - rightBbox[index]) <= 0.01);
}

function latestTiradsFeatureForNodule(
  repo: MedicalCaseRepo,
  studyId: string,
  noduleId: string,
  systemName: string
): TiradsFeatureRecord | null {
  return repo.listTiradsFeaturesByStudy(studyId, systemName)
    .filter((feature) => feature.noduleId === noduleId)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null;
}

function isSameTiradsFeature(existing: TiradsFeatureRecord, input: TiradsFeatureInput): boolean {
  return existing.systemName === input.systemName
    && existing.sourceModel === (input.sourceModel ?? null)
    && existing.requiresReview === Boolean(input.requiresReview)
    && stableJson(existing.features) === stableJson(input.features)
    && stableJson(existing.confidence) === stableJson(input.confidence ?? {});
}

function cancelSupersededMedicalRerunTasks(
  repo: MedicalCaseRepo,
  studyId: string,
  noduleId: string,
  sources: string[],
  now: number
): string[] {
  const bundle = repo.getStudyBundle(studyId);
  if (!bundle) return [];
  const sourceSet = new Set(sources);
  const taskIds = bundle.agentTasks
    .filter((task) => isOpenMedicalTask(task.status))
    .filter((task) => sourceSet.has(stringValue(task.input.source) ?? ""))
    .filter((task) => medicalTaskTargetsNodule(task, noduleId))
    .map((task) => task.id);
  const cancelled = repo.cancelAgentTasks(taskIds, {
    code: "superseded_medical_rerun",
    message: "A newer doctor input superseded this medical rerun task.",
    detail: { study_id: studyId, nodule_id: noduleId, sources },
  }, now);
  return cancelled.map((task) => task.id);
}

function isOpenMedicalTask(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_model";
}

function medicalTaskTargetsNodule(task: AgentTaskRecord, noduleId: string): boolean {
  if (stringValue(task.input.nodule_id) === noduleId) return true;
  const targetIds = task.input.target_nodule_ids;
  return Array.isArray(targetIds) && targetIds.includes(noduleId);
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isJsonObject(value)) return value;
  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalJsonValue(value[key]);
  }
  return sorted;
}

function createDoctorBboxRevisionRerun(
  repo: MedicalCaseRepo,
  revised: NoduleRevisionResult,
  actorId: string,
  now: number
): { analysisSession: AnalysisSessionRecord; agentTasks: AgentTaskRecord[] } {
  const imageId = revised.nodule.imageId;
  if (!imageId) {
    throw new MedicalRequestError(400, "image-required", "nodule must be linked to an image before segmentation rerun");
  }

  const analysisSession = repo.createAnalysisSession({
    studyId: revised.nodule.studyId,
    status: "queued",
    triggerSource: "doctor_bbox_revision",
    createdBy: actorId,
    summary: {
      source: "doctor_bbox_revision",
      image_id: imageId,
      nodule_id: revised.nodule.id,
      nodule_index: revised.nodule.noduleIndex,
      bbox_before: revised.before.bbox,
      bbox_after: revised.nodule.bbox,
      task_count: DOCTOR_BBOX_REVISION_TASKS.length,
      task_types: DOCTOR_BBOX_REVISION_TASKS.map((task) => task.taskType),
    },
    now,
  });

  let parentTaskId: string | undefined;
  const agentTasks = DOCTOR_BBOX_REVISION_TASKS.map((task, index) => {
    const input: JsonObject = {
      study_id: revised.nodule.studyId,
      image_id: imageId,
      nodule_id: revised.nodule.id,
      nodule_index: revised.nodule.noduleIndex,
      target_nodule_ids: [revised.nodule.id],
      tool_name: task.toolName,
      sequence: index + 1,
      source: "doctor_bbox_revision",
      revision_trace_id: revised.nodule.id,
      bbox_before: revised.before.bbox,
      bbox_after: revised.nodule.bbox,
    };
    if ("model" in task) input.model = task.model;
    if ("modelVersion" in task) input.model_version = task.modelVersion;
    if (task.taskType === "segment_nodules") input.allow_bbox_fallback = false;
    if (task.taskType === "draft_report") input.refresh_report_basis = true;

    const created = repo.createAgentTask({
      analysisSessionId: analysisSession.id,
      parentTaskId,
      agentName: task.agentName,
      taskType: task.taskType,
      status: "queued",
      input,
      now: now + index,
    });
    parentTaskId = created.id;
    return created;
  });

  return { analysisSession, agentTasks };
}

function createDoctorTiradsFeatureRerun(
  repo: MedicalCaseRepo,
  nodule: NoduleRecord,
  tiradsFeatureId: string,
  actorId: string,
  now: number
): { analysisSession: AnalysisSessionRecord; agentTasks: AgentTaskRecord[] } {
  const analysisSession = repo.createAnalysisSession({
    studyId: nodule.studyId,
    status: "queued",
    triggerSource: "doctor_tirads_feature_input",
    createdBy: actorId,
    summary: {
      source: "doctor_tirads_feature_input",
      image_id: nodule.imageId,
      nodule_id: nodule.id,
      nodule_index: nodule.noduleIndex,
      tirads_feature_id: tiradsFeatureId,
      task_count: DOCTOR_TIRADS_FEATURE_TASKS.length,
      task_types: DOCTOR_TIRADS_FEATURE_TASKS.map((task) => task.taskType),
    },
    now,
  });

  let parentTaskId: string | undefined;
  const agentTasks = DOCTOR_TIRADS_FEATURE_TASKS.map((task, index) => {
    const input: JsonObject = {
      study_id: nodule.studyId,
      image_id: nodule.imageId,
      nodule_id: nodule.id,
      nodule_index: nodule.noduleIndex,
      target_nodule_ids: [nodule.id],
      tirads_feature_id: tiradsFeatureId,
      tool_name: task.toolName,
      sequence: index + 1,
      source: "doctor_tirads_feature_input",
    };
    if (task.taskType === "draft_report") input.refresh_report_basis = true;
    const created = repo.createAgentTask({
      analysisSessionId: analysisSession.id,
      parentTaskId,
      agentName: task.agentName,
      taskType: task.taskType,
      status: "queued",
      input,
      now: now + index,
    });
    parentTaskId = created.id;
    return created;
  });

  return { analysisSession, agentTasks };
}

function readMedicalStudyBundle(repo: MedicalCaseRepo, studyId: string): StudyBundle | null {
  const bundle = repo.getStudyBundle(studyId);
  return bundle ? withRevisionEvidence(bundle) : null;
}

function withRevisionEvidence(bundle: StudyBundle): StudyBundle {
  return {
    ...bundle,
    auditLogs: bundle.auditLogs.map((audit) => {
      if (audit.action !== "medical.nodule.revise") return audit;
      return {
        ...audit,
        detail: {
          ...audit.detail,
          revision_evidence: buildRevisionEvidence(audit, bundle),
        },
      };
    }),
  };
}

function buildRevisionEvidence(audit: AuditLogRecord, bundle: StudyBundle): JsonObject {
  const before = jsonObjectValue(audit.detail.before);
  const after = jsonObjectValue(audit.detail.after);
  const afterBbox = bboxTuple(after?.bbox);
  const afterBboxValid = afterBbox ? bboxEdgeIsValid(afterBbox) : false;
  const analysisSessionId = stringValue(audit.detail.rerun_analysis_session_id);
  const taskIdSet = new Set(stringArray(audit.detail.rerun_agent_task_ids));
  const tasks = bundle.agentTasks.filter((task) =>
    taskIdSet.has(task.id) || (!!analysisSessionId && task.analysisSessionId === analysisSessionId)
  );
  const taskStatuses = tasks.map((task) => ({
    id: task.id,
    task_type: task.taskType,
    status: task.status,
  }));
  const failed = tasks.some((task) => task.status === "failed" || task.status === "blocked");
  const noduleId = stringValue(after?.id) ?? audit.targetId ?? undefined;
  const noduleIndex = numberValue(after?.nodule_index) ?? numberValue(after?.noduleIndex);
  const nodule = bundle.nodules.find((candidate) =>
    (!!noduleId && candidate.id === noduleId) || (noduleIndex !== null && candidate.noduleIndex === noduleIndex)
  );
  const noduleBboxMatches = afterBbox && nodule ? bboxNearlyEqual(nodule.bbox, afterBbox) : null;
  const segmentTask = tasks.find((task) => task.taskType === "segment_nodules") ?? null;
  const measureTask = tasks.find((task) => task.taskType === "measure_nodules") ?? null;
  const segmentJob = latestModelJobForTask(bundle.modelJobs, segmentTask?.id, "thyroid.segment_nodule");
  const measureJob = latestModelJobForTask(bundle.modelJobs, measureTask?.id, "thyroid.measure_nodule");
  const segmentation = segmentJob ? modelOutputRecord(segmentJob, "segmentations", noduleId, noduleIndex) : null;
  const measurement = measureJob ? modelOutputRecord(measureJob, "measurements", noduleId, noduleIndex) : null;
  const promptBbox = segmentationPromptBbox(segmentation, segmentJob, noduleId, noduleIndex);
  const promptBboxMatches = afterBbox && promptBbox ? bboxNearlyEqual(promptBbox, afterBbox) : null;
  const report = latestReportForRevision(bundle.reports, analysisSessionId);
  const reportSources = report ? reportEvidenceSources(report) : [];
  const evidenceMatches = afterBboxValid
    && noduleBboxMatches !== false
    && promptBboxMatches !== false;
  const status = !afterBboxValid
    ? "invalid_revision_bbox"
    : failed
      ? "failed"
      : report && !evidenceMatches
        ? "bbox_mismatch"
        : report
          ? "refreshed"
          : "pending_refresh";
  const measurementSummary = measurement
    ? {
        long_axis_mm: numberValue(measurement.long_axis_mm),
        short_axis_mm: numberValue(measurement.short_axis_mm),
        area_mm2: numberValue(measurement.area_mm2),
        source: stringValue(measurement.measurement_source),
        artifact_uri: stringValue(measurement.artifact_uri) ?? measureJob?.artifactUri ?? null,
      }
    : null;

  return {
    source: "server_revision_task_chain",
    status,
    analysis_session_id: analysisSessionId ?? null,
    rerun_agent_task_ids: Array.from(taskIdSet),
    task_statuses: taskStatuses,
    model_job_ids: {
      segmentation: segmentJob?.id ?? null,
      measurement: measureJob?.id ?? null,
    },
    report_id: status === "refreshed" ? report?.id ?? null : null,
    evidence_sources: status === "refreshed" ? reportSources : [],
    old_bbox: before?.bbox ?? null,
    new_bbox: after?.bbox ?? null,
    old_mask_uri: stringValue(before?.mask_uri) ?? stringValue(before?.maskUri) ?? null,
    new_mask_uri: status === "refreshed"
      ? stringValue(segmentation?.mask_uri) ?? nodule?.maskUri ?? null
      : null,
    measurement: status === "refreshed" ? measurementSummary : null,
    consistency: {
      after_bbox_valid: afterBboxValid,
      nodule_bbox_matches: noduleBboxMatches,
      segmentation_prompt_bbox: promptBbox,
      segmentation_prompt_bbox_matches: promptBboxMatches,
    },
  };
}

function latestModelJobForTask(
  jobs: ModelJobRecord[],
  taskId: string | undefined,
  jobType: string
): ModelJobRecord | null {
  if (!taskId) return null;
  return [...jobs]
    .filter((job) => job.agentTaskId === taskId && job.jobType === jobType)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)[0] ?? null;
}

function modelOutputRecord(
  job: ModelJobRecord,
  outputKey: string,
  noduleId: string | undefined,
  noduleIndex: number | null
): JsonObject | null {
  for (const record of jsonObjectList(job.output?.[outputKey])) {
    const recordNoduleId = stringValue(record.nodule_id) ?? stringValue(record.noduleId);
    const recordNoduleIndex = numberValue(record.nodule_index) ?? numberValue(record.noduleIndex);
    if ((noduleId && recordNoduleId === noduleId) || (noduleIndex !== null && recordNoduleIndex === noduleIndex)) {
      return record;
    }
  }
  return null;
}

function segmentationPromptBbox(
  segmentation: JsonObject | null,
  job: ModelJobRecord | null,
  noduleId: string | undefined,
  noduleIndex: number | null
): number[] | null {
  const metadata = jsonObjectValue(segmentation?.metadata);
  const direct = bboxTuple(
    segmentation?.prompt_bbox
    ?? segmentation?.prompt_bbox_xyxy
    ?? metadata?.prompt_bbox
    ?? metadata?.prompt_bbox_xyxy
    ?? metadata?.bbox
  );
  if (direct) return direct;
  if (!job) return null;
  for (const record of jsonObjectList(job.input?.nodules)) {
    const recordNoduleId = stringValue(record.nodule_id) ?? stringValue(record.noduleId);
    const recordNoduleIndex = numberValue(record.nodule_index) ?? numberValue(record.noduleIndex);
    if ((noduleId && recordNoduleId === noduleId) || (noduleIndex !== null && recordNoduleIndex === noduleIndex)) {
      return bboxTuple(record.bbox);
    }
  }
  return null;
}

function latestReportForRevision(reports: ReportRecord[], analysisSessionId: string | undefined): ReportRecord | null {
  if (!analysisSessionId) return null;
  return [...reports]
    .filter((report) => report.analysisSessionId === analysisSessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)[0] ?? null;
}

function reportEvidenceSources(report: ReportRecord): string[] {
  const sources = new Set<string>();
  for (const evidence of report.evidence) {
    const source = stringValue(jsonObjectValue(evidence)?.source);
    if (source) sources.add(source);
  }
  return Array.from(sources);
}

function jsonObjectValue(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function jsonObjectList(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bboxTuple(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((item): item is number => typeof item === "number" && Number.isFinite(item))) return null;
  return normalizedBbox(value);
}

function bboxEdgeIsValid(value: number[]): boolean {
  const [x1, y1, x2, y2] = normalizedBbox(value);
  return x2 - x1 >= 1 && y2 - y1 >= 1;
}

function bboxNearlyEqual(left: unknown, right: unknown): boolean {
  const leftBbox = bboxTuple(left);
  const rightBbox = bboxTuple(right);
  if (!leftBbox || !rightBbox) return false;
  return leftBbox.every((value, index) => Math.abs(value - rightBbox[index]) <= 1);
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
    .map((row) => {
      const queue = recentStudyQueueState(db, row);
      return {
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
        queueStage: queue.queueStage,
        queueReason: queue.queueReason,
        queuePriority: queue.queuePriority,
      };
    });
}

function recentStudyQueueState(db: Database.Database, row: RecentStudyRow): StudyQueueState {
  const reportStatus = row.latest_report_status;
  if (reportStatus === "rejected") {
    return {
      queueStage: "report_rejected",
      queueReason: "报告已驳回，等待再次修订",
      queuePriority: 5,
    };
  }
  if (reportStatus === "draft" || reportStatus === "pending_review") {
    return {
      queueStage: "pending_report_review",
      queueReason: reportStatus === "pending_review" ? "报告修订待复核" : "等待医生审核报告草稿",
      queuePriority: 10,
    };
  }
  if (reportStatus === "confirmed") {
    return {
      queueStage: "ready_archive",
      queueReason: "报告已确认，等待归档",
      queuePriority: 20,
    };
  }
  if (needsDoctorTiradsConfirmation(db, row.id)) {
    return {
      queueStage: "waiting_tirads_confirmation",
      queueReason: "等待医生确认 TI-RADS 结构化特征",
      queuePriority: 30,
    };
  }
  if (row.latest_analysis_status === "failed" || studyHasFailedTasks(db, row.id)) {
    return {
      queueStage: "analysis_failed",
      queueReason: "AI 分析失败，等待复核或重跑",
      queuePriority: 40,
    };
  }
  const openTask = latestOpenStudyTask(db, row.id);
  if (openTask) {
    return {
      queueStage: "analysis_in_progress",
      queueReason: openTaskReason(openTask),
      queuePriority: 50,
    };
  }
  if (reportStatus === "archived") {
    return {
      queueStage: "archived",
      queueReason: "病例已归档",
      queuePriority: 90,
    };
  }
  if (row.image_count === 0) {
    return {
      queueStage: "awaiting_image",
      queueReason: "等待上传图像",
      queuePriority: 70,
    };
  }
  if (row.latest_analysis_status) {
    return {
      queueStage: "completed",
      queueReason: "分析流程完成",
      queuePriority: 80,
    };
  }
  return {
    queueStage: "ready_to_start",
    queueReason: "可启动 AI 分析",
    queuePriority: 60,
  };
}

function needsDoctorTiradsConfirmation(db: Database.Database, studyId: string): boolean {
  const queuedCalculate = db
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count
       FROM agent_task task
       JOIN analysis_session session ON session.id = task.analysis_session_id
       WHERE session.study_id = ?
         AND task.task_type = 'calculate_tirads'
         AND task.status = 'queued'`
    )
    .get(studyId)?.count ?? 0;
  return queuedCalculate > 0 && !hasConfirmedTiradsFeatures(db, studyId);
}

function studyHasFailedTasks(db: Database.Database, studyId: string): boolean {
  return (
    db
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count
         FROM agent_task task
         JOIN analysis_session session ON session.id = task.analysis_session_id
         WHERE session.study_id = ?
           AND task.status IN ('failed', 'blocked')`
      )
      .get(studyId)?.count ?? 0
  ) > 0;
}

function latestOpenStudyTask(db: Database.Database, studyId: string): StudyOpenTaskRow | null {
  return db
    .prepare<[string], StudyOpenTaskRow>(
      `SELECT task.task_type, task.status
       FROM agent_task task
       JOIN analysis_session session ON session.id = task.analysis_session_id
       WHERE session.study_id = ?
         AND task.status IN ('queued', 'running', 'waiting_model')
       ORDER BY task.updated_at DESC, task.created_at DESC, task.id DESC
       LIMIT 1`
    )
    .get(studyId) ?? null;
}

function openTaskReason(task: StudyOpenTaskRow): string {
  const stage = medicalTaskStageLabel(task.task_type);
  if (task.status === "waiting_model") return `${stage}模型推理中`;
  if (task.status === "running") return `${stage}执行中`;
  return `${stage}排队中`;
}

function medicalTaskStageLabel(taskType: string): string {
  if (taskType === "image_qc") return "图像质控";
  if (taskType === "detect_nodules") return "结节检测";
  if (taskType === "segment_nodules") return "结节分割";
  if (taskType === "measure_nodules") return "结节测量";
  if (taskType === "classify_tirads_features") return "TI-RADS 特征识别";
  if (taskType === "calculate_tirads") return "TI-RADS 规则计算";
  if (taskType === "draft_report") return "报告生成";
  if (taskType === "safety_review") return "安全审核";
  return taskType;
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

function readFinalValidationReviewQueues(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT review_status AS status, COUNT(*) AS count
       FROM final_validation_image_result
       GROUP BY review_status
       ORDER BY review_status ASC`
    )
    .all() as StatusCountRow[];
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function countFinalValidationReviewStatus(db: Database.Database, runId: string): Record<string, number> {
  const rows = db
    .prepare<[string], StatusCountRow>(
      `SELECT review_status AS status, COUNT(*) AS count
       FROM final_validation_image_result
       WHERE run_id = ?
       GROUP BY review_status
       ORDER BY review_status ASC`
    )
    .all(runId);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function countFinalValidationResultStatus(db: Database.Database, runId: string): Record<string, number> {
  const rows = db
    .prepare<[string], StatusCountRow>(
      `SELECT status, COUNT(*) AS count
       FROM final_validation_image_result
       WHERE run_id = ?
       GROUP BY status
       ORDER BY status ASC`
    )
    .all(runId);
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

function modelGatewayBaseUrl(): string {
  const configured = process.env.JZX_MODEL_GATEWAY_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = process.env.JZX_MODEL_GATEWAY_PORT?.trim() || "8766";
  return `http://127.0.0.1:${port}`;
}

function remoteArtifactGatewayBaseUrl(): string | null {
  const configured = process.env.JZX_REMOTE_MODEL_GATEWAY_URL?.trim() || process.env.JZX_MODEL_GATEWAY_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : null;
}

async function cacheRemoteMedicalArtifact(artifactUri: string, artifactPath: string): Promise<boolean> {
  const gatewayUrl = remoteArtifactGatewayBaseUrl();
  if (!gatewayUrl) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_MEDICAL_ARTIFACT_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${gatewayUrl}/model/v1/artifacts?uri=${encodeURIComponent(artifactUri)}`,
      { method: "GET", signal: controller.signal, headers: { accept: "*/*" } }
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new MedicalRequestError(
        502,
        "remote-artifact-fetch-failed",
        `remote model-gateway artifact fetch returned HTTP ${response.status}`
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MEDICAL_ARTIFACT_MAX_BYTES) {
      throw new MedicalRequestError(413, "artifact-too-large", "artifact exceeds validation preview size limit");
    }
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, bytes);
    return true;
  } catch (err) {
    if (err instanceof MedicalRequestError) throw err;
    throw new MedicalRequestError(
      502,
      "remote-artifact-fetch-failed",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}

function resolveMedicalArtifactPath(artifactUri: string, deps: HandlerDeps): string {
  if (!artifactUri.startsWith("artifact://")) {
    throw new MedicalRequestError(400, "invalid-request", "uri must start with artifact://");
  }
  const relative = artifactUri.slice("artifact://".length).replace(/^\/+/, "");
  if (!relative) {
    throw new MedicalRequestError(400, "invalid-request", "artifact URI must include a path");
  }
  const root = path.resolve(deps.artifactsRoot || process.env.JZX_ARTIFACT_ROOT?.trim() || "data/artifacts");
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new MedicalRequestError(400, "invalid-request", "artifact URI cannot escape artifact root");
  }
  return target;
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

function manualTiradsFeatureInput(
  repo: MedicalCaseRepo,
  nodule: NoduleRecord,
  body: JsonObject,
  now: number
): TiradsFeatureInput {
  const features = normalizeTiradsFeatures(body);
  if (!features.size_mm) {
    const latestMeasurement = [...repo.listMeasurementsByStudy(nodule.studyId)]
      .filter((measurement) => measurement.noduleId === nodule.id)
      .at(-1);
    if (latestMeasurement?.longAxisMm || latestMeasurement?.shortAxisMm || latestMeasurement?.apAxisMm) {
      features.size_mm = {
        long_axis: latestMeasurement.longAxisMm ?? undefined,
        short_axis: latestMeasurement.shortAxisMm ?? undefined,
        ap_axis: latestMeasurement.apAxisMm ?? undefined,
      };
    }
  }
  return {
    noduleId: nodule.id,
    systemName: stringField(body, "systemName", "system_name") ?? "ACR_TI_RADS",
    features,
    confidence: objectField(body, "confidence", "feature_confidence") ?? {},
    sourceModel: stringField(body, "sourceModel", "source_model") ?? "doctor_structured_input",
    requiresReview: booleanField(body, "requiresReview", "requires_review") ?? false,
    now,
  };
}

function normalizeTiradsFeatures(body: JsonObject): JsonObject {
  const raw = objectField(body, "features") ?? body;
  const features: JsonObject = {};
  features.composition = enumString(raw, "composition");
  features.echogenicity = enumString(raw, "echogenicity");
  features.shape = enumString(raw, "shape");
  features.margin = enumString(raw, "margin");
  features.echogenic_foci = echogenicFoci(raw);
  const size = objectField(raw, "sizeMm", "size_mm");
  if (size) {
    const sizeMm = {
      long_axis: numberField(size, "longAxis", "long_axis"),
      short_axis: numberField(size, "shortAxis", "short_axis"),
      ap_axis: numberField(size, "apAxis", "ap_axis"),
    };
    if (sizeMm.long_axis || sizeMm.short_axis || sizeMm.ap_axis) features.size_mm = sizeMm;
  }
  return features;
}

function enumString(body: JsonObject, key: string): string {
  const value = requiredString(body, key);
  const allowed = TIRADS_FEATURE_ENUMS[key];
  if (!allowed?.has(value)) {
    throw new MedicalRequestError(400, "invalid-request", `${key} has unsupported TI-RADS value: ${value}`);
  }
  return value;
}

function echogenicFoci(body: JsonObject): string[] {
  const value = body.echogenic_foci ?? body.echogenicFoci;
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  if (values.length === 0) {
    throw new MedicalRequestError(400, "invalid-request", "echogenic_foci must include at least one value");
  }
  const allowed = TIRADS_FEATURE_ENUMS.echogenic_foci;
  for (const item of values) {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new MedicalRequestError(400, "invalid-request", `echogenic_foci has unsupported TI-RADS value: ${String(item)}`);
    }
  }
  return values;
}

function reviewAction(body: JsonObject): ReportReviewAction {
  const action = requiredString(body, "action");
  if (action === "approve" || action === "revise" || action === "reject" || action === "archive") return action;
  throw new MedicalRequestError(400, "invalid-request", "action must be approve, revise, reject, or archive");
}

function finalValidationReviewStatus(value: string | null | undefined): string;
function finalValidationReviewStatus(value: string | null | undefined, options: { optional: true }): string | undefined;
function finalValidationReviewStatus(value: string | null | undefined, options: { optional?: boolean } = {}): string | undefined {
  const status = value?.trim();
  if (!status) {
    if (options.optional) return undefined;
    throw new MedicalRequestError(400, "invalid-request", "reviewStatus is required");
  }
  if (status === "unreviewed" || status === "accepted" || status === "rejected" || status === "needs_review") {
    return status;
  }
  throw new MedicalRequestError(
    400,
    "invalid-request",
    "reviewStatus must be unreviewed, accepted, rejected, or needs_review"
  );
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

function medicalKnowledgeFilters(body: JsonObject): {
  documentId?: string;
  sourceType?: string;
  chunkType?: string;
  topic?: string;
  evidenceLevel?: string;
  tiradsSystem?: string;
  bodyPart?: string;
} | undefined {
  const raw = objectField(body, "filters");
  if (!raw) return undefined;
  const filters = {
    documentId: stringField(raw, "documentId", "document_id"),
    sourceType: stringField(raw, "sourceType", "source_type"),
    chunkType: stringField(raw, "chunkType", "chunk_type"),
    topic: stringField(raw, "topic"),
    evidenceLevel: stringField(raw, "evidenceLevel", "evidence_level"),
    tiradsSystem: stringField(raw, "tiradsSystem", "tirads_system"),
    bodyPart: stringField(raw, "bodyPart", "body_part"),
  };
  return Object.values(filters).some(Boolean) ? filters : undefined;
}

function requiredBbox(body: JsonObject): number[] {
  const value = body.bbox;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new MedicalRequestError(400, "invalid-request", "bbox must be an array of four finite numbers");
  }
  const bbox = value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new MedicalRequestError(400, "invalid-request", "bbox must be an array of four finite numbers");
    }
    return item;
  });
  const [x1, y1, x2, y2] = normalizedBbox(bbox);
  if (x2 - x1 < 1 || y2 - y1 < 1) {
    throw new MedicalRequestError(400, "invalid-request", "bbox width and height must be at least 1 pixel");
  }
  return [x1, y1, x2, y2];
}

function normalizedBbox(value: number[]): number[] {
  const [x1, y1, x2, y2] = value;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

function noduleAuditSnapshot(nodule: {
  id: string;
  noduleIndex: number;
  bbox: unknown;
  location: string | null;
  maskUri?: string | null;
  detectionConfidence?: number | null;
  source: string;
  status: string;
  updatedAt: number;
}): JsonObject {
  return {
    id: nodule.id,
    nodule_index: nodule.noduleIndex,
    bbox: nodule.bbox,
    location: nodule.location,
    mask_uri: nodule.maskUri ?? null,
    detection_confidence: nodule.detectionConfidence ?? null,
    source: nodule.source,
    status: nodule.status,
    updated_at: nodule.updatedAt,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(text: string): JsonObject {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
