import {
  MedicalCaseRepo,
  type AgentTaskRecord,
  type ImageRecord,
  type ModelJobRecord,
  type NoduleRecord,
  type ReportRecord,
  type SafetyRuleRecord,
  type TiradsFeatureRecord,
  type TiradsResultRecord,
  type TiradsRuleRecord,
} from "./storage";
import type { EngineMessage } from "../agent/types";
import type { MedicalKnowledgeEvidence } from "./knowledge/search";
import { streamProviderResponse } from "../provider/client";
import type { ProviderStatus } from "../provider/types";
import { calculateAcrTirads, type TiradsInput } from "../../packages/medical-mcp/src/tirads";

type JsonObject = Record<string, unknown>;

export interface MedicalAgentWorkerOptions {
  workerId?: string;
  now?: () => number;
  imageWorkerUrl?: string;
  fetchImpl?: FetchLike;
  llmProvider?: ProviderStatus | null;
  llmFetchImpl?: FetchLike;
  medicalReviewProvider?: ProviderStatus | null;
  medicalReviewFetchImpl?: FetchLike;
  dataDbPath?: string;
  ragDbPath?: string;
  workspace?: string;
  knowledgeTopK?: number;
}

export interface MedicalAgentWorkerResult {
  status: "idle" | "succeeded" | "waiting_model" | "failed";
  claimed: boolean;
  workerId: string;
  taskId?: string;
  taskType?: string;
  modelJobId?: string;
  error?: JsonObject;
  output?: JsonObject;
}

const DETECT_JOB_TYPE = "thyroid.detect_nodules";
const SEGMENT_JOB_TYPE = "thyroid.segment_nodule";
const MEASURE_JOB_TYPE = "thyroid.measure_nodule";
const GPU_PIPELINE_POLICY_VERSION = "thyroid-gpu-pipeline-v1";
const DEFAULT_DETECTOR_MODEL = "rf-detr-medium-thyroid-detector";
const DEFAULT_DETECTOR_MODEL_VERSION = "tn5000-rfdetr-medium-ema";
const DEFAULT_DETECTOR_COMPARATOR_MODEL = "yolov11-thyroid-detector";
const DEFAULT_SEGMENT_MODEL = "nnunet-tight-roi-segmenter";
const DEFAULT_SEGMENT_MODEL_VERSION = "tn3k-tight-roi-5fold-best";
const DEFAULT_MEASURE_MODEL = "mask-measurement-worker";
const DEFAULT_MEASURE_MODEL_VERSION = "validation-measurement-v1";
const IMAGE_QC_PATH = "/image/v1/image-quality-check";
const THYROID_REPORT_TEMPLATE_ID = "tpl-thyroid-ultrasound-draft-v1";
const THYROID_REPORT_TEMPLATE = `甲状腺超声AI辅助报告（草稿）

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

提示：本报告为AI辅助草稿，需医生审核确认后生效。`;

type FetchLike = typeof fetch;

interface WorkerResponse {
  status: "ok" | "error";
  result?: JsonObject;
  warnings?: string[];
  trace_id?: string;
  error?: {
    code: string;
    message: string;
    detail?: JsonObject;
  };
}

export function runMedicalAgentWorkerOnce(
  repo: MedicalCaseRepo,
  options: MedicalAgentWorkerOptions = {}
): MedicalAgentWorkerResult {
  const workerId = options.workerId ?? "medical-agent-worker";
  const now = options.now ?? Date.now;

  const synced = syncWaitingModelTask(repo, workerId, now);
  if (synced) return synced;

  const task = repo.claimNextAgentTask(now());
  if (!task) return { status: "idle", claimed: false, workerId };

  try {
    return processClaimedTask(repo, task, workerId, now, options);
  } catch (err) {
    const error = {
      code: "medical_agent_worker_error",
      message: err instanceof Error ? err.message : String(err),
      detail: { worker_id: workerId, task_type: task.taskType },
    };
    repo.failAgentTask(task.id, error, now());
    return {
      status: "failed",
      claimed: true,
      workerId,
      taskId: task.id,
      taskType: task.taskType,
      error,
    };
  }
}

export async function runMedicalAgentWorkerOnceAsync(
  repo: MedicalCaseRepo,
  options: MedicalAgentWorkerOptions = {}
): Promise<MedicalAgentWorkerResult> {
  const workerId = options.workerId ?? "medical-agent-worker";
  const now = options.now ?? Date.now;

  const synced = await syncWaitingModelTaskAsync(repo, workerId, now, options);
  if (synced) return synced;

  const task = repo.claimNextAgentTask(now());
  if (!task) return { status: "idle", claimed: false, workerId };

  try {
    return await processClaimedTaskAsync(repo, task, workerId, now, options);
  } catch (err) {
    const error = {
      code: "medical_agent_worker_error",
      message: err instanceof Error ? err.message : String(err),
      detail: { worker_id: workerId, task_type: task.taskType },
    };
    repo.failAgentTask(task.id, error, now());
    return {
      status: "failed",
      claimed: true,
      workerId,
      taskId: task.id,
      taskType: task.taskType,
      error,
    };
  }
}

function syncWaitingModelTask(
  repo: MedicalCaseRepo,
  workerId: string,
  now: () => number
): MedicalAgentWorkerResult | null {
  for (const task of repo.listWaitingModelAgentTasks()) {
    const modelJobId = optionalString(task.output?.model_job_id);
    const modelJob = modelJobId ? repo.getModelJob(modelJobId) : findTaskModelJob(repo, task);
    if (!modelJob) {
      const error = {
        code: "model_job_missing",
        message: "Waiting medical agent task has no model_job record.",
        detail: { worker_id: workerId, task_id: task.id },
      };
      repo.failAgentTask(task.id, error, now());
      return {
        status: "failed",
        claimed: true,
        workerId,
        taskId: task.id,
        taskType: task.taskType,
        error,
      };
    }
    if (modelJob.status === "queued" || modelJob.status === "running") continue;
    if (modelJob.status === "succeeded") {
      const completedAt = now();
      const output = modelJobSuccessOutput(repo, modelJob, workerId, completedAt);
      const downstreamTask = queueAutomaticDownstreamTask(repo, task, modelJob, output, completedAt);
      const completedOutput = downstreamTask ? { ...output, auto_queued_task: downstreamTask } : output;
      repo.completeAgentTask(task.id, completedOutput, completedAt);
      return {
        status: "succeeded",
        claimed: true,
        workerId,
        taskId: task.id,
        taskType: task.taskType,
        modelJobId: modelJob.id,
        output: completedOutput,
      };
    }
    const error = {
      code: "model_job_failed",
      message: "Model job did not complete successfully.",
      detail: {
        worker_id: workerId,
        model_job_id: modelJob.id,
        model_job_status: modelJob.status,
        model_job_error: modelJob.error,
      },
    };
    repo.failAgentTask(task.id, error, now());
    return {
      status: "failed",
      claimed: true,
      workerId,
      taskId: task.id,
      taskType: task.taskType,
      modelJobId: modelJob.id,
      error,
    };
  }
  return null;
}

async function syncWaitingModelTaskAsync(
  repo: MedicalCaseRepo,
  workerId: string,
  now: () => number,
  options: MedicalAgentWorkerOptions
): Promise<MedicalAgentWorkerResult | null> {
  for (const task of repo.listWaitingModelAgentTasks()) {
    const modelJobId = optionalString(task.output?.model_job_id);
    const modelJob = modelJobId ? repo.getModelJob(modelJobId) : findTaskModelJob(repo, task);
    if (!modelJob) {
      const error = {
        code: "model_job_missing",
        message: "Waiting medical agent task has no model_job record.",
        detail: { worker_id: workerId, task_id: task.id },
      };
      repo.failAgentTask(task.id, error, now());
      return {
        status: "failed",
        claimed: true,
        workerId,
        taskId: task.id,
        taskType: task.taskType,
        error,
      };
    }
    if (modelJob.status === "queued" || modelJob.status === "running") continue;
    if (modelJob.status === "succeeded") {
      const completedAt = now();
      const output = await modelJobSuccessOutputAsync(repo, modelJob, workerId, completedAt, options);
      const downstreamTask = queueAutomaticDownstreamTask(repo, task, modelJob, output, completedAt);
      const completedOutput = downstreamTask ? { ...output, auto_queued_task: downstreamTask } : output;
      repo.completeAgentTask(task.id, completedOutput, completedAt);
      return {
        status: "succeeded",
        claimed: true,
        workerId,
        taskId: task.id,
        taskType: task.taskType,
        modelJobId: modelJob.id,
        output: completedOutput,
      };
    }
    const error = {
      code: "model_job_failed",
      message: "Model job did not complete successfully.",
      detail: {
        worker_id: workerId,
        model_job_id: modelJob.id,
        model_job_status: modelJob.status,
        model_job_error: modelJob.error,
      },
    };
    repo.failAgentTask(task.id, error, now());
    return {
      status: "failed",
      claimed: true,
      workerId,
      taskId: task.id,
      taskType: task.taskType,
      modelJobId: modelJob.id,
      error,
    };
  }
  return null;
}

function processClaimedTask(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  workerId: string,
  now: () => number,
  options: MedicalAgentWorkerOptions = {}
): MedicalAgentWorkerResult {
  if (isModelTask(task.taskType)) {
    const modelJob = ensureModelJobForTask(repo, task, now());
    const output = {
      status: "waiting_model",
      worker_id: workerId,
      model_job_id: modelJob.id,
      job_type: modelJob.jobType,
      message: "Model job has been queued; run model-worker against the same data DB.",
    };
    repo.markAgentTaskWaitingModel(task.id, output, now());
    return {
      status: "waiting_model",
      claimed: true,
      workerId,
      taskId: task.id,
      taskType: task.taskType,
      modelJobId: modelJob.id,
      output,
    };
  }

  const completedAt = now();
  const output = buildSynchronousTaskOutput(repo, task, workerId, completedAt, options);
  repo.completeAgentTask(task.id, output, completedAt);
  return {
    status: "succeeded",
    claimed: true,
    workerId,
    taskId: task.id,
    taskType: task.taskType,
    output,
  };
}

async function processClaimedTaskAsync(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  workerId: string,
  now: () => number,
  options: MedicalAgentWorkerOptions
): Promise<MedicalAgentWorkerResult> {
  if (isModelTask(task.taskType)) return processClaimedTask(repo, task, workerId, now, options);

  const output =
    task.taskType === "image_qc"
      ? await buildImageQcTaskOutput(repo, task, workerId, options, now())
      : task.taskType === "draft_report"
        ? await buildDraftReportTaskOutputAsync(repo, task, baseTaskOutput(task, workerId), workerId, now(), options)
      : task.taskType === "safety_review"
        ? await buildSafetyReviewTaskOutputAsync(repo, task, baseTaskOutput(task, workerId), workerId, now(), options)
      : buildSynchronousTaskOutput(repo, task, workerId, now(), options);
  repo.completeAgentTask(task.id, output, now());
  return {
    status: "succeeded",
    claimed: true,
    workerId,
    taskId: task.id,
    taskType: task.taskType,
    output,
  };
}

function ensureModelJobForTask(repo: MedicalCaseRepo, task: AgentTaskRecord, now: number): ModelJobRecord {
  if (task.taskType === "detect_nodules") return ensureDetectorModelJob(repo, task, now);
  if (task.taskType === "segment_nodules") return ensureSegmentModelJob(repo, task, now);
  if (task.taskType === "measure_nodules") return ensureMeasureModelJob(repo, task, now);
  throw new Error(`unsupported model task type: ${task.taskType}`);
}

