import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type Database from "better-sqlite3";

import {
  runMedicalAgentWorkerOnceAsync,
  type MedicalAgentWorkerResult,
} from "../src/medical/agentWorker";
import { MedicalCaseRepo } from "../src/medical/storage";
import { loadRuntimeSelection } from "../src/provider/registry";
import type { ProviderStatus } from "../src/provider/types";
import { defaultDataDbPath, openDataDb } from "../src/storage/db";

type JsonObject = Record<string, unknown>;

const MEDICAL_MAIN_LLM_PROVIDER_ID = "lmstudio:qwen35-9b";
const MEDICAL_MAIN_LLM_MODEL = "qwen/qwen3.5-9b";

interface CliArgs {
  dataDb?: string;
  ragDb?: string;
  workspace?: string;
  workerId: string;
  intervalMs: number;
  maxSteps: number;
  imageWorkerUrl?: string;
  remoteModelGatewayUrl?: string;
  knowledgeTopK: number;
  llmProviderId?: string;
  qwenModel?: string;
  qwenCheckUrl?: string;
  waitForQwen: boolean;
  waitForTiradsFeatures: boolean;
  enableMedicalReview: boolean;
  medicalReviewProviderId?: string;
  help: boolean;
}

interface RunnableTask {
  id: string;
  taskType: string;
  studyId?: string;
}

interface QwenReadiness {
  ready: boolean;
  model: string;
  checkedUrl?: string;
  reason: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const dataDbPath = path.resolve(args.dataDb ?? process.env.JZX_DATA_DB ?? defaultDataDbPath());
  const handle = openDataDb({ path: dataDbPath, singleton: false });
  const repo = new MedicalCaseRepo(handle.db);

  let qwenProvider: ProviderStatus | null = null;
  let medicalReviewProvider: ProviderStatus | null = null;
  let qwenReady = false;
  let lastGate = "";
  let steps = 0;

  try {
    printEvent("demo_started", {
      data_db: dataDbPath,
      rag_db: args.ragDb ? path.resolve(args.ragDb) : null,
      remote_model_gateway_url: args.remoteModelGatewayUrl ?? process.env.JZX_REMOTE_MODEL_GATEWAY_URL ?? null,
      worker_id: args.workerId,
      qwen_provider: args.llmProviderId ?? process.env.JZX_MEDICAL_LLM_PROVIDER ?? MEDICAL_MAIN_LLM_PROVIDER_ID,
    });

    for (;;) {
      if (steps >= args.maxSteps) {
        printEvent("demo_stopped", { reason: "max_steps_reached", max_steps: args.maxSteps });
        return;
      }

      const gate = await nextGate(handle.db, args, qwenProvider, qwenReady);
      if (gate.type === "tirads_features") {
        const key = `${gate.type}:${gate.studyId}`;
        if (lastGate !== key) {
          printEvent("waiting_doctor_tirads_features", {
            study_id: gate.studyId,
            message: "请先在医生工作台确认或修订已预填的 TI-RADS 结构化特征；提交后本脚本会继续跑规则计算，并在报告阶段等待 Qwen。",
          });
          lastGate = key;
        }
        if (!args.waitForTiradsFeatures) return;
        await sleep(args.intervalMs);
        continue;
      }

      if (gate.type === "qwen") {
        const provider: ProviderStatus = qwenProvider ?? await resolveQwenProvider(args);
        const readiness = await checkQwenReadiness(provider, args);
        if (!readiness.ready) {
          const key = `${gate.type}:${readiness.reason}`;
          if (lastGate !== key) {
            printEvent("waiting_qwen_model", {
              study_id: gate.studyId,
              task_id: gate.taskId,
              provider: providerSnapshot(provider),
              readiness,
              message: `现在请在 5090 上手工加载 ${MEDICAL_MAIN_LLM_MODEL}；检测到模型 loaded 后会自动继续生成报告。`,
            });
            lastGate = key;
          }
          if (!args.waitForQwen) return;
          await sleep(args.intervalMs);
          continue;
        }
        qwenProvider = provider;
        qwenReady = true;
        if (args.enableMedicalReview && !medicalReviewProvider) {
          medicalReviewProvider = await resolveMedicalReviewProvider(args);
        }
        printEvent("qwen_model_ready", {
          study_id: gate.studyId,
          task_id: gate.taskId,
          provider: providerSnapshot(provider),
          readiness,
        });
      }

      lastGate = "";
      const result = await runMedicalAgentWorkerOnceAsync(
        repo,
        workerOptions(args, dataDbPath, qwenReady ? qwenProvider : null, medicalReviewProvider)
      );
      steps += 1;
      printWorkerResult(result);

      if (result.status === "failed") {
        printEvent("demo_failed", { error: result.error ?? null });
        process.exitCode = 1;
        return;
      }

      if (result.status === "waiting_doctor_input") {
        await sleep(args.intervalMs);
        continue;
      }

      if (result.status === "idle") {
        if (countWaitingModelTasks(handle.db) > 0) {
          await sleep(args.intervalMs);
          continue;
        }
        printEvent("demo_completed_or_idle", {
          message: "当前没有可运行任务；如刚提交医生特征或新建病例，脚本可重新启动。",
        });
        return;
      }

      if (result.status === "waiting_model") {
        await sleep(args.intervalMs);
      }
    }
  } finally {
    handle.close();
  }
}

