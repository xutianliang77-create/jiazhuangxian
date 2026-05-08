import path from "node:path";

import { backfillMedicalKnowledgeEmbeddings } from "../src/medical/knowledge/embeddingBackfill";
import { openRagDb } from "../src/rag/store";
import { defaultDataDbPath, openDataDb } from "../src/storage/db";

interface CliArgs {
  dataDb?: string;
  ragDb?: string;
  workspace: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  batch?: number;
  maxChunks?: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl ?? process.env.JZX_EMBED_BASE_URL;
  const model = args.model ?? process.env.JZX_EMBED_MODEL;
  if (!baseUrl) throw new Error("--base-url or JZX_EMBED_BASE_URL is required");
  if (!model) throw new Error("--model or JZX_EMBED_MODEL is required");

  const workspace = path.resolve(args.workspace);
  const dataHandle = openDataDb({
    path: path.resolve(args.dataDb ?? process.env.JZX_DATA_DB ?? defaultDataDbPath()),
    singleton: false,
  });
  const ragHandle = openRagDb(workspace, args.ragDb ? { path: path.resolve(args.ragDb) } : {});

  try {
    const result = await backfillMedicalKnowledgeEmbeddings(dataHandle.db, ragHandle.db, {
      baseUrl,
      model,
      apiKey: args.apiKey ?? process.env.JZX_EMBED_API_KEY,
      batch: args.batch,
      maxChunks: args.maxChunks,
    });
    console.log(JSON.stringify({ status: "ok", result }, null, 2));
  } finally {
    ragHandle.close();
    dataHandle.close();
  }
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { workspace: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--data-db") {
      parsed.dataDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--rag-db") {
      parsed.ragDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--workspace") {
      parsed.workspace = requireValue(arg, next);
      i += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--model") {
      parsed.model = requireValue(arg, next);
      i += 1;
    } else if (arg === "--api-key") {
      parsed.apiKey = requireValue(arg, next);
      i += 1;
    } else if (arg === "--batch") {
      parsed.batch = positiveInt(arg, next);
      i += 1;
    } else if (arg === "--max-chunks") {
      parsed.maxChunks = positiveInt(arg, next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