function ensureDetectorModelJob(repo: MedicalCaseRepo, task: AgentTaskRecord, now: number): ModelJobRecord {
  const existing = repo.findModelJobByAgentTask(task.id, DETECT_JOB_TYPE);
  if (existing) return existing;

  const studyId = requiredString(task.input.study_id, "study_id");
  const imageId = requiredString(task.input.image_id, "image_id");
  const image = repo.getImage(imageId);
  if (!image || image.studyId !== studyId) {
    throw new Error(`image not found for task ${task.id}: ${imageId}`);
  }
  return repo.createModelJob({
    studyId,
    imageId,
    agentTaskId: task.id,
    jobType: DETECT_JOB_TYPE,
    priority: optionalNumber(task.input.priority) ?? 100,
    maxAttempts: optionalNumber(task.input.max_attempts) ?? 1,
    modelName: optionalString(task.input.model) ?? DEFAULT_DETECTOR_MODEL,
    modelVersion: optionalString(task.input.model_version) ?? DEFAULT_DETECTOR_MODEL_VERSION,
    weightsHash: optionalString(task.input.weights_hash),
    input: {
      study_id: studyId,
      image_id: imageId,
      image_uri: image.modelReadyUri ?? image.previewUri ?? image.fileUri,
      return_overlay: true,
      metadata: {
        file_type: image.fileType,
        width: image.width,
        height: image.height,
        pixel_spacing: image.pixelSpacing,
        model_pipeline: modelPipelineMetadata("detect_nodules"),
      },
      trace_id: task.id,
    },
    now,
  });
}

function ensureSegmentModelJob(repo: MedicalCaseRepo, task: AgentTaskRecord, now: number): ModelJobRecord {
  const existing = repo.findModelJobByAgentTask(task.id, SEGMENT_JOB_TYPE);
  if (existing) return existing;
  const { studyId, imageId, image } = taskImage(repo, task);
  const nodules = selectTaskNodules(repo.listNodulesByStudy(studyId), task);
  const allowBboxFallback = optionalBoolean(task.input.allow_bbox_fallback) ?? !realInferenceStrict();
  return repo.createModelJob({
    studyId,
    imageId,
    agentTaskId: task.id,
    jobType: SEGMENT_JOB_TYPE,
    priority: optionalNumber(task.input.priority) ?? 110,
    maxAttempts: optionalNumber(task.input.max_attempts) ?? 1,
    modelName: optionalString(task.input.model) ?? DEFAULT_SEGMENT_MODEL,
    modelVersion: optionalString(task.input.model_version) ?? DEFAULT_SEGMENT_MODEL_VERSION,
    weightsHash: optionalString(task.input.weights_hash),
    input: {
      study_id: studyId,
      image_id: imageId,
      image_uri: image.modelReadyUri ?? image.previewUri ?? image.fileUri,
      nodules: nodules.map((nodule) => ({
        nodule_id: nodule.id,
        nodule_index: nodule.noduleIndex,
        bbox: nodule.bbox,
        confidence: nodule.detectionConfidence,
      })),
      allow_bbox_fallback: allowBboxFallback,
      return_mask: true,
      metadata: {
        file_type: image.fileType,
        width: image.width,
        height: image.height,
        pixel_spacing: image.pixelSpacing,
        model_pipeline: modelPipelineMetadata("segment_nodules", { allowBboxFallback }),
      },
      trace_id: task.id,
    },
    now,
  });
}

function ensureMeasureModelJob(repo: MedicalCaseRepo, task: AgentTaskRecord, now: number): ModelJobRecord {
  const existing = repo.findModelJobByAgentTask(task.id, MEASURE_JOB_TYPE);
  if (existing) return existing;
  const { studyId, imageId, image } = taskImage(repo, task);
  const nodules = selectTaskNodules(repo.listNodulesByStudy(studyId), task);
  return repo.createModelJob({
    studyId,
    imageId,
    agentTaskId: task.id,
    jobType: MEASURE_JOB_TYPE,
    priority: optionalNumber(task.input.priority) ?? 120,
    maxAttempts: optionalNumber(task.input.max_attempts) ?? 1,
    modelName: optionalString(task.input.model) ?? DEFAULT_MEASURE_MODEL,
    modelVersion: optionalString(task.input.model_version) ?? DEFAULT_MEASURE_MODEL_VERSION,
    weightsHash: optionalString(task.input.weights_hash),
    input: {
      study_id: studyId,
      image_id: imageId,
      image_uri: image.modelReadyUri ?? image.previewUri ?? image.fileUri,
      nodules: nodules.map((nodule) => ({
        nodule_id: nodule.id,
        nodule_index: nodule.noduleIndex,
        bbox: nodule.bbox,
        mask_uri: nodule.maskUri,
        confidence: nodule.detectionConfidence,
      })),
      pixel_spacing: image.pixelSpacing,
      metadata: {
        file_type: image.fileType,
        width: image.width,
        height: image.height,
        model_pipeline: modelPipelineMetadata("measure_nodules"),
      },
      trace_id: task.id,
    },
    now,
  });
}

function modelPipelineMetadata(
  taskType: "detect_nodules" | "segment_nodules" | "measure_nodules",
  options: { allowBboxFallback?: boolean } = {}
): JsonObject {
  return {
    policy_version: GPU_PIPELINE_POLICY_VERSION,
    task_type: taskType,
    strict_real_inference: realInferenceStrict(),
    detector: {
      primary_model: DEFAULT_DETECTOR_MODEL,
      primary_model_version: DEFAULT_DETECTOR_MODEL_VERSION,
      comparator_model: DEFAULT_DETECTOR_COMPARATOR_MODEL,
      consensus_iou_threshold: 0.5,
      llm_evaluator: "qwen3.6",
    },
    segmentation: {
      primary_model: DEFAULT_SEGMENT_MODEL,
      primary_model_version: DEFAULT_SEGMENT_MODEL_VERSION,
      review_models: ["sam2-thyroid-segmenter", "medsam-thyroid-segmenter"],
      bbox_fallback_allowed: options.allowBboxFallback ?? !realInferenceStrict(),
    },
    measurement: {
      primary_model: DEFAULT_MEASURE_MODEL,
      primary_model_version: DEFAULT_MEASURE_MODEL_VERSION,
      requires_pixel_spacing_for_mm: true,
    },
    safety: {
      doctor_review_required: true,
      llm_must_not_modify_bbox: true,
    },
  };
}

function realInferenceStrict(): boolean {
  return process.env.JZX_MEDICAL_REAL_INFERENCE === "1";
}

function selectTaskNodules(nodules: NoduleRecord[], task: AgentTaskRecord): NoduleRecord[] {
  const targetIds = new Set(optionalStringArray(task.input.target_nodule_ids));
  const targetId = optionalString(task.input.nodule_id);
  if (targetId) targetIds.add(targetId);
  const targetIndex = optionalInteger(task.input.nodule_index);

  if (targetIds.size === 0 && targetIndex === undefined) return nodules;

  const selected = nodules.filter(
    (nodule) => targetIds.has(nodule.id) || (targetIndex !== undefined && nodule.noduleIndex === targetIndex)
  );
  if (selected.length === 0) {
    throw new Error(`no nodules matched task target for ${task.taskType}: ${task.id}`);
  }
  return selected;
}

function taskImage(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord
): { studyId: string; imageId: string; image: ImageRecord } {
  const studyId = requiredString(task.input.study_id, "study_id");
  const imageId = requiredString(task.input.image_id, "image_id");
  const image = repo.getImage(imageId);
  if (!image || image.studyId !== studyId) {
    throw new Error(`image not found for task ${task.id}: ${imageId}`);
  }
  return { studyId, imageId, image };
}

async function buildImageQcTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  workerId: string,
  options: MedicalAgentWorkerOptions,
  now: number
): Promise<JsonObject> {
  const studyId = requiredString(task.input.study_id, "study_id");
  const imageId = requiredString(task.input.image_id, "image_id");
  const image = repo.getImage(imageId);
  if (!image || image.studyId !== studyId) {
    throw new Error(`image not found for task ${task.id}: ${imageId}`);
  }

  const payload = {
    study_id: studyId,
    image_id: imageId,
    image_uri: image.modelReadyUri ?? image.previewUri ?? image.fileUri,
    metadata: {
      file_type: image.fileType,
      width: image.width,
      height: image.height,
      pixel_spacing: image.pixelSpacing,
    },
    trace_id: task.id,
  };
  const response = await callImageWorker(options, payload);
  const base = {
    status: "ok",
    worker_id: workerId,
    validation_mode: response.status !== "ok",
    study_id: studyId,
    image_id: imageId,
    tool: "thyroid.ImageQC",
  };

  if (response.status !== "ok") {
    return {
      ...base,
      result: {
        image_worker_status: "error",
        image_quality: image.imageQuality ?? "unchecked",
        quality_score: image.qualityScore,
        processing_status: image.processingStatus,
        image_worker_error: response.error,
      },
      warnings: uniqueStrings(["image_worker_qc_unavailable", ...(response.warnings ?? []), response.error?.code]),
    };
  }

  const result = response.result ?? {};
  const qualityScore = optionalNumber(result.quality_score) ?? image.qualityScore ?? null;
  const isAnalyzable = optionalBoolean(result.is_analyzable);
  const imageQuality = deriveImageQuality(result, isAnalyzable, image.imageQuality);
  repo.updateImageQuality({
    imageId,
    imageQuality,
    qualityScore: qualityScore ?? undefined,
    processingStatus: "qc_completed",
    now,
  });

  return {
    ...base,
    result: {
      image_worker_status: "ok",
      image_quality: imageQuality,
      quality_score: qualityScore,
      is_analyzable: isAnalyzable,
      issues: optionalStringArray(result.issues),
      processing_status: "qc_completed",
      image_worker_result: result,
    },
    warnings: response.warnings ?? [],
  };
}