async function nextGate(
  db: Database.Database,
  args: CliArgs,
  provider: ProviderStatus | null,
  qwenReady: boolean
): Promise<
  | { type: "none" }
  | { type: "tirads_features"; studyId: string; taskId: string }
  | { type: "qwen"; studyId: string; taskId: string }
> {
  if (countWaitingModelTasks(db) > 0) return { type: "none" };

  const next = nextRunnableTask(db);
  if (!next?.studyId) return { type: "none" };

  if (
    next.taskType === "calculate_tirads" &&
    args.waitForTiradsFeatures &&
    !hasConfirmedTiradsFeatures(db, next.studyId)
  ) {
    return { type: "tirads_features", studyId: next.studyId, taskId: next.id };
  }

  if (next.taskType === "draft_report" && !qwenReady) {
    const qwenProvider = provider ?? await resolveQwenProvider(args);
    const readiness = await checkQwenReadiness(qwenProvider, args);
    if (!readiness.ready) return { type: "qwen", studyId: next.studyId, taskId: next.id };
  }

  return { type: "none" };
}

function nextRunnableTask(db: Database.Database): RunnableTask | null {
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
  return {
    id: row.id,
    taskType: row.task_type,
    studyId: optionalString(input.study_id),
  };
}

function countWaitingModelTasks(db: Database.Database): number {
  return db
    .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM agent_task WHERE status = 'waiting_model'")
    .get()?.count ?? 0;
}

function hasConfirmedTiradsFeatures(db: Database.Database, studyId: string): boolean {
  const repo = new MedicalCaseRepo(db);
  const nodules = repo.listNodulesByStudy(studyId);
  if (nodules.length === 0) return true;
  const latestByNodule = new Map<string, ReturnType<MedicalCaseRepo["listTiradsFeaturesByStudy"]>[number]>();
  for (const feature of repo.listTiradsFeaturesByStudy(studyId)) {
    if (!latestByNodule.has(feature.noduleId)) latestByNodule.set(feature.noduleId, feature);
  }
  return nodules.every((nodule) => {
    const feature = latestByNodule.get(nodule.id);
    return Boolean(feature && !feature.requiresReview && isCompleteTiradsFeature(feature.features));
  });
}

function isCompleteTiradsFeature(features: JsonObject): boolean {
  return ["composition", "echogenicity", "shape", "margin", "echogenic_foci"].every((key) => {
    const value = features[key];
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
  });
}

async function resolveQwenProvider(args: CliArgs): Promise<ProviderStatus> {
  return resolveProvider(
    args.llmProviderId ?? process.env.JZX_MEDICAL_LLM_PROVIDER ?? MEDICAL_MAIN_LLM_PROVIDER_ID,
    "Qwen report"
  );
}

async function resolveMedicalReviewProvider(args: CliArgs): Promise<ProviderStatus> {
  return resolveProvider(args.medicalReviewProviderId ?? process.env.JZX_MEDICAL_REVIEW_PROVIDER, "medical review");
}

