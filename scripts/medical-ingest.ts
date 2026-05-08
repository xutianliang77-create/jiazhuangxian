import path from "node:path";

import { loadMedicalKnowledgeManifest, ingestMedicalKnowledgeManifest } from "../src/medical/knowledge/ingestion";
import { openRagDb } from "../src/rag/store";
import { defaultDataDbPath, openDataDb } from "../src/storage/db";

interface CliArgs {
  manifest?: string;
  dataDb?: string;
  ragDb?: string;
  workspace: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    throw new Error("Usage: npm run medical:ingest -- --manifest <file.json> [--data-db <data.db>] [--rag-db <rag.db>] [--workspace <dir>]");
  }

  const workspace = path.resolve(args.workspace);
  const manifestPath = path.resolve(args.manifest);
  const dataHandle = openDataDb({
    path: path.resolve(args.dataDb ?? process.env.JZX_DATA_DB ?? defaultDataDbPath()),
    singleton: false,
  });
  const ragHandle = openRagDb(workspace, args.ragDb ? { path: path.resolve(args.ragDb) } : {});

  try {
    const manifest = loadMedicalKnowledgeManifest(manifestPath);
    const result = ingestMedicalKnowledgeManifest(dataHandle.db, ragHandle.db, manifest, {
      workspaceRelPath: path.relative(workspace, manifestPath) || path.basename(manifestPath),
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
    if (arg === "--manifest") {
      parsed.manifest = requireValue(arg, next);
      i += 1;
    } else if (arg === "--data-db") {
      parsed.dataDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--rag-db") {
      parsed.ragDb = requireValue(arg, next);
      i += 1;
    } else if (arg === "--workspace") {
      parsed.workspace = requireValue(arg, next);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
