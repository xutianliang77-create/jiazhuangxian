import path from "node:path";

import { runMedicalAgentWorkerOnceAsync } from "../src/medical/agentWorker";
import { MedicalCaseRepo } from "../src/medical/storage";
import { loadRuntimeSelection } from "../src/provider/registry";
import type { ProviderStatus } from "../src/provider/types";
import { defaultDataDbPath, openDataDb } from "../src/storage/db";

interface CliArgs {
  dataDb?: string;
  once: boolean;
  workerId: string;
  intervalMs: number;
  ragDb?: string;
  workspace?: string;
  knowledgeTopK?: number;
  imageWorkerUrl?: string;
  remoteModelGatewayUrl?: string;
  enableLlmEvaluation: boolean;
  llmProviderId?: string;
  enableMedicalReview: boolean;
  medicalReviewProviderId?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDbPath = path.resolve(args.dataDb ?? process.env.JZX_DATA_DB ?? defaultDataDbPath());
  const handle = openDataDb({
    path: dataDbPath,
    singleton: false,
  });
  const repo = new MedicalCaseRepo(handle.db);
  const llmProvider = await resolveLlmProvider(args);
  const medicalReviewProvider = await resolveMedicalReviewProvider(args);

  try {
    if (args.once) {
      console.log(
        JSON.stringify(
          await runMedicalAgentWorkerOnceAsync(repo, workerOptions(args, llmProvider, medicalReviewProvider, dataDbPath)),
          null,
          2
        )
      );
      return;
    }

    for (;;) {
      const result = await runMedicalAgentWorkerOnceAsync(repo, workerOptions(args, llmProvider, medicalReviewProvider, dataDbPath));
      console.log(JSON.stringify(result, null, 2));
      if (!result.claimed) await sleep(args.intervalMs);
    }
  } finally {
    handle.close();
  }
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    once: false,
    workerId: process.env.JZX_MEDICAL_AGENT_WORKER_ID ?? "medical-agent-worker",
    intervalMs: positiveIntValue(process.env.JZX_MEDICAL_AGENT_WORKER_INTERVAL_MS, 1000),
    ragDb: process.env.JZX_RAG_DB,
    workspace: process.env.JZX_WORKSPACE,
    knowledgeTopK: positiveIntValue(process.env.JZX_MEDICAL_KNOWLEDGE_TOP_K, 3),
    imageWorkerUrl: process.env.JZX_IMAGE_WORKER_URL,
    remoteModelGatewayUrl: process.env.JZX_REMOTE_MODEL_GATEWAY_URL,
    enableLlmEvaluation: process.env.JZX_MEDICAL_LLM_EVALUATION === "1",
    llmProviderId: process.env.JZX_MEDICAL_LLM_PROVIDER,
    enableMedicalReview: process.env.JZX_MEDICAL_REVIEW === "1",
    medicalReviewProviderId: process.env.JZX_MEDICAL_REVIEW_PROVIDER,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--data-db") {
      parsed.dataDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--worker-id") {
      parsed.workerId = requireValue(arg, next);
      i += 1;
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = positiveInt(arg, next);
      i += 1;
    } else if (arg === "--rag-db") {
      parsed.ragDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--workspace") {
      parsed.workspace = requireValue(arg, next);
      i += 1;
    } else if (arg === "--knowledge-top-k") {
      parsed.knowledgeTopK = positiveInt(arg, next);
      i += 1;
    } else if (arg === "--image-worker-url") {
      parsed.imageWorkerUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--remote-model-gateway-url") {
      parsed.remoteModelGatewayUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--enable-llm-evaluation") {
      parsed.enableLlmEvaluation = true;
    } else if (arg === "--llm-provider") {
      parsed.llmProviderId = requireValue(arg, next);
      i += 1;
    } else if (arg === "--enable-medical-review") {
      parsed.enableMedicalReview = true;
    } else if (arg === "--medical-review-provider") {
      parsed.medicalReviewProviderId = requireValue(arg, next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function workerOptions(
  args: CliArgs,
  llmProvider: ProviderStatus | null,
  medicalReviewProvider: ProviderStatus | null,
  dataDbPath: string
): {
  workerId: string;
  imageWorkerUrl?: string;
  remoteModelGatewayUrl?: string;
  dataDbPath?: string;
  ragDbPath?: string;
  workspace?: string;
  knowledgeTopK?: number;
  llmProvider?: ProviderStatus | null;
  medicalReviewProvider?: ProviderStatus | null;
} {
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

async function resolveLlmProvider(args: CliArgs): Promise<ProviderStatus | null> {
  if (!args.enableLlmEvaluation) return null;
  const runtime = await loadRuntimeSelection();
  const provider = args.llmProviderId
    ? runtime.registry.get(args.llmProviderId)
    : runtime.selection?.current ?? null;
  if (!provider) {
    throw new Error("LLM evaluation enabled but no CodeClaw provider is configured.");
  }
  if (!provider.available) {
    throw new Error(`LLM evaluation provider is unavailable: ${provider.instanceId} (${provider.reason})`);
  }
  return provider;
}

async function resolveMedicalReviewProvider(args: CliArgs): Promise<ProviderStatus | null> {
  if (!args.enableMedicalReview) return null;
  const provider = await resolveConfiguredProvider(args.medicalReviewProviderId, "medical review");
  return provider;
}

async function resolveConfiguredProvider(providerId: string | undefined, label: string): Promise<ProviderStatus> {
  const runtime = await loadRuntimeSelection();
  const provider = providerId ? runtime.registry.get(providerId) : runtime.selection?.current ?? null;
  if (!provider) {
    throw new Error(`${label} provider enabled but no CodeClaw provider is configured.`);
  }
  if (!provider.available) {
    throw new Error(`${label} provider is unavailable: ${provider.instanceId} (${provider.reason})`);
  }
  return provider;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