async function resolveProvider(providerId: string | undefined, label: string): Promise<ProviderStatus> {
  const runtime = await loadRuntimeSelection();
  const provider = providerId ? runtime.registry.get(providerId) : runtime.selection?.current ?? null;
  if (!provider) throw new Error(`${label} provider is not configured.`);
  if (!provider.available) {
    throw new Error(`${label} provider is unavailable: ${provider.instanceId} (${provider.reason})`);
  }
  return provider;
}

async function checkQwenReadiness(provider: ProviderStatus, args: CliArgs): Promise<QwenReadiness> {
  const model = args.qwenModel ?? provider.model;
  const urls = qwenReadinessUrls(provider, args);
  for (const url of urls) {
    const result = await checkModelsEndpoint(url, model);
    if (result.ready || result.matched) {
      return {
        ready: result.ready,
        model,
        checkedUrl: url,
        reason: result.reason,
      };
    }
  }
  return {
    ready: provider.type !== "lmstudio",
    model,
    checkedUrl: urls[0],
    reason: provider.type === "lmstudio" ? "model_not_found_in_lmstudio" : "non_lmstudio_provider_available",
  };
}

function qwenReadinessUrls(provider: ProviderStatus, args: CliArgs): string[] {
  if (args.qwenCheckUrl) return [args.qwenCheckUrl];
  if (provider.type !== "lmstudio") return [];
  const base = provider.baseUrl.replace(/\/+$/, "");
  const withoutV1 = base.replace(/\/v1$/i, "");
  return [`${withoutV1}/api/v0/models`, `${base}/models`];
}

async function checkModelsEndpoint(
  url: string,
  expectedModel: string
): Promise<{ ready: boolean; matched: boolean; reason: string }> {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return { ready: false, matched: false, reason: `model_check_http_${response.status}` };
    }
    const body = await response.json() as unknown;
    const models = modelRecords(body);
    const matched = models.find((model) => modelNameMatches(modelId(model), expectedModel));
    if (!matched) return { ready: false, matched: false, reason: "model_not_listed" };

    const explicitLoaded = loadedFlag(matched);
    if (explicitLoaded !== undefined) {
      return {
        ready: explicitLoaded,
        matched: true,
        reason: explicitLoaded ? "model_loaded" : "model_listed_but_not_loaded",
      };
    }

    return {
      ready: /\/v1\/models$/i.test(url) || /\/models$/i.test(url),
      matched: true,
      reason: "model_listed_without_loaded_state",
    };
  } catch (err) {
    return {
      ready: false,
      matched: false,
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
  return optionalString(value.id) ?? optionalString(value.model) ?? optionalString(value.name) ?? optionalString(value.path);
}

function modelNameMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = normalizeModelName(actual);
  const right = normalizeModelName(expected);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, "/").replace(/^.*models\//, "");
}

function loadedFlag(value: JsonObject): boolean | undefined {
  const direct = booleanValue(value.loaded) ?? booleanValue(value.is_loaded) ?? booleanValue(value.isLoaded);
  if (direct !== undefined) return direct;
  const state = optionalString(value.state) ?? optionalString(value.status);
  if (!state) return undefined;
  const normalized = state.toLowerCase();
  if (normalized.includes("not") || normalized.includes("unload")) return false;
  if (normalized.includes("load") || normalized === "ready" || normalized === "running") return true;
  return undefined;
}