async function callImageWorker(
  options: MedicalAgentWorkerOptions,
  payload: Record<string, unknown>
): Promise<WorkerResponse> {
  const baseUrl = (options.imageWorkerUrl ?? process.env.JZX_IMAGE_WORKER_URL ?? "http://127.0.0.1:8765").replace(
    /\/+$/,
    ""
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${baseUrl}${IMAGE_QC_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (!isWorkerResponse(parsed)) {
      return {
        status: "error",
        error: {
          code: "invalid_image_worker_response",
          message: "image-worker returned a non-standard response",
          detail: { status: response.status, body: text.slice(0, 1000) },
        },
      };
    }
    if (!response.ok && parsed.status === "ok") {
      return {
        status: "error",
        result: parsed.result,
        warnings: parsed.warnings,
        trace_id: parsed.trace_id,
        error: {
          code: "image_worker_http_error",
          message: `image-worker returned HTTP ${response.status}`,
        },
      };
    }
    return parsed;
  } catch (err) {
    return {
      status: "error",
      error: {
        code: "image_worker_unreachable",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function buildSynchronousTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions = {}
): JsonObject {
  const base = baseTaskOutput(task, workerId);
  const imageId = optionalString(task.input.image_id);
  const image = imageId ? repo.getImage(imageId) : null;

  switch (task.taskType) {
    case "image_qc":
      return {
        ...base,
        result: {
          image_quality: image?.imageQuality ?? "unchecked",
          quality_score: image?.qualityScore ?? null,
          processing_status: image?.processingStatus ?? "unknown",
        },
        warnings: image?.imageQuality ? [] : ["image_worker_qc_not_run"],
      };
    case "classify_tirads_features":
      return buildClassifyTiradsFeaturesTaskOutput(repo, task, base, now);
    case "calculate_tirads":
      return buildCalculateTiradsTaskOutput(repo, task, base, now);
    case "draft_report":
      return buildDraftReportTaskOutput(repo, task, base, workerId, now, options);
    case "safety_review":
      return buildSafetyReviewTaskOutput(repo, task, base, workerId, now);
    default:
      throw new Error(`unsupported medical agent task type: ${task.taskType}`);
  }
}

function baseTaskOutput(task: AgentTaskRecord, workerId: string): JsonObject {
  return {
    status: "ok",
    worker_id: workerId,
    validation_mode: true,
    study_id: optionalString(task.input.study_id),
    image_id: optionalString(task.input.image_id),
  };
}

interface DraftReportContext {
  studyId: string;
  template: string;
  draftText: string;
  structured: JsonObject;
  evidence: JsonObject[];
  sections: Record<string, string>;
  tiradsResults: TiradsResultRecord[];
  knowledgeEvidence: JsonObject[];
  knowledgeSearches: JsonObject[];
  knowledgeWarnings: string[];
}

interface ModelResultEvidenceContext {
  segmentationByNoduleId: Map<string, JsonObject>;
  measurementByNoduleId: Map<string, JsonObject>;
  evidence: JsonObject[];
}

interface ProviderDraftReport {
  result: JsonObject;
  warnings: string[];
  draftText?: string;
  error?: JsonObject;
}

interface ProviderMedicalReview {
  result: JsonObject;
  warnings: string[];
  error?: JsonObject;
}

function buildDraftReportTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions = {}
): JsonObject {
  const context = buildDraftReportContext(repo, task, now, options);
  const report = persistDraftReport(repo, task, workerId, context, {
    draftText: context.draftText,
    structured: {
      ...context.structured,
      generator: "structured_template_validation",
    },
    now,
  });

  return {
    ...base,
    validation_mode: false,
    result: {
      report_id: report.id,
      report_status: report.status,
      report_type: report.reportType,
      template_id: report.templateId,
      draft_text: report.draftText,
      structured: report.structured,
      evidence: report.evidence,
    },
    warnings: uniqueStrings([
      "doctor_review_required",
      context.tiradsResults.length === 0 ? "no_tirads_results_for_report" : undefined,
    ]),
  };
}

async function buildDraftReportTaskOutputAsync(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions
): Promise<JsonObject> {
  const context = buildDraftReportContext(repo, task, now, options);
  const providerDraft = await draftReportWithProvider(task, context, options);
  const usableProviderDraft = providerDraft?.draftText && !providerDraft.error ? providerDraft : null;
  const draftText = ensureDoctorReviewNotice(usableProviderDraft?.draftText ?? context.draftText);
  const medicalReview = await reviewReportWithMedicalProvider(task, context, draftText, options);
  const usableMedicalReview = medicalReview && !medicalReview.error ? medicalReview : null;
  const structured = {
    ...context.structured,
    generator: usableProviderDraft ? "llm_provider_structured_report" : "structured_template_validation",
    ...(usableProviderDraft
      ? {
          llm_provider_report: usableProviderDraft.result,
          provider: providerSnapshot(options.llmProvider!),
        }
      : {}),
    ...(usableMedicalReview
      ? {
          medical_review_assistant: usableMedicalReview.result,
          medical_review_provider: providerSnapshot(options.medicalReviewProvider!),
        }
      : {}),
  };
  const report = persistDraftReport(repo, task, workerId, context, { draftText, structured, now });
  const draftAudit =
    providerDraft && !providerDraft.error
      ? repo.createAuditLog({
          studyId: context.studyId,
          actorType: "agent",
          actorId: workerId,
          action: "medical.report.llm_draft",
          targetType: "report",
          targetId: report.id,
          detail: {
            provider: providerSnapshot(options.llmProvider!),
            report_id: report.id,
            result: providerDraft.result,
            warnings: providerDraft.warnings,
          },
          traceId: task.id,
          now,
        })
      : null;
  const reviewAudit =
    medicalReview && !medicalReview.error
      ? repo.createAuditLog({
          studyId: context.studyId,
          actorType: "agent",
          actorId: workerId,
          action: "medical.report.medgemma_review",
          targetType: "report",
          targetId: report.id,
          detail: {
            provider: providerSnapshot(options.medicalReviewProvider!),
            report_id: report.id,
            result: medicalReview.result,
            warnings: medicalReview.warnings,
          },
          traceId: task.id,
          now,
        })
      : null;

  return {
    ...base,
    validation_mode: false,
    result: {
      report_id: report.id,
      report_status: report.status,
      report_type: report.reportType,
      template_id: report.templateId,
      draft_text: report.draftText,
      structured: report.structured,
      evidence: report.evidence,
      ...(providerDraft
        ? {
            llm_provider_report: {
              ...providerDraft.result,
              ...(draftAudit ? { audit_log_id: draftAudit.id } : {}),
              provider: providerSnapshot(options.llmProvider!),
            },
          }
        : {}),
      ...(providerDraft?.error ? { llm_provider_error: providerDraft.error } : {}),
      ...(medicalReview
        ? {
            medical_review_assistant: {
              ...medicalReview.result,
              ...(reviewAudit ? { audit_log_id: reviewAudit.id } : {}),
              provider: providerSnapshot(options.medicalReviewProvider!),
            },
          }
        : {}),
      ...(medicalReview?.error ? { medical_review_error: medicalReview.error } : {}),
    },
    warnings: uniqueStrings([
      "doctor_review_required",
      context.tiradsResults.length === 0 ? "no_tirads_results_for_report" : undefined,
      ...(providerDraft?.warnings ?? []),
      ...(medicalReview?.warnings ?? []),
    ]),
  };
}

function buildDraftReportContext(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  now: number,
  options: MedicalAgentWorkerOptions = {}
): DraftReportContext {
  const studyId = requiredString(task.input.study_id, "study_id");
  const nodules = repo.listNodulesByStudy(studyId);
  const noduleById = new Map(nodules.map((nodule) => [nodule.id, nodule]));
  const modelResultEvidence = buildModelResultEvidence(repo, studyId, nodules);
  const tiradsResults = latestTiradsResultPerNodule(repo.listTiradsResultsByStudy(studyId), noduleById);
  const reportNodules = tiradsResults.map((result) => {
    const nodule = noduleById.get(result.noduleId);
    return {
      nodule_id: result.noduleId,
      nodule_index: nodule?.noduleIndex ?? null,
      tirads_result_id: result.id,
      score: result.score,
      category: result.category,
      recommendation: result.recommendation,
      evidence_rules: result.evidenceRules,
      segmentation: modelResultEvidence.segmentationByNoduleId.get(result.noduleId) ?? null,
      measurement: modelResultEvidence.measurementByNoduleId.get(result.noduleId) ?? null,
    };
  });
  const sections = buildReportSections(nodules, tiradsResults, noduleById, modelResultEvidence);
  const template = repo.getActiveReportTemplateText(THYROID_REPORT_TEMPLATE_ID) ?? THYROID_REPORT_TEMPLATE;
  const tiradsResultEvidence = reportNodules.map((item) => ({
    source: "tirads_result",
    nodule_id: item.nodule_id,
    tirads_result_id: item.tirads_result_id,
    evidence_rules: item.evidence_rules,
  }));
  const ruleCodes = uniqueStrings(tiradsResults.flatMap((result) => evidenceRuleCodes(result.evidenceRules)));
  const tiradsRuleEvidence = buildTiradsRuleEvidence(repo, ruleCodes);
  const guidelineEvidence = buildGuidelineEvidence(repo, tiradsResults, options);
  const knowledgeWarnings = uniqueStrings([
    ...guidelineEvidence.warnings,
    tiradsRuleEvidence.missingRuleCodes.length > 0
      ? `tirads_rule_missing:${tiradsRuleEvidence.missingRuleCodes.join(",")}`
      : undefined,
  ]);
  const knowledgeEvidence = [...tiradsRuleEvidence.evidence, ...guidelineEvidence.evidence];
  const evidence = [...tiradsResultEvidence, ...modelResultEvidence.evidence, ...knowledgeEvidence];
  sections.evidence_summary = formatReportEvidenceSummary(evidence);
  return {
    studyId,
    template,
    draftText: fillReportTemplate(template, sections),
    structured: {
      study_id: studyId,
      analysis_session_id: task.analysisSessionId,
      generator: "structured_template_validation",
      generated_at: now,
      sections,
      nodules: reportNodules,
      knowledge_evidence: {
        tirads_rule_count: tiradsRuleEvidence.evidence.length,
        missing_rule_codes: tiradsRuleEvidence.missingRuleCodes,
        guideline_chunk_count: guidelineEvidence.evidence.length,
        searches: guidelineEvidence.searches,
        warnings: knowledgeWarnings,
      },
      model_evidence: {
        segmentation_count: modelResultEvidence.segmentationByNoduleId.size,
        measurement_count: modelResultEvidence.measurementByNoduleId.size,
      },
      review_required: true,
    },
    evidence,
    sections,
    tiradsResults,
    knowledgeEvidence,
    knowledgeSearches: guidelineEvidence.searches,
    knowledgeWarnings,
  };
}

function persistDraftReport(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  workerId: string,
  context: DraftReportContext,
  input: {
    draftText: string;
    structured: JsonObject;
    now: number;
  }
): ReportRecord {
  return repo.createReport({
    studyId: context.studyId,
    analysisSessionId: task.analysisSessionId,
    reportType: "thyroid_ultrasound",
    status: "draft",
    templateId: THYROID_REPORT_TEMPLATE_ID,
    draftText: input.draftText,
    structured: input.structured,
    evidence: context.evidence,
    createdByAgent: workerId,
    now: input.now,
  });
}

async function draftReportWithProvider(
  task: AgentTaskRecord,
  context: DraftReportContext,
  options: MedicalAgentWorkerOptions
): Promise<ProviderDraftReport | null> {
  const provider = options.llmProvider;
  if (!provider) return null;

  let text = "";
  try {
    for await (const chunk of streamProviderResponse(provider, draftReportMessages(task, context), {
      fetchImpl: options.llmFetchImpl ?? fetch,
      disablePromptRedact: true,
    })) {
      text += chunk;
    }
  } catch (err) {
    return {
      result: {
        status: "provider_failed",
        provider: providerSnapshot(provider),
      },
      error: {
        code: "llm_provider_report_failed",
        message: err instanceof Error ? err.message : String(err),
        detail: providerSnapshot(provider),
      },
      warnings: ["llm_provider_report_failed"],
    };
  }

  const parsed = parseProviderJson(text);
  if (!parsed) {
    return {
      result: {
        status: "unstructured_response",
        raw_text: text.slice(0, 4000),
      },
      warnings: ["llm_provider_report_parse_failed"],
    };
  }

  const draftText = providerDraftText(parsed, context);
  return {
    result: parsed,
    draftText,
    warnings: uniqueStrings([
      ...optionalStringArray(parsed.warnings),
      draftText ? undefined : "llm_provider_report_missing_draft_text",
    ]),
  };
}

function draftReportMessages(task: AgentTaskRecord, context: DraftReportContext): EngineMessage[] {
  return [
    {
      id: `medical-report-draft-system-${task.id}`,
      role: "system",
      source: "local",
      text: [
        "你是甲状腺超声 AI 辅助报告草稿生成模型。",
        "只能根据输入的结构化结节、TI-RADS 规则结果、模板字段、规则库和医学知识库证据生成草稿。",
        "不得给出最终诊断，不得新增未提供的结节、尺寸、分级、建议或证据。",
        "涉及分级、随访、FNA 或安全边界的表达必须绑定 evidence 中的 tirads_rule 或 medical_guideline。",
        "必须保留医生审核确认提示；最终报告必须由医生确认。",
        "只输出 JSON，不要输出 Markdown。",
      ].join("\n"),
    },
    {
      id: `medical-report-draft-user-${task.id}`,
      role: "user",
      source: "local",
      text: JSON.stringify({
        task: "draft_thyroid_ultrasound_report",
        required_schema: {
          status: "drafted",
          draft_text: "string",
          sections: {
            thyroid_description: "string",
            nodule_descriptions: "string",
            tirads_summary: "string",
            recommendation: "string",
            evidence_summary: "string",
          },
          doctor_review_required: true,
          warnings: ["string"],
          limitations: ["string"],
        },
        constraints: [
          "Use only the supplied structured findings, TI-RADS rules, and medical knowledge evidence.",
          "Do not invent measurements, TI-RADS categories, FNA/follow-up recommendations, or diagnoses.",
          "If guideline evidence is missing, state that evidence is insufficient and keep doctor review required.",
          "Do not state malignancy as a final diagnosis.",
          "The report is an AI-assisted draft and must require doctor review.",
        ],
        template_id: THYROID_REPORT_TEMPLATE_ID,
        template: context.template,
        fallback_sections: context.sections,
        structured: context.structured,
        evidence: providerEvidencePack(context.evidence),
      }, null, 2),
    },
  ];
}

async function reviewReportWithMedicalProvider(
  task: AgentTaskRecord,
  context: DraftReportContext,
  draftText: string,
  options: MedicalAgentWorkerOptions
): Promise<ProviderMedicalReview | null> {
  const provider = options.medicalReviewProvider;
  if (!provider) return null;

  let text = "";
  try {
    for await (const chunk of streamProviderResponse(provider, medicalReviewMessages(task, context, draftText), {
      fetchImpl: options.medicalReviewFetchImpl ?? fetch,
      disablePromptRedact: true,
    })) {
      text += chunk;
    }
  } catch (err) {
    return {
      result: {
        status: "provider_failed",
        provider: providerSnapshot(provider),
      },
      error: {
        code: "medical_review_provider_failed",
        message: err instanceof Error ? err.message : String(err),
        detail: providerSnapshot(provider),
      },
      warnings: ["medical_review_provider_failed"],
    };
  }

  const parsed = parseProviderJson(text);
  if (!parsed) {
    return {
      result: {
        status: "unstructured_response",
        raw_text: text.slice(0, 4000),
      },
      warnings: ["medical_review_provider_parse_failed"],
    };
  }

  return {
    result: normalizeMedicalReviewResult(parsed),
    warnings: stringArrayValue(parsed.warnings),
  };
}

function medicalReviewMessages(
  task: AgentTaskRecord,
  context: DraftReportContext,
  draftText: string
): EngineMessage[] {
  return [
    {
      id: `medical-report-review-system-${task.id}`,
      role: "system",
      source: "local",
      text: [
        "你是医学复核辅助模型 MedGemma，用于复核甲状腺超声 AI 辅助报告草稿。",
        "你的任务是发现医学表达、安全风险、证据缺口和医生复核重点。",
        "你不能替代 Qwen3.6 生成主报告，不能改写 bbox，不能给出最终诊断。",
        "不要复述输入，不要输出 required_schema，不要输出 Markdown 代码块。",
        "只输出 JSON，不要输出 Markdown。",
      ].join("\n"),
    },
    {
      id: `medical-report-review-user-${task.id}`,
      role: "user",
      source: "local",
      text: JSON.stringify({
        task: "review_thyroid_ultrasound_report_draft",
        required_schema: {
          status: "reviewed",
          medical_expression_assessment: "acceptable | needs_revision | unsafe",
          safety_assessment: "safe | needs_review | unsafe",
          summary_zh: "string",
          doctor_review_focus: ["string"],
          suggested_edits: ["string"],
          warnings: ["string"],
          limitations: ["string"],
          role: "medical_review_assistant",
        },
        constraints: [
          "Return one JSON object only.",
          "Do not echo the input payload or schema.",
          "Do not rewrite the main report.",
          "Do not add or remove findings, measurements, TI-RADS categories, or recommendations.",
          "Check whether the report statements are supported by the supplied tirads_rule and medical_guideline evidence.",
          "Do not give a final diagnosis.",
          "Focus on medical expression, safety, evidence gaps, and doctor review priorities.",
        ],
        draft_text: draftText,
        structured: context.structured,
        evidence: providerEvidencePack(context.evidence),
      }, null, 2),
    },
  ];
}

function providerDraftText(parsed: JsonObject, context: DraftReportContext): string | undefined {
  const direct = optionalString(parsed.draft_text);
  if (direct) return direct;
  const providerSections = asJsonObject(parsed.sections);
  if (!providerSections) return undefined;
  const sections = { ...context.sections };
  for (const key of Object.keys(sections)) {
    const value = optionalString(providerSections[key]);
    if (value) sections[key] = value;
  }
  return fillReportTemplate(context.template, sections);
}

function normalizeMedicalReviewResult(parsed: JsonObject): JsonObject {
  return {
    ...parsed,
    status: optionalString(parsed.status) ?? "reviewed",
    doctor_review_focus: stringArrayValue(parsed.doctor_review_focus),
    suggested_edits: stringArrayValue(parsed.suggested_edits),
    warnings: stringArrayValue(parsed.warnings),
    limitations: stringArrayValue(parsed.limitations),
    role: "medical_review_assistant",
  };
}

function ensureDoctorReviewNotice(text: string): string {
  return /医生审核|医生确认|doctor review/i.test(text)
    ? text
    : `${text.trim()}\n\n提示：本报告为AI辅助草稿，需医生审核确认后生效。`;
}

function buildSafetyReviewTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  workerId: string,
  now: number
): JsonObject {
  const studyId = requiredString(task.input.study_id, "study_id");
  const report = latestReport(repo.listReportsByStudy(studyId));
  const rules = repo.listActiveSafetyRules();
  const bundle = repo.getStudyBundle(studyId);
  const issues = report ? evaluateSafetyRules(report, rules, bundle?.images ?? [], repo.listNodulesByStudy(studyId)) : [];
  const safetyStatus = report
    ? issues.length > 0
      ? "needs_doctor_review"
      : "passed_with_doctor_review_required"
    : "no_report";
  const audit = repo.createAuditLog({
    studyId,
    actorType: "agent",
    actorId: workerId,
    action: "medical.safety_review",
    targetType: report ? "report" : "study",
    targetId: report?.id ?? studyId,
    detail: {
      safety_status: safetyStatus,
      report_id: report?.id ?? null,
      issues,
      rules_checked: rules.map((rule) => rule.ruleCode),
    },
    traceId: task.id,
    now,
  });

  return {
    ...base,
    validation_mode: false,
    result: {
      safety_status: safetyStatus,
      report_id: report?.id ?? null,
      audit_log_id: audit.id,
      issues,
      rules_checked: rules.length,
    },
    warnings: uniqueStrings([
      "doctor_review_required",
      report ? undefined : "no_report_for_safety_review",
      issues.length > 0 ? "safety_issues_detected" : undefined,
    ]),
  };
}

async function buildSafetyReviewTaskOutputAsync(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions
): Promise<JsonObject> {
  const output = buildSafetyReviewTaskOutput(repo, task, base, workerId, now);
  const reportId = optionalString((output.result as JsonObject | undefined)?.report_id);
  const report = reportId ? repo.getReport(reportId) : null;
  if (!report || !options.medicalReviewProvider) return output;

  const studyId = requiredString(task.input.study_id, "study_id");
  const medicalReview = await reviewPersistedReportWithMedicalProvider(task, report, options);
  const warnings = uniqueStrings([...optionalStringArray(output.warnings), ...(medicalReview?.warnings ?? [])]);
  if (!medicalReview) return { ...output, warnings };

  if (medicalReview.error) {
    return {
      ...output,
      result: {
        ...(output.result as JsonObject),
        medical_review_error: medicalReview.error,
      },
      warnings,
    };
  }

  const structured = {
    ...report.structured,
    medical_review_assistant: medicalReview.result,
    medical_review_provider: providerSnapshot(options.medicalReviewProvider),
  };
  repo.updateReportStructured(report.id, structured, now);
  const audit = repo.createAuditLog({
    studyId,
    actorType: "agent",
    actorId: workerId,
    action: "medical.report.medgemma_review",
    targetType: "report",
    targetId: report.id,
    detail: {
      provider: providerSnapshot(options.medicalReviewProvider),
      result: medicalReview.result,
      mode: "safety_review",
    },
    traceId: task.id,
    now,
  });

  return {
    ...output,
    result: {
      ...(output.result as JsonObject),
      medical_review_assistant: {
        ...medicalReview.result,
        audit_log_id: audit.id,
        provider: providerSnapshot(options.medicalReviewProvider),
      },
    },
    warnings,
  };
}

async function reviewPersistedReportWithMedicalProvider(
  task: AgentTaskRecord,
  report: ReportRecord,
  options: MedicalAgentWorkerOptions
): Promise<ProviderMedicalReview | null> {
  const provider = options.medicalReviewProvider;
  if (!provider) return null;
  let text = "";
  try {
    for await (const chunk of streamProviderResponse(provider, persistedReportReviewMessages(task, report), {
      fetchImpl: options.medicalReviewFetchImpl ?? fetch,
      disablePromptRedact: true,
    })) {
      text += chunk;
    }
  } catch (err) {
    return {
      result: {
        status: "provider_failed",
        provider: providerSnapshot(provider),
      },
      error: {
        code: "medical_review_provider_failed",
        message: err instanceof Error ? err.message : String(err),
        detail: providerSnapshot(provider),
      },
      warnings: ["medical_review_provider_failed"],
    };
  }
  const parsed = parseProviderJson(text);
  if (!parsed) {
    return {
      result: {
        status: "unstructured_response",
        raw_text: text.slice(0, 4000),
      },
      warnings: ["medical_review_provider_parse_failed"],
    };
  }
  return {
    result: normalizeMedicalReviewResult(parsed),
    warnings: stringArrayValue(parsed.warnings),
  };
}

function persistedReportReviewMessages(task: AgentTaskRecord, report: ReportRecord): EngineMessage[] {
  return [
    {
      id: `medical-report-review-system-${task.id}`,
      role: "system",
      source: "local",
      text: [
        "你是医学复核辅助模型 MedGemma，用于复核甲状腺超声 AI 辅助报告草稿。",
        "你的任务是发现医学表达、安全风险、证据缺口和医生复核重点。",
        "你不能替代 Qwen3.6 生成主报告，不能改写 bbox，不能给出最终诊断。",
        "不要复述输入，不要输出 schema，不要输出 Markdown 代码块。",
        "只输出 JSON，不要输出 Markdown。",
      ].join("\n"),
    },
    {
      id: `medical-report-review-user-${task.id}`,
      role: "user",
      source: "local",
      text: [
        "请复核下面这份甲状腺超声 AI 辅助报告草稿。",
        "只输出一个 JSON 对象，不要复述输入，不要输出 Markdown，不要输出 schema。",
        "JSON 字段必须包含：status, medical_expression_assessment, safety_assessment, summary_zh, doctor_review_focus, suggested_edits, warnings, limitations, role。",
        "status 固定为 reviewed；role 固定为 medical_review_assistant。",
        "不要改写报告，不要新增或删除结节、尺寸、TI-RADS 分级、建议或诊断；只指出医学表达、安全风险、证据缺口和医生复核重点。",
        "",
        `report_id: ${report.id}`,
        "",
        "报告草稿：",
        report.draftText ?? "",
        "",
        "结构化摘要：",
        formatStructuredForReview(compactReportStructured(report.structured)),
        "",
        "证据摘要：",
        formatEvidenceForReview(compactEvidenceForReview(asRecordArray(report.evidence))),
      ].join("\n"),
    },
  ];
}

function isModelTask(taskType: string): boolean {
  return taskType === "detect_nodules" || taskType === "segment_nodules" || taskType === "measure_nodules";
}

function modelJobTypeForTask(taskType: string): string | undefined {
  if (taskType === "detect_nodules") return DETECT_JOB_TYPE;
  if (taskType === "segment_nodules") return SEGMENT_JOB_TYPE;
  if (taskType === "measure_nodules") return MEASURE_JOB_TYPE;
  return undefined;
}

function findTaskModelJob(repo: MedicalCaseRepo, task: AgentTaskRecord): ModelJobRecord | null {
  const jobType = modelJobTypeForTask(task.taskType);
  return jobType ? repo.findModelJobByAgentTask(task.id, jobType) : null;
}

function modelJobSuccessOutput(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number
): JsonObject {
  if (modelJob.jobType === SEGMENT_JOB_TYPE) return segmentationSuccessOutput(repo, modelJob, workerId, now);
  if (modelJob.jobType === MEASURE_JOB_TYPE) return measurementSuccessOutput(repo, modelJob, workerId, now);
  return detectorSuccessOutput(repo, modelJob, workerId, now);
}

async function modelJobSuccessOutputAsync(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions
): Promise<JsonObject> {
  if (modelJob.jobType !== DETECT_JOB_TYPE) return modelJobSuccessOutput(repo, modelJob, workerId, now);
  return detectorSuccessOutputAsync(repo, modelJob, workerId, now, options);
}

function detectorSuccessOutput(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number
): JsonObject {
  const persistedNodules = persistDetectorNodules(repo, modelJob, now);
  return {
    status: "ok",
    worker_id: workerId,
    model_job_id: modelJob.id,
    job_type: modelJob.jobType,
    result: modelJob.output ?? {},
    artifact_uri: modelJob.artifactUri,
    persisted_nodules: persistedNodules,
  };
}

function segmentationSuccessOutput(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number
): JsonObject {
  const persistedSegmentations = persistSegmentations(repo, modelJob, now);
  return {
    status: "ok",
    worker_id: workerId,
    model_job_id: modelJob.id,
    job_type: modelJob.jobType,
    result: modelJob.output ?? {},
    artifact_uri: modelJob.artifactUri,
    persisted_segmentations: persistedSegmentations,
    warnings: optionalStringArray(modelJob.output?.warnings),
  };
}

function measurementSuccessOutput(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number
): JsonObject {
  const persistedMeasurements = persistMeasurements(repo, modelJob, now);
  return {
    status: "ok",
    worker_id: workerId,
    model_job_id: modelJob.id,
    job_type: modelJob.jobType,
    result: modelJob.output ?? {},
    artifact_uri: modelJob.artifactUri,
    persisted_measurements: persistedMeasurements,
    warnings: optionalStringArray(modelJob.output?.warnings),
  };
}

async function detectorSuccessOutputAsync(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions
): Promise<JsonObject> {
  const output = detectorSuccessOutput(repo, modelJob, workerId, now);
  const llmEvaluation = await evaluateDetectorResultWithProvider(repo, modelJob, workerId, now, options);
  if (!llmEvaluation) return output;
  return {
    ...output,
    result: {
      ...(asJsonObject(output.result) ?? {}),
      llm_provider_evaluation: llmEvaluation.result,
      ...(llmEvaluation.error ? { llm_provider_error: llmEvaluation.error } : {}),
    },
    warnings: uniqueStrings([
      ...optionalStringArray(output.warnings),
      ...llmEvaluation.warnings,
    ]),
  };
}

function queueAutomaticDownstreamTask(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  modelJob: ModelJobRecord,
  output: JsonObject,
  now: number
): JsonObject | null {
  if (hasExplicitChildTask(repo, task)) return null;
  if (modelJob.jobType === DETECT_JOB_TYPE) {
    const persistedNodules = asRecordArray(output.persisted_nodules);
    if (persistedNodules.length === 0) return null;
    return createAutomaticAgentTask(repo, task, {
      taskType: "segment_nodules",
      agentName: "segment_nodules_agent",
      input: {
        study_id: modelJob.studyId ?? task.input.study_id,
        image_id: modelJob.imageId ?? task.input.image_id,
        model: DEFAULT_SEGMENT_MODEL,
        model_version: DEFAULT_SEGMENT_MODEL_VERSION,
        allow_bbox_fallback: !realInferenceStrict(),
        auto_queued_from_task_id: task.id,
        auto_queued_from_job_type: modelJob.jobType,
      },
      now,
    });
  }
  if (modelJob.jobType === SEGMENT_JOB_TYPE) {
    const persistedSegmentations = asRecordArray(output.persisted_segmentations);
    if (persistedSegmentations.length === 0) return null;
    return createAutomaticAgentTask(repo, task, {
      taskType: "measure_nodules",
      agentName: "measure_nodules_agent",
      input: {
        study_id: modelJob.studyId ?? task.input.study_id,
        image_id: modelJob.imageId ?? task.input.image_id,
        model: DEFAULT_MEASURE_MODEL,
        model_version: DEFAULT_MEASURE_MODEL_VERSION,
        auto_queued_from_task_id: task.id,
        auto_queued_from_job_type: modelJob.jobType,
      },
      now,
    });
  }
  return null;
}

function createAutomaticAgentTask(
  repo: MedicalCaseRepo,
  parentTask: AgentTaskRecord,
  input: {
    taskType: string;
    agentName: string;
    input: JsonObject;
    now: number;
  }
): JsonObject {
  const task = repo.createAgentTask({
    analysisSessionId: parentTask.analysisSessionId,
    parentTaskId: parentTask.id,
    agentName: input.agentName,
    taskType: input.taskType,
    input: input.input,
    now: input.now,
  });
  return {
    task_id: task.id,
    task_type: task.taskType,
    parent_task_id: task.parentTaskId,
    status: task.status,
    input: task.input,
  };
}

function hasExplicitChildTask(repo: MedicalCaseRepo, task: AgentTaskRecord): boolean {
  const studyId = optionalString(task.input.study_id) ?? repo.getAnalysisSession(task.analysisSessionId)?.studyId;
  if (!studyId) return false;
  const bundle = repo.getStudyBundle(studyId);
  return (
    bundle?.agentTasks.some(
      (candidate) => candidate.analysisSessionId === task.analysisSessionId && candidate.parentTaskId === task.id
    ) ?? false
  );
}

async function evaluateDetectorResultWithProvider(
  repo: MedicalCaseRepo,
  modelJob: ModelJobRecord,
  workerId: string,
  now: number,
  options: MedicalAgentWorkerOptions
): Promise<{ result: JsonObject; warnings: string[]; error?: JsonObject } | null> {
  const provider = options.llmProvider;
  if (!provider) return null;
  const detectorOutput = asJsonObject(modelJob.output);
  const pendingPack = asJsonObject(detectorOutput?.llm_evaluation);
  if (!pendingPack) return null;

  const messages = detectorEvaluationMessages(modelJob, detectorOutput, pendingPack);
  let text = "";
  try {
    for await (const chunk of streamProviderResponse(provider, messages, {
      fetchImpl: options.llmFetchImpl ?? fetch,
      disablePromptRedact: true,
    })) {
      text += chunk;
    }
  } catch (err) {
    const error = {
      code: "llm_provider_evaluation_failed",
      message: err instanceof Error ? err.message : String(err),
      detail: providerSnapshot(provider),
    };
    return {
      result: {
        status: "provider_failed",
        provider: providerSnapshot(provider),
      },
      error,
      warnings: ["llm_provider_evaluation_failed"],
    };
  }

  const parsed = parseProviderJson(text);
  const result = parsed ?? {
    status: "unstructured_response",
    raw_text: text.slice(0, 4000),
  };
  const warnings = parsed ? [] : ["llm_provider_evaluation_parse_failed"];
  const audit = repo.createAuditLog({
    studyId: modelJob.studyId,
    actorType: "agent",
    actorId: workerId,
    action: "medical.detector.llm_evaluation",
    targetType: "model_job",
    targetId: modelJob.id,
    detail: {
      provider: providerSnapshot(provider),
      model_job_id: modelJob.id,
      artifact_uri: modelJob.artifactUri,
      result,
      warnings,
    },
    traceId: modelJob.agentTaskId ?? modelJob.id,
    now,
  });
  return {
    result: {
      ...result,
      audit_log_id: audit.id,
      provider: providerSnapshot(provider),
    },
    warnings,
  };
}

function detectorEvaluationMessages(
  modelJob: ModelJobRecord,
  detectorOutput: JsonObject | undefined,
  pendingPack: JsonObject
): EngineMessage[] {
  const comparison = asJsonObject(detectorOutput?.comparison);
  const nodules = asRecordArray(detectorOutput?.nodules).map((nodule) => ({
    nodule_index: nodule.nodule_index,
    bbox: nodule.bbox,
    confidence: nodule.confidence,
    model_name: nodule.model_name,
  }));
  return [
    {
      id: `medical-detector-eval-system-${modelJob.id}`,
      role: "system",
      source: "local",
      text: [
        "你是甲状腺超声 AI 辅助系统的结构化复核模型。",
        "只根据输入的结构化检测结果、IoU 对比和模型元数据输出复核意见。",
        "严禁新增、删除或移动 bbox 坐标；不得给出最终诊断；必须提示医生最终确认。",
        "只输出 JSON，不要输出 Markdown。",
      ].join("\n"),
    },
    {
      id: `medical-detector-eval-user-${modelJob.id}`,
      role: "user",
      source: "local",
      text: JSON.stringify({
        task: "evaluate_thyroid_detector_consensus",
        required_schema: {
          status: "reviewed",
          overall_assessment: "consistent | needs_review | unsafe",
          summary_zh: "string",
          doctor_review_focus: ["string"],
          warnings: ["string"],
          bbox_policy: "must_not_modify_bbox",
        },
        model_job: {
          id: modelJob.id,
          study_id: modelJob.studyId,
          image_id: modelJob.imageId,
          artifact_uri: modelJob.artifactUri,
        },
        llm_evaluation_pack: pendingPack,
        comparison,
        nodules,
      }, null, 2),
    },
  ];
}

function parseProviderJson(text: string): JsonObject | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = parseJson(trimmed);
  if (isJsonObject(direct)) return direct;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const extracted = parseJson(trimmed.slice(start, end + 1));
  return isJsonObject(extracted) ? extracted : null;
}

function providerSnapshot(provider: ProviderStatus): JsonObject {
  return {
    instance_id: provider.instanceId,
    type: provider.type,
    model: provider.model,
    display_name: provider.displayName,
  };
}

function requiredString(value: unknown, name: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`${name} is required`);
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringArrayValue(value: unknown): string[] {
  const direct = optionalString(value);
  if (direct) return [direct];
  return optionalStringArray(value).filter((item) => item.trim().length > 0);
}

function deriveImageQuality(result: JsonObject, isAnalyzable: boolean | undefined, fallback: string | null): string {
  const explicit = optionalString(result.image_quality);
  if (explicit) return explicit;
  if (isAnalyzable === undefined) return fallback ?? "unchecked";
  return isAnalyzable ? "analyzable" : "not_analyzable";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.status === "ok" || record.status === "error";
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

interface SafetyIssue extends JsonObject {
  rule_code: string;
  severity: string;
  rule_type: string;
  message: string;
}

function latestReport(reports: ReportRecord[]): ReportRecord | null {
  return reports.length > 0 ? reports[reports.length - 1] : null;
}

function evaluateSafetyRules(
  report: ReportRecord,
  rules: SafetyRuleRecord[],
  images: ImageRecord[],
  nodules: NoduleRecord[]
): SafetyIssue[] {
  const text = report.draftText ?? report.finalText ?? "";
  const issues: SafetyIssue[] = [];
  for (const rule of rules) {
    const issue = evaluateSafetyRule(rule, report, text, images, nodules);
    if (issue) issues.push(issue);
  }
  return issues;
}

function evaluateSafetyRule(
  rule: SafetyRuleRecord,
  report: ReportRecord,
  text: string,
  images: ImageRecord[],
  nodules: NoduleRecord[]
): SafetyIssue | null {
  const patternMatch = matchRulePattern(rule, text);
  if (patternMatch) {
    return safetyIssue(rule, { matched_text: patternMatch });
  }

  if (rule.ruleCode === "NO_UNSUPPORTED_FNA_RECOMMENDATION" && mentionsIntervention(text) && !reportHasEvidence(report)) {
    return safetyIssue(rule, { missing_evidence: "tirads_rules" });
  }

  if (rule.ruleCode === "BLOCK_LOW_CONFIDENCE_AUTOMATION") {
    const minImageQualityScore = optionalNumber(rule.rule.min_image_quality_score) ?? 0.55;
    const minDetectionConfidence = optionalNumber(rule.rule.min_detection_confidence) ?? 0.5;
    const lowQualityImage = images.find(
      (image) => image.qualityScore !== null && image.qualityScore < minImageQualityScore
    );
    const lowConfidenceNodule = nodules.find(
      (nodule) => nodule.detectionConfidence !== null && nodule.detectionConfidence < minDetectionConfidence
    );
    if (lowQualityImage || lowConfidenceNodule) {
      return safetyIssue(rule, {
        image_id: lowQualityImage?.id,
        image_quality_score: lowQualityImage?.qualityScore,
        nodule_id: lowConfidenceNodule?.id,
        detection_confidence: lowConfidenceNodule?.detectionConfidence,
      });
    }
  }

  if (rule.ruleCode === "REQUIRE_MANUAL_CALIBRATION_FOR_MM" && mentionsMillimeter(text) && !hasPixelSpacing(images)) {
    return safetyIssue(rule, { missing: "pixel_spacing" });
  }

  return null;
}

function matchRulePattern(rule: SafetyRuleRecord, text: string): string | null {
  if (!rule.pattern) return null;
  try {
    const match = text.match(new RegExp(rule.pattern, "i"));
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

function safetyIssue(rule: SafetyRuleRecord, detail: JsonObject = {}): SafetyIssue {
  return {
    rule_code: rule.ruleCode,
    severity: rule.severity,
    rule_type: rule.ruleType,
    message: rule.message,
    ...detail,
  };
}

function mentionsIntervention(text: string): boolean {
  return /\bFNA\b|穿刺|活检|随访|follow[- ]?up/i.test(text);
}

function mentionsMillimeter(text: string): boolean {
  return /\bmm\b|毫米/.test(text);
}

function reportHasEvidence(report: ReportRecord): boolean {
  const evidence = report.evidence.length > 0 ? report.evidence : asRecordArray(report.structured.evidence);
  return evidence.some((item) => evidenceRuleCodesFromValue(item).length > 0);
}

function evidenceRuleCodesFromValue(value: unknown): string[] {
  const record = asJsonObject(value);
  if (!record) return [];
  const direct = optionalString(record.rule_code) ?? optionalString(record.code);
  if (direct) return [direct];
  return asRecordArray(record.evidence_rules).flatMap((item) => evidenceRuleCodesFromValue(item));
}

function hasPixelSpacing(images: ImageRecord[]): boolean {
  return images.some((image) => Object.keys(image.pixelSpacing).length > 0);
}

function latestTiradsResultPerNodule(
  results: TiradsResultRecord[],
  noduleById: Map<string, NoduleRecord>
): TiradsResultRecord[] {
  const latest = new Map<string, TiradsResultRecord>();
  for (const result of results) {
    latest.set(result.noduleId, result);
  }
  return [...latest.values()].sort((left, right) => {
    const leftIndex = noduleById.get(left.noduleId)?.noduleIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = noduleById.get(right.noduleId)?.noduleIndex ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
  });
}

interface TiradsRuleEvidenceResult {
  evidence: JsonObject[];
  missingRuleCodes: string[];
}

interface GuidelineEvidenceResult {
  evidence: JsonObject[];
  searches: JsonObject[];
  warnings: string[];
}

function buildTiradsRuleEvidence(repo: MedicalCaseRepo, ruleCodes: string[]): TiradsRuleEvidenceResult {
  const codes = uniqueStrings(ruleCodes);
  if (codes.length === 0) return { evidence: [], missingRuleCodes: [] };
  const rules = repo.listActiveTiradsRulesByCodes(codes);
  const found = new Set(rules.map((rule) => rule.ruleCode));
  return {
    evidence: rules.map(tiradsRuleToEvidence),
    missingRuleCodes: codes.filter((code) => !found.has(code)),
  };
}

function tiradsRuleToEvidence(rule: TiradsRuleRecord): JsonObject {
  return {
    source: "tirads_rule",
    rule_code: rule.ruleCode,
    system_name: rule.systemName,
    system_version: rule.systemVersion,
    feature_group: rule.featureGroup,
    feature_name: rule.featureName,
    points: rule.points,
    category: rule.category,
    min_score: rule.minScore,
    max_score: rule.maxScore,
    recommendation: rule.recommendation,
    rule: rule.rule,
    evidence_document_id: rule.evidenceDocumentId,
    status: rule.status,
  };
}

function buildGuidelineEvidence(
  repo: MedicalCaseRepo,
  tiradsResults: TiradsResultRecord[],
  options: MedicalAgentWorkerOptions
): GuidelineEvidenceResult {
  const queries = guidelineEvidenceQueries(tiradsResults);
  const evidence = new Map<string, JsonObject>();
  const searches: JsonObject[] = [];
  const warnings: string[] = [];

  for (const query of queries) {
    const result = repo.searchMedicalKnowledge({
      query,
      topK: options.knowledgeTopK ?? 3,
      filters: { bodyPart: "thyroid" },
    }, {
      dataDbPath: options.dataDbPath,
      ragDbPath: options.ragDbPath,
      workspace: options.workspace ?? process.cwd(),
    });
    searches.push({
      query: result.query,
      mode: result.mode,
      count: result.count,
      warnings: result.warnings,
    });
    warnings.push(...result.warnings);
    for (const item of result.evidence) {
      if (!evidence.has(item.chunkId)) evidence.set(item.chunkId, guidelineEvidenceToReportEvidence(item));
    }
  }

  return {
    evidence: [...evidence.values()],
    searches,
    warnings: uniqueStrings(warnings),
  };
}

function guidelineEvidenceQueries(tiradsResults: TiradsResultRecord[]): string[] {
  const queries = new Set<string>();
  for (const result of tiradsResults) {
    const recommendation = (result.recommendation ?? "").toLowerCase();
    const terms = ["ACR", "TI", "RADS", result.category ?? "", "thyroid", "nodule", "guideline"];
    if (/follow|随访/.test(recommendation)) terms.push("follow", "follow_up", "threshold");
    if (/fna|穿刺/.test(recommendation)) terms.push("FNA", "threshold");
    queries.add(terms.filter(Boolean).join(" "));
  }
  queries.add("AI report generation evidence required doctor review ACR TI RADS thyroid");
  return [...queries].slice(0, 4);
}

function guidelineEvidenceToReportEvidence(item: MedicalKnowledgeEvidence): JsonObject {
  return {
    source: "medical_guideline",
    chunk_id: item.chunkId,
    score: item.score,
    hits: item.hits,
    text: item.text.slice(0, 2000),
    document: item.document,
    metadata: item.metadata,
  };
}

function buildModelResultEvidence(
  repo: MedicalCaseRepo,
  studyId: string,
  nodules: NoduleRecord[]
): ModelResultEvidenceContext {
  const noduleByIndex = new Map(nodules.map((nodule) => [nodule.noduleIndex, nodule]));
  const segmentationByNoduleId = new Map<string, JsonObject>();
  const measurementByNoduleId = new Map<string, JsonObject>();
  for (const modelJob of repo.listModelJobsByStudy(studyId)) {
    if (modelJob.status !== "succeeded") continue;
    if (modelJob.jobType === SEGMENT_JOB_TYPE) {
      for (const item of asRecordArray(modelJob.output?.segmentations)) {
        const nodule = resolveNoduleFromOutput(repo, studyId, item, noduleByIndex, segmentationByNoduleId.size);
        if (!nodule) continue;
        segmentationByNoduleId.set(nodule.id, {
          source: "segmentation_result",
          nodule_id: nodule.id,
          nodule_index: nodule.noduleIndex,
          model_job_id: modelJob.id,
          artifact_uri: modelJob.artifactUri,
          model_name: optionalString(item.model_name) ?? modelJob.modelName,
          model_version: optionalString(item.model_version) ?? modelJob.modelVersion,
          segmentation_source: optionalString(item.segmentation_source) ?? "unknown",
          mask_uri: optionalString(item.mask_uri) ?? nodule.maskUri,
          confidence: optionalNumber(item.confidence),
          requires_doctor_review: optionalBoolean(item.requires_doctor_review) ?? true,
          metadata: asJsonObject(item.metadata) ?? {},
        });
      }
    }
    if (modelJob.jobType === MEASURE_JOB_TYPE) {
      for (const item of asRecordArray(modelJob.output?.measurements)) {
        const nodule = resolveNoduleFromOutput(repo, studyId, item, noduleByIndex, measurementByNoduleId.size);
        if (!nodule) continue;
        measurementByNoduleId.set(nodule.id, {
          source: "measurement_result",
          nodule_id: nodule.id,
          nodule_index: nodule.noduleIndex,
          model_job_id: modelJob.id,
          artifact_uri: modelJob.artifactUri,
          model_name: modelJob.modelName,
          model_version: modelJob.modelVersion,
          measurement_source: optionalString(item.measurement_source) ?? "unknown",
          long_axis_mm: optionalNullableNumber(item.long_axis_mm),
          short_axis_mm: optionalNullableNumber(item.short_axis_mm),
          ap_axis_mm: optionalNullableNumber(item.ap_axis_mm),
          area_mm2: optionalNullableNumber(item.area_mm2),
          aspect_ratio: optionalNullableNumber(item.aspect_ratio),
          pixel_measurements: asJsonObject(item.pixel_measurements) ?? {},
          confidence: optionalNullableNumber(item.confidence),
          requires_doctor_review: optionalBoolean(item.requires_doctor_review) ?? true,
        });
      }
    }
  }
  return {
    segmentationByNoduleId,
    measurementByNoduleId,
    evidence: [...segmentationByNoduleId.values(), ...measurementByNoduleId.values()],
  };
}

function providerEvidencePack(evidence: JsonObject[]): JsonObject[] {
  return evidence.map((item) => {
    const source = optionalString(item.source);
    if (source === "medical_guideline") {
      const document = asJsonObject(item.document);
      const metadata = asJsonObject(item.metadata);
      return {
        source,
        chunk_id: item.chunk_id,
        score: item.score,
        document: {
          id: document?.id,
          title: document?.title,
          source_name: document?.sourceName,
          version: document?.version,
          review_status: document?.reviewStatus,
        },
        section_title: metadata?.sectionTitle,
        chunk_type: metadata?.chunkType,
        evidence_level: metadata?.evidenceLevel,
        tirads_system: metadata?.tiradsSystem,
        body_part: metadata?.bodyPart,
        text: optionalString(item.text)?.slice(0, 700),
      };
    }
    if (source === "tirads_rule") {
      return {
        source,
        rule_code: item.rule_code,
        system_name: item.system_name,
        system_version: item.system_version,
        feature_group: item.feature_group,
        category: item.category,
        recommendation: item.recommendation,
        rule: item.rule,
        evidence_document_id: item.evidence_document_id,
      };
    }
    if (source === "segmentation_result" || source === "measurement_result") {
      return {
        source,
        nodule_id: item.nodule_id,
        nodule_index: item.nodule_index,
        model_job_id: item.model_job_id,
        artifact_uri: item.artifact_uri,
        model_name: item.model_name,
        model_version: item.model_version,
        segmentation_source: item.segmentation_source,
        measurement_source: item.measurement_source,
        mask_uri: item.mask_uri,
        long_axis_mm: item.long_axis_mm,
        short_axis_mm: item.short_axis_mm,
        pixel_measurements: item.pixel_measurements,
        metadata: item.metadata,
      };
    }
    return item;
  });
}

function compactReportStructured(structured: JsonObject): JsonObject {
  return {
    generator: structured.generator,
    review_required: structured.review_required,
    nodules: structured.nodules,
    knowledge_evidence: structured.knowledge_evidence,
    model_evidence: structured.model_evidence,
    sections: {
      tirads_summary: asJsonObject(structured.sections)?.tirads_summary,
      recommendation: asJsonObject(structured.sections)?.recommendation,
      evidence_summary: asJsonObject(structured.sections)?.evidence_summary,
    },
  };
}

function compactEvidenceForReview(evidence: JsonObject[]): JsonObject[] {
  return evidence.map((item) => {
    const source = optionalString(item.source);
    if (source === "medical_guideline") {
      const document = asJsonObject(item.document);
      const metadata = asJsonObject(item.metadata);
      return {
        source,
        chunk_id: item.chunk_id,
        document_title: document?.title,
        document_version: document?.version,
        review_status: document?.reviewStatus,
        section_title: metadata?.sectionTitle,
        evidence_level: metadata?.evidenceLevel,
        text: optionalString(item.text)?.slice(0, 280),
      };
    }
    if (source === "tirads_rule") {
      return {
        source,
        rule_code: item.rule_code,
        system_version: item.system_version,
        category: item.category,
        recommendation: item.recommendation,
        rule: item.rule,
      };
    }
    if (source === "segmentation_result" || source === "measurement_result") {
      return {
        source,
        nodule_id: item.nodule_id,
        nodule_index: item.nodule_index,
        model_name: item.model_name,
        model_version: item.model_version,
        segmentation_source: item.segmentation_source,
        measurement_source: item.measurement_source,
        artifact_uri: item.artifact_uri,
        mask_uri: item.mask_uri,
        long_axis_mm: item.long_axis_mm,
        short_axis_mm: item.short_axis_mm,
        pixel_measurements: item.pixel_measurements,
        metadata: item.metadata,
      };
    }
    return {
      source,
      nodule_id: item.nodule_id,
      tirads_result_id: item.tirads_result_id,
      evidence_rules: item.evidence_rules,
    };
  });
}

function formatStructuredForReview(structured: JsonObject): string {
  const nodules = asRecordArray(structured.nodules)
    .map((nodule) => {
      const index = nodule.nodule_index ?? "未知";
      return `结节${index}: score=${nodule.score ?? "未知"}, category=${nodule.category ?? "未知"}, recommendation=${nodule.recommendation ?? "无"}`;
    })
    .join("\n");
  const sections = asJsonObject(structured.sections) ?? {};
  const knowledge = asJsonObject(structured.knowledge_evidence) ?? {};
  return [
    `generator: ${optionalString(structured.generator) ?? "unknown"}`,
    `review_required: ${structured.review_required === true ? "true" : "unknown"}`,
    nodules || "无结构化结节摘要",
    `recommendation: ${optionalString(sections.recommendation) ?? "无"}`,
    `evidence_summary: ${optionalString(sections.evidence_summary) ?? "无"}`,
    `knowledge: tirads_rule_count=${knowledge.tirads_rule_count ?? 0}, guideline_chunk_count=${knowledge.guideline_chunk_count ?? 0}`,
  ].join("\n");
}

function formatEvidenceForReview(evidence: JsonObject[]): string {
  return evidence
    .slice(0, 8)
    .map((item, index) => {
      const source = optionalString(item.source) ?? "unknown";
      if (source === "medical_guideline") {
        return `${index + 1}. medical_guideline ${item.chunk_id ?? ""}: ${item.section_title ?? ""}; ${item.text ?? ""}`;
      }
      if (source === "tirads_rule") {
        return `${index + 1}. tirads_rule ${item.rule_code ?? ""}: category=${item.category ?? ""}; recommendation=${item.recommendation ?? ""}`;
      }
      return `${index + 1}. ${source}: ${JSON.stringify(item).slice(0, 260)}`;
    })
    .join("\n");
}

function formatReportEvidenceSummary(evidence: JsonObject[]): string {
  const ruleCodes = uniqueStrings([
    ...evidence.flatMap((item) => {
      if (item.source === "tirads_result") return asRecordArray(item.evidence_rules).flatMap(evidenceRuleCodesFromValue);
      return [];
    }),
    ...evidence.flatMap((item) => (item.source === "tirads_rule" ? [optionalString(item.rule_code)] : [])),
  ]);
  const guidelineRefs = uniqueStrings(
    evidence.flatMap((item) => {
      if (item.source !== "medical_guideline") return [];
      const document = asJsonObject(item.document);
      const metadata = asJsonObject(item.metadata);
      const title = optionalString(document?.title);
      const section = optionalString(metadata?.sectionTitle);
      const chunkId = optionalString(item.chunk_id);
      return title && chunkId ? [`${title}${section ? `/${section}` : ""}(${chunkId})`] : [];
    })
  ).slice(0, 3);
  const modelRefs = uniqueStrings(
    evidence.flatMap((item) => {
      if (item.source === "segmentation_result") {
        return [`分割-结节${item.nodule_index ?? "未知"}:${item.segmentation_source ?? item.model_name ?? "unknown"}`];
      }
      if (item.source === "measurement_result") {
        return [`测量-结节${item.nodule_index ?? "未知"}:${item.measurement_source ?? item.model_name ?? "unknown"}`];
      }
      return [];
    })
  ).slice(0, 4);
  const parts = [
    modelRefs.length > 0 ? `模型结果：${modelRefs.join("；")}` : undefined,
    ruleCodes.length > 0 ? `规则库：${ruleCodes.join("、")}` : undefined,
    guidelineRefs.length > 0 ? `知识库：${guidelineRefs.join("；")}` : undefined,
  ];
  return uniqueStrings(parts).join("\n") || "暂无规则或知识库证据，需医生复核。";
}

function buildReportSections(
  nodules: NoduleRecord[],
  tiradsResults: TiradsResultRecord[],
  noduleById: Map<string, NoduleRecord>,
  modelEvidence: ModelResultEvidenceContext
): Record<string, string> {
  const noduleDescriptions =
    tiradsResults.length > 0
      ? tiradsResults
          .map((result) => formatNoduleDescription(result, noduleById.get(result.noduleId), modelEvidence))
          .join("\n")
      : formatUnclassifiedNodules(nodules, modelEvidence);
  const tiradsSummary =
    tiradsResults.length > 0
      ? tiradsResults
          .map((result) => {
            const nodule = noduleById.get(result.noduleId);
            const category = result.category ?? "未分级";
            const score = result.score ?? "未计算";
            return `结节${nodule?.noduleIndex ?? "未知"}：${category}，评分${score}分。`;
          })
          .join("\n")
      : "暂无可用TI-RADS结构化分级。";
  const recommendations = uniqueStrings(tiradsResults.map((result) => result.recommendation ?? undefined));
  const evidenceCodes = uniqueStrings(tiradsResults.flatMap((result) => evidenceRuleCodes(result.evidenceRules)));

  return {
    thyroid_description: "甲状腺超声图像已进入AI辅助分析流程；以下内容仅汇总已结构化AI结果。",
    nodule_descriptions: noduleDescriptions,
    tirads_summary: tiradsSummary,
    recommendation: recommendations.length > 0 ? recommendations.join("\n") : "暂无自动建议，需医生审核。",
    evidence_summary: evidenceCodes.length > 0 ? evidenceCodes.join("、") : "暂无规则证据。",
  };
}

function formatUnclassifiedNodules(nodules: NoduleRecord[], modelEvidence: ModelResultEvidenceContext): string {
  if (nodules.length === 0) return "未检测到结构化结节结果，需医生结合图像复核。";
  return nodules
    .map((nodule) => {
      const modelSummary = formatModelResultForReport(nodule.id, modelEvidence);
      return `结节${nodule.noduleIndex}：AI已检测到结节，尚无可用TI-RADS结构化分级。${modelSummary ? ` ${modelSummary}` : ""}`;
    })
    .join("\n");
}

function formatNoduleDescription(
  result: TiradsResultRecord,
  nodule: NoduleRecord | undefined,
  modelEvidence: ModelResultEvidenceContext
): string {
  const confidenceValue = nodule?.detectionConfidence;
  const confidence = confidenceValue === null || confidenceValue === undefined ? "未记录" : confidenceValue.toFixed(2);
  const noduleIndex = nodule?.noduleIndex ?? "未知";
  const category = result.category ?? "未分级";
  const score = result.score ?? "未计算";
  const modelSummary = nodule ? formatModelResultForReport(nodule.id, modelEvidence) : "";
  return `结节${noduleIndex}：AI检测结节，检测置信度${confidence}，TI-RADS ${category}，评分${score}分。${modelSummary ? ` ${modelSummary}` : ""}`;
}

function formatModelResultForReport(noduleId: string, modelEvidence: ModelResultEvidenceContext): string {
  const segmentation = modelEvidence.segmentationByNoduleId.get(noduleId);
  const measurement = modelEvidence.measurementByNoduleId.get(noduleId);
  const parts = [];
  if (segmentation) {
    const source = optionalString(segmentation.segmentation_source) ?? optionalString(segmentation.model_name) ?? "未知分割模型";
    const metadata = asJsonObject(segmentation.metadata);
    const cropBox = optionalNumberArray(metadata?.crop_box_xyxy);
    parts.push(`分割来源${source}${cropBox ? `，ROI=${cropBox.join(",")}` : ""}`);
  }
  if (measurement) {
    const source = optionalString(measurement.measurement_source) ?? optionalString(measurement.model_name) ?? "未知测量来源";
    const longAxisMm = optionalNullableNumber(measurement.long_axis_mm);
    const shortAxisMm = optionalNullableNumber(measurement.short_axis_mm);
    const pixelMeasurements = asJsonObject(measurement.pixel_measurements);
    const longAxisPx = optionalNumber(pixelMeasurements?.long_axis_px);
    const shortAxisPx = optionalNumber(pixelMeasurements?.short_axis_px);
    const size =
      longAxisMm !== null && shortAxisMm !== null
        ? `${longAxisMm}mm x ${shortAxisMm}mm`
        : longAxisPx !== undefined && shortAxisPx !== undefined
          ? `${longAxisPx}px x ${shortAxisPx}px`
          : "尺寸待复核";
    parts.push(`测量来源${source}，${size}`);
  }
  return parts.length > 0 ? `模型依据：${parts.join("；")}。` : "";
}

function evidenceRuleCodes(evidenceRules: unknown[]): string[] {
  return evidenceRules.flatMap((rule) => {
    const record = asJsonObject(rule);
    const code = optionalString(record?.rule_code) ?? optionalString(record?.code);
    return code ? [code] : [];
  });
}

function fillReportTemplate(template: string, sections: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(sections)) {
    text = text.split(`{${key}}`).join(value);
  }
  return text;
}

function buildCalculateTiradsTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  now: number
): JsonObject {
  const studyId = requiredString(task.input.study_id, "study_id");
  const nodules = repo.listNodulesByStudy(studyId);
  const noduleById = new Map(nodules.map((nodule) => [nodule.id, nodule]));
  const features = latestFeaturePerNodule(repo.listTiradsFeaturesByStudy(studyId));
  if (features.length === 0) {
    return {
      ...base,
      result: {
        tirads_results: [],
        rule_status: "no_structured_features",
        nodule_count: nodules.length,
      },
      warnings: ["no_structured_tirads_features"],
    };
  }

  const tiradsResults = features.map((feature) => {
    const nodule = noduleById.get(feature.noduleId);
    const input = tiradsInputFromFeature(feature);
    const calculated = calculateAcrTirads(input);
    const result = repo.createTiradsResult({
      noduleId: feature.noduleId,
      systemName: calculated.result.system_name,
      systemVersion: calculated.result.system_version,
      score: calculated.result.score,
      category: calculated.result.category,
      recommendation: calculated.result.recommendation,
      evidenceRules: calculated.result.evidence_rules,
      warnings: calculated.warnings,
      now,
    });
    return {
      tirads_result_id: result.id,
      nodule_id: feature.noduleId,
      nodule_index: nodule?.noduleIndex ?? null,
      feature_id: feature.id,
      score: calculated.result.score,
      category: calculated.result.category,
      recommendation: calculated.result.recommendation,
      recommendation_code: calculated.result.recommendation_code,
      evidence_rules: calculated.result.evidence_rules,
      warnings: calculated.warnings,
    };
  });

  return {
    ...base,
    validation_mode: false,
    result: {
      tirads_results: tiradsResults,
      rule_status: "calculated",
      system_name: "ACR_TI_RADS",
      system_version: "2017",
    },
    warnings: uniqueStrings(tiradsResults.flatMap((result) => result.warnings)),
  };
}

function buildClassifyTiradsFeaturesTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  now: number
): JsonObject {
  const studyId = requiredString(task.input.study_id, "study_id");
  const nodules = repo.listNodulesByStudy(studyId);
  const candidates = featureCandidatesFromTask(task);
  if (candidates.length === 0) {
    return {
      ...base,
      result: {
        nodules: nodules.map((nodule) => ({
          nodule_id: nodule.id,
          nodule_index: nodule.noduleIndex,
          detection_confidence: nodule.detectionConfidence,
        })),
        features: [],
        model_status: "not_configured",
      },
      warnings: ["tirads_feature_model_not_configured"],
    };
  }

  const noduleById = new Map(nodules.map((nodule) => [nodule.id, nodule]));
  const noduleByIndex = new Map(nodules.map((nodule) => [nodule.noduleIndex, nodule]));
  const warnings: string[] = [];
  const persisted = candidates.flatMap((candidate, index) => {
    const nodule = resolveCandidateNodule(candidate, nodules, noduleById, noduleByIndex);
    if (!nodule) {
      warnings.push(`tirads_feature_nodule_not_found:${candidateLabel(candidate, index)}`);
      return [];
    }
    const features = extractFeaturePayload(candidate);
    if (Object.keys(features).length === 0) {
      warnings.push(`tirads_feature_payload_empty:${candidateLabel(candidate, index)}`);
      return [];
    }
    const feature = repo.createTiradsFeature({
      noduleId: nodule.id,
      systemName: optionalString(candidate.system_name) ?? "ACR_TI_RADS",
      features,
      confidence: extractConfidencePayload(candidate),
      sourceModel: optionalString(candidate.source_model) ?? optionalString(candidate.model_name) ?? "validation-input",
      requiresReview: optionalBoolean(candidate.requires_review) ?? true,
      now,
    });
    return [
      {
        tirads_feature_id: feature.id,
        nodule_id: nodule.id,
        nodule_index: nodule.noduleIndex,
        features: feature.features,
        confidence: feature.confidence,
        source_model: feature.sourceModel,
        requires_review: feature.requiresReview,
      },
    ];
  });

  return {
    ...base,
    validation_mode: persisted.length === 0,
    result: {
      features: persisted,
      feature_status: persisted.length > 0 ? "persisted" : "no_features_persisted",
      source: "structured_validation_input",
    },
    warnings,
  };
}

function latestFeaturePerNodule(features: TiradsFeatureRecord[]): TiradsFeatureRecord[] {
  const seen = new Set<string>();
  const latest: TiradsFeatureRecord[] = [];
  for (const feature of features) {
    if (seen.has(feature.noduleId)) continue;
    seen.add(feature.noduleId);
    latest.push(feature);
  }
  return latest;
}

function featureCandidatesFromTask(task: AgentTaskRecord): JsonObject[] {
  const candidates = asRecordArray(task.input.feature_candidates ?? task.input.tirads_features);
  if (candidates.length > 0) return candidates;
  const features = asJsonObject(task.input.features);
  if (!features) return [];
  return [
    {
      nodule_id: task.input.nodule_id,
      nodule_index: task.input.nodule_index,
      features,
      confidence: task.input.confidence,
      source_model: task.input.source_model,
      requires_review: task.input.requires_review,
    },
  ];
}

function resolveCandidateNodule(
  candidate: JsonObject,
  nodules: NoduleRecord[],
  noduleById: Map<string, NoduleRecord>,
  noduleByIndex: Map<number, NoduleRecord>
): NoduleRecord | undefined {
  const noduleId = optionalString(candidate.nodule_id);
  if (noduleId) return noduleById.get(noduleId);
  const noduleIndex = optionalInteger(candidate.nodule_index);
  if (noduleIndex) return noduleByIndex.get(noduleIndex);
  return nodules.length === 1 ? nodules[0] : undefined;
}

function extractFeaturePayload(candidate: JsonObject): JsonObject {
  const nested = asJsonObject(candidate.features);
  if (nested) return nested;
  const features: JsonObject = {};
  for (const key of ["composition", "echogenicity", "shape", "margin", "echogenic_foci", "size_mm"]) {
    if (candidate[key] !== undefined) features[key] = candidate[key];
  }
  return features;
}

function extractConfidencePayload(candidate: JsonObject): JsonObject {
  return asJsonObject(candidate.confidence) ?? asJsonObject(candidate.feature_confidence) ?? {};
}

function candidateLabel(candidate: JsonObject, index: number): string {
  return optionalString(candidate.nodule_id) ?? String(optionalInteger(candidate.nodule_index) ?? index + 1);
}

function tiradsInputFromFeature(feature: TiradsFeatureRecord): TiradsInput {
  return {
    system_name: feature.systemName,
    system_version: optionalString(feature.features.system_version) ?? "2017",
    features: {
      composition: optionalString(feature.features.composition),
      echogenicity: optionalString(feature.features.echogenicity),
      shape: optionalString(feature.features.shape),
      margin: optionalString(feature.features.margin),
      echogenic_foci: optionalStringOrArray(feature.features.echogenic_foci),
    },
    size_mm: sizeMmFromValue(feature.features.size_mm),
  };
}

function sizeMmFromValue(value: unknown): TiradsInput["size_mm"] | undefined {
  const record = asJsonObject(value);
  if (!record) return undefined;
  const size = {
    long_axis: optionalNumber(record.long_axis),
    short_axis: optionalNumber(record.short_axis),
    ap_axis: optionalNumber(record.ap_axis),
  };
  return size.long_axis || size.short_axis || size.ap_axis ? size : undefined;
}

function persistDetectorNodules(repo: MedicalCaseRepo, modelJob: ModelJobRecord, now: number): JsonObject[] {
  if (!modelJob.studyId) return [];
  const detections = asRecordArray(modelJob.output?.nodules ?? modelJob.output?.detections);
  return detections.map((detection, index) => {
    const noduleIndex = optionalInteger(detection.nodule_index) ?? index + 1;
    const nodule = repo.upsertNodule({
      studyId: modelJob.studyId!,
      imageId: modelJob.imageId,
      noduleIndex,
      bbox: optionalNumberArray(detection.bbox) ?? null,
      detectionConfidence: optionalNumber(detection.confidence),
      source: optionalString(detection.source) ?? "ai",
      now,
    });
    return {
      nodule_id: nodule.id,
      nodule_index: nodule.noduleIndex,
      bbox: nodule.bbox,
      detection_confidence: nodule.detectionConfidence,
      source: nodule.source,
    };
  });
}

function persistSegmentations(repo: MedicalCaseRepo, modelJob: ModelJobRecord, now: number): JsonObject[] {
  if (!modelJob.studyId) return [];
  const noduleByIndex = new Map(repo.listNodulesByStudy(modelJob.studyId).map((nodule) => [nodule.noduleIndex, nodule]));
  const segmentations = asRecordArray(modelJob.output?.segmentations);
  return segmentations.flatMap((segmentation, index) => {
    const nodule = resolveNoduleFromOutput(repo, modelJob.studyId!, segmentation, noduleByIndex, index);
    const maskUri = optionalString(segmentation.mask_uri);
    if (!nodule || !maskUri) return [];
    const updated = repo.updateNoduleMask(nodule.id, maskUri, now);
    return [
      {
        nodule_id: updated.id,
        nodule_index: updated.noduleIndex,
        mask_uri: updated.maskUri,
        segmentation_source: optionalString(segmentation.segmentation_source) ?? "unknown",
        confidence: optionalNumber(segmentation.confidence),
        requires_doctor_review: optionalBoolean(segmentation.requires_doctor_review) ?? true,
      },
    ];
  });
}

function persistMeasurements(repo: MedicalCaseRepo, modelJob: ModelJobRecord, now: number): JsonObject[] {
  if (!modelJob.studyId) return [];
  const noduleByIndex = new Map(repo.listNodulesByStudy(modelJob.studyId).map((nodule) => [nodule.noduleIndex, nodule]));
  const measurements = asRecordArray(modelJob.output?.measurements);
  return measurements.flatMap((item, index) => {
    const nodule = resolveNoduleFromOutput(repo, modelJob.studyId!, item, noduleByIndex, index);
    if (!nodule) return [];
    const measurement = repo.createMeasurement({
      noduleId: nodule.id,
      longAxisMm: optionalNullableNumber(item.long_axis_mm),
      shortAxisMm: optionalNullableNumber(item.short_axis_mm),
      apAxisMm: optionalNullableNumber(item.ap_axis_mm),
      areaMm2: optionalNullableNumber(item.area_mm2),
      aspectRatio: optionalNullableNumber(item.aspect_ratio),
      measurementSource: optionalString(item.measurement_source) ?? "model",
      confidence: optionalNullableNumber(item.confidence),
      now,
    });
    return [
      {
        measurement_id: measurement.id,
        nodule_id: nodule.id,
        nodule_index: nodule.noduleIndex,
        long_axis_mm: measurement.longAxisMm,
        short_axis_mm: measurement.shortAxisMm,
        area_mm2: measurement.areaMm2,
        aspect_ratio: measurement.aspectRatio,
        measurement_source: measurement.measurementSource,
        pixel_measurements: asJsonObject(item.pixel_measurements) ?? {},
        requires_doctor_review: optionalBoolean(item.requires_doctor_review) ?? true,
      },
    ];
  });
}

function resolveNoduleFromOutput(
  repo: MedicalCaseRepo,
  studyId: string,
  item: JsonObject,
  noduleByIndex: Map<number, NoduleRecord>,
  index: number
): NoduleRecord | undefined {
  const noduleId = optionalString(item.nodule_id);
  if (noduleId) {
    const nodule = repo.getNodule(noduleId);
    if (nodule?.studyId === studyId) return nodule;
  }
  const noduleIndex = optionalInteger(item.nodule_index) ?? index + 1;
  return noduleByIndex.get(noduleIndex);
}

function asRecordArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function optionalNullableNumber(value: unknown): number | null {
  return value === null ? null : optionalNumber(value) ?? null;
}

function optionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.map(optionalNumber);
  return numbers.every((item): item is number => item !== undefined) ? numbers : undefined;
}

function optionalStringOrArray(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return values.length > 0 ? values : undefined;
  }
  return optionalString(value);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}
