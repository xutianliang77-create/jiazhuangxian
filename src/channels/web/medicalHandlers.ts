import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, statSync } from "node:fs";
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
  type PatientInput,
  type ReportRecord,
  type ReportReviewAction,
  type StudyBundle,
  type StudyInput,
} from "../../medical/storage/caseRepo";
import { searchMedicalKnowledge } from "../../medical/knowledge/search";
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

const MEDICAL_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024;
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
      throw new MedicalRequestError(404, "artifact-not-found", "artifact was not found");
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
    if (action === "archive" && report.status !== "confirmed" && report.status !== "archived") {
      throw new MedicalRequestError(400, "invalid-request", "only confirmed reports can be archived");
    }
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
        evidence_count: reviewed.report.evidence.length,
        evidence_sources: reportEvidenceSources(reviewed.report),
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
    const now = Date.now();
    const { revised, analysisSession, agentTasks, auditLog } = ctx.db.transaction(() => {
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

function modelGatewayBaseUrl(): string {
  const configured = process.env.JZX_MODEL_GATEWAY_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = process.env.JZX_MODEL_GATEWAY_PORT?.trim() || "8766";
  return `http://127.0.0.1:${port}`;
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

function reviewAction(body: JsonObject): ReportReviewAction {
  const action = requiredString(body, "action");
  if (action === "approve" || action === "revise" || action === "reject" || action === "archive") return action;
  throw new MedicalRequestError(400, "invalid-request", "action must be approve, revise, reject, or archive");
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