function workerOptions(
  args: CliArgs,
  dataDbPath: string,
  llmProvider: ProviderStatus | null,
  medicalReviewProvider: ProviderStatus | null
) {
  return {
    workerId: args.workerId,
    imageWorkerUrl: args.imageWorkerUrl,
    remoteModelGatewayUrl: args.remoteModelGatewayUrl,
    dataDbPath,
    ragDbPath: args.ragDb ? path.resolve(args.ragDb) : undefined,
    workspace: args.workspace ? path.resolve(args.workspace) : process.cwd(),
    knowledgeTopK: args.knowledgeTopK,
    llmProvider,
    medicalReviewProvider,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    workerId: process.env.JZX_MEDICAL_AGENT_WORKER_ID ?? "medical-live-demo",
    intervalMs: positiveIntValue(process.env.JZX_MEDICAL_DEMO_INTERVAL_MS, 2000),
    maxSteps: positiveIntValue(process.env.JZX_MEDICAL_DEMO_MAX_STEPS, 120),
    ragDb: process.env.JZX_RAG_DB,
    workspace: process.env.JZX_WORKSPACE,
    imageWorkerUrl: process.env.JZX_IMAGE_WORKER_URL,
    remoteModelGatewayUrl: process.env.JZX_REMOTE_MODEL_GATEWAY_URL,
    knowledgeTopK: positiveIntValue(process.env.JZX_MEDICAL_KNOWLEDGE_TOP_K, 3),
    llmProviderId: process.env.JZX_MEDICAL_LLM_PROVIDER,
    qwenModel: process.env.JZX_MEDICAL_QWEN_MODEL,
    qwenCheckUrl: process.env.JZX_MEDICAL_QWEN_CHECK_URL,
    waitForQwen: true,
    waitForTiradsFeatures: true,
    enableMedicalReview: process.env.JZX_MEDICAL_REVIEW === "1",
    medicalReviewProviderId: process.env.JZX_MEDICAL_REVIEW_PROVIDER,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--data-db") {
      args.dataDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--rag-db") {
      args.ragDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--workspace") {
      args.workspace = requireValue(arg, next);
      i += 1;
    } else if (arg === "--worker-id") {
      args.workerId = requireValue(arg, next);
      i += 1;
    } else if (arg === "--interval-ms") {
      args.intervalMs = positiveInt(arg, next);
      i += 1;
    } else if (arg === "--max-steps") {
      args.maxSteps = positiveInt(arg, next);
      i += 1;
    } else if (arg === "--image-worker-url") {
      args.imageWorkerUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--remote-model-gateway-url") {
      args.remoteModelGatewayUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--knowledge-top-k") {
      args.knowledgeTopK = positiveInt(arg, next);
      i += 1;
    } else if (arg === "--llm-provider") {
      args.llmProviderId = requireValue(arg, next);
      i += 1;
    } else if (arg === "--qwen-model") {
      args.qwenModel = requireValue(arg, next);
      i += 1;
    } else if (arg === "--qwen-check-url") {
      args.qwenCheckUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--no-wait-for-qwen") {
      args.waitForQwen = false;
    } else if (arg === "--no-wait-for-tirads-features") {
      args.waitForTiradsFeatures = false;
    } else if (arg === "--enable-medical-review") {
      args.enableMedicalReview = true;
    } else if (arg === "--medical-review-provider") {
      args.medicalReviewProviderId = requireValue(arg, next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printWorkerResult(result: MedicalAgentWorkerResult): void {
  printEvent("worker_step", {
    status: result.status,
    claimed: result.claimed,
    task_id: result.taskId,
    task_type: result.taskType,
    model_job_id: result.modelJobId,
    error: result.error,
  });
}

function printEvent(event: string, detail: JsonObject): void {
  console.log(JSON.stringify({ event, ...detail }, null, 2));
}

function providerSnapshot(provider: ProviderStatus): JsonObject {
  return {
    instance_id: provider.instanceId,
    type: provider.type,
    model: provider.model,
    base_url: provider.baseUrl,
    display_name: provider.displayName,
  };
}

function parseJsonObject(text: string): JsonObject {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInt(flag: string, value: string | undefined): number {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function positiveIntValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp(): void {
  console.log(`Usage:
  npm run medical-demo:run -- \\
    --data-db data/artifacts/live-demo-001/data.db \\
    --rag-db data/artifacts/live-demo-001/rag.db \\
    --workspace /Users/xutianliang/Downloads/jiazhuangxian \\
    --remote-model-gateway-url http://100.110.127.117:8766 \\
    --llm-provider ${MEDICAL_MAIN_LLM_PROVIDER_ID} \\
    --qwen-model ${MEDICAL_MAIN_LLM_MODEL}

Behavior:
  1. 自动循环执行 image_qc / detect / segment / measure / TI-RADS 规则等已排队任务。
  2. 若缺少医生 TI-RADS 特征，会等待医生在工作台提交。
  3. 到 draft_report 前检测 ${MEDICAL_MAIN_LLM_MODEL} 是否 loaded；未 loaded 时等待。
  4. 模型 loaded 后自动继续 draft_report / safety_review 并落库报告。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
