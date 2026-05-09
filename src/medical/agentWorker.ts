import {
  MedicalCaseRepo,
  type AgentTaskRecord,
  type ModelJobRecord,
  type NoduleRecord,
  type TiradsFeatureRecord,
  type TiradsResultRecord,
} from "./storage";
import { calculateAcrTirads, type TiradsInput } from "../../packages/medical-mcp/src/tirads";

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
      const completedAt = now();
      const output = detectorSuccessOutput(repo, modelJob, workerId, completedAt);
      repo.completeAgentTask(task.id, output, completedAt);
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

  const completedAt = now();
  const output = buildSynchronousTaskOutput(repo, task, workerId, completedAt);
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
  if (task.taskType === "detect_nodules") return processClaimedTask(repo, task, workerId, now);

  const output =
    task.taskType === "image_qc"
      ? await buildImageQcTaskOutput(repo, task, workerId, options, now())
      : buildSynchronousTaskOutput(repo, task, workerId, now());
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
  workerId: string,
  now: number
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
      return buildClassifyTiradsFeaturesTaskOutput(repo, task, base, now);
    case "calculate_tirads":
      return buildCalculateTiradsTaskOutput(repo, task, base, now);
    case "draft_report":
      return buildDraftReportTaskOutput(repo, task, base, workerId, now);
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

function buildDraftReportTaskOutput(
  repo: MedicalCaseRepo,
  task: AgentTaskRecord,
  base: JsonObject,
  workerId: string,
  now: number
): JsonObject {
  const studyId = requiredString(task.input.study_id, "study_id");
  const nodules = repo.listNodulesByStudy(studyId);
  const noduleById = new Map(nodules.map((nodule) => [nodule.id, nodule]));
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
    };
  });
  const sections = buildReportSections(nodules, tiradsResults, noduleById);
  const template = repo.getActiveReportTemplateText(THYROID_REPORT_TEMPLATE_ID) ?? THYROID_REPORT_TEMPLATE;
  const draftText = fillReportTemplate(template, sections);
  const evidence = reportNodules.map((item) => ({
    source: "tirads_result",
    nodule_id: item.nodule_id,
    tirads_result_id: item.tirads_result_id,
    evidence_rules: item.evidence_rules,
  }));
  const report = repo.createReport({
    studyId,
    analysisSessionId: task.analysisSessionId,
    reportType: "thyroid_ultrasound",
    status: "draft",
    templateId: THYROID_REPORT_TEMPLATE_ID,
    draftText,
    structured: {
      study_id: studyId,
      analysis_session_id: task.analysisSessionId,
      generator: "structured_template_validation",
      generated_at: now,
      sections,
      nodules: reportNodules,
      review_required: true,
    },
    evidence,
    createdByAgent: workerId,
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
      tiradsResults.length === 0 ? "no_tirads_results_for_report" : undefined,
    ]),
  };
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

function buildReportSections(
  nodules: NoduleRecord[],
  tiradsResults: TiradsResultRecord[],
  noduleById: Map<string, NoduleRecord>
): Record<string, string> {
  const noduleDescriptions =
    tiradsResults.length > 0
      ? tiradsResults.map((result) => formatNoduleDescription(result, noduleById.get(result.noduleId))).join("\n")
      : formatUnclassifiedNodules(nodules);
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

function formatUnclassifiedNodules(nodules: NoduleRecord[]): string {
  if (nodules.length === 0) return "未检测到结构化结节结果，需医生结合图像复核。";
  return nodules
    .map((nodule) => `结节${nodule.noduleIndex}：AI已检测到结节，尚无可用TI-RADS结构化分级。`)
    .join("\n");
}

function formatNoduleDescription(result: TiradsResultRecord, nodule: NoduleRecord | undefined): string {
  const confidenceValue = nodule?.detectionConfidence;
  const confidence = confidenceValue === null || confidenceValue === undefined ? "未记录" : confidenceValue.toFixed(2);
  const noduleIndex = nodule?.noduleIndex ?? "未知";
  const category = result.category ?? "未分级";
  const score = result.score ?? "未计算";
  return `结节${noduleIndex}：AI检测结节，检测置信度${confidence}，TI-RADS ${category}，评分${score}分。`;
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

function asRecordArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
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
