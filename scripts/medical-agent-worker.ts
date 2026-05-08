import path from "node:path";

import { runMedicalAgentWorkerOnceAsync } from "../src/medical/agentWorker";
import { MedicalCaseRepo } from "../src/medical/storage";
import { defaultDataDbPath, openDataDb } from "../src/storage/db";

interface CliArgs {
  dataDb?: string;
  once: boolean;
  workerId: string;
  intervalMs: number;
  imageWorkerUrl?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = openDataDb({
    path: path.resolve(args.dataDb ?? process.env.JZX_DATA_DB ?? defaultDataDbPath()),
    singleton: false,
  });
  const repo = new MedicalCaseRepo(handle.db);

  try {
    if (args.once) {
      console.log(JSON.stringify(await runMedicalAgentWorkerOnceAsync(repo, workerOptions(args)), null, 2));
      return;
    }

    for (;;) {
      const result = await runMedicalAgentWorkerOnceAsync(repo, workerOptions(args));
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
    imageWorkerUrl: process.env.JZX_IMAGE_WORKER_URL,
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
    } else if (arg === "--image-worker-url") {
      parsed.imageWorkerUrl = requireValue(arg, next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function workerOptions(args: CliArgs): { workerId: string; imageWorkerUrl?: string } {
  return {
    workerId: args.workerId,
    imageWorkerUrl: args.imageWorkerUrl,
  };
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
