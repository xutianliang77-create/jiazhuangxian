import {
  MedicalCaseRepo,
  type AgentTaskRecord,
  type ModelJobRecord,
} from "./storage";

type JsonObject = Record<string, unknown>;

export interface MedicalAgentWorkerOptions {
  workerId?: string;
  now?: () => number;
  imageWorkerUrl?: string;
  fetchImpl?: FetchLike;
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
const IMAGE_QC_PATH = "/image/v1/image-quality-check";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
    return processClaimedTask(repo, task, workerId, now);
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

  const synced = syncWaitingModelTask(repo, workerId, now);
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
    const modelJob = modelJobId ? repo.getModelJob(modelJobId) : repo.findModelJobByAgentTask(task.id, DETECT_JOB_TYPE);
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
      const output = detectorSuccessOutput(modelJob, workerId);
      repo.completeAgentTask(task.id, output, now());
      return {
        status: "succeeded",
        claimed: true,
        workerId,
        taskId: task.id,
        taskType: task.taskType,
        modelJobId: modelJob.id,
        output,
      };
    }
    const error = {
      code: "model_job_failed",
      message: "Detector model job did not complete successfully.",
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
  now: () => number
): MedicalAgentWorkerResult {
  if (task.taskType === "detect_nodules") {
    const modelJob = ensureDetectorModelJob(repo, task, now());
    const output = {
      status: "waiting_model",
      worker_id: workerId,
      model_job_id: modelJob.id,
      job_type: modelJob.jobType,
      message: "Detector model job has been queued; run model-worker against the same data DB.",
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

  const output = buildSynchronousTaskOutput(repo, task, workerId);
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

async function processClaimedTaskAsync(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  workerId: string,
  now: () => number,
  options: MedicalAgentWorkerOptions
): Promise<MedicalAgentWorkerResult> {
  if (task.taskType === "detect_nodules") return processClaimedTask(repo, task, workerId, now);

  const output =
    task.taskType === "image_qc"
      ? await buildImageQcTaskOutput(repo, task, workerId, options, now())
      : buildSynchronousTaskOutput(repo, task, workerId);
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
    modelName: optionalString(task.input.model),
    modelVersion: optionalString(task.input.model_version),
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
      },
      trace_id: task.id,
    },
    now,
  });
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
  workerId: string
): JsonObject {
  const studyId = optionalString(task.input.study_id);
  const imageId = optionalString(task.input.image_id);
  const image = imageId ? repo.getImage(imageId) : null;
  const base = {
    status: "ok",
    worker_id: workerId,
    validation_mode: true,
    study_id: studyId,
    image_id: imageId,
  };

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
      return {
        ...base,
        result: {
          nodules: [],
          features: [],
          model_status: "not_configured",
        },
        warnings: ["tirads_feature_model_not_configured"],
      };
    case "calculate_tirads":
      return {
        ...base,
        result: {
          tirads_results: [],
          rule_status: "no_structured_features",
        },
        warnings: ["no_detected_nodules_or_features"],
      };
    case "draft_report":
      return {
        ...base,
        result: {
          report_status: "draft_placeholder",
          sections: {
            finding: "验证版流程已创建报告草稿，待真实检测、特征识别与医生审核补全。",
            impression: "AI 结果仅用于辅助验证，不能作为最终诊断。",
          },
        },
        warnings: ["report_generation_model_not_connected"],
      };
    case "safety_review":
      return {
        ...base,
        result: {
          safety_status: "passed_with_validation_warnings",
          issues: [],
        },
        warnings: ["doctor_review_required"],
      };
    default:
      throw new Error(`unsupported medical agent task type: ${task.taskType}`);
  }
}

function detectorSuccessOutput(modelJob: ModelJobRecord, workerId: string): JsonObject {
  return {
    status: "ok",
    worker_id: workerId,
    model_job_id: modelJob.id,
    job_type: modelJob.jobType,
    result: modelJob.output ?? {},
    artifact_uri: modelJob.artifactUri,
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

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
