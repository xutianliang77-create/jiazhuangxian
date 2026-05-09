import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ingestMedicalKnowledgeManifest,
  loadMedicalKnowledgeManifest,
  type MedicalKnowledgeIngestionResult,
} from "../src/medical/knowledge/ingestion";
import { openRagDb } from "../src/rag/store";
import { openDataDb } from "../src/storage/db";
import { currentVersion } from "../src/storage/migrate";

export interface MedicalInitDbArgs {
  dataDb: string;
  ragDb: string;
  workspace: string;
  ingestSampleKnowledge: boolean;
  sampleManifest: string;
}

const VALIDATION_DIR = "data/artifacts/medical-validation";
const DEFAULT_SAMPLE_MANIFEST = "examples/medical-knowledge/thyroid-guidelines-v1.manifest.json";

async function main(): Promise<void> {
  const args = parseMedicalInitDbArgs(process.argv.slice(2));
  const result = initializeMedicalValidationDb(args);
  console.log(JSON.stringify({ status: "ok", result }, null, 2));
}

export function parseMedicalInitDbArgs(argv: string[], cwd: string = process.cwd()): MedicalInitDbArgs {
  const parsed: MedicalInitDbArgs = {
    dataDb: path.resolve(cwd, VALIDATION_DIR, "data.db"),
    ragDb: path.resolve(cwd, VALIDATION_DIR, "rag.db"),
    workspace: cwd,
    ingestSampleKnowledge: false,
    sampleManifest: path.resolve(cwd, DEFAULT_SAMPLE_MANIFEST),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--data-db") {
      parsed.dataDb = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else if (arg === "--rag-db") {
      parsed.ragDb = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else if (arg === "--workspace") {
      parsed.workspace = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else if (arg === "--ingest-sample-knowledge") {
      parsed.ingestSampleKnowledge = true;
    } else if (arg === "--sample-manifest") {
      parsed.sampleManifest = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function initializeMedicalValidationDb(args: MedicalInitDbArgs): Record<string, unknown> {
  const dataHandle = openDataDb({ path: args.dataDb, singleton: false });
  const ragHandle = openRagDb(args.workspace, { path: args.ragDb });
  let sampleKnowledge: MedicalKnowledgeIngestionResult | null = null;

  try {
    if (args.ingestSampleKnowledge) {
      const manifest = loadMedicalKnowledgeManifest(args.sampleManifest);
      sampleKnowledge = ingestMedicalKnowledgeManifest(dataHandle.db, ragHandle.db, manifest, {
        workspaceRelPath: path.relative(args.workspace, args.sampleManifest) || path.basename(args.sampleManifest),
      });
    }

    return {
      dataDb: dataHandle.path,
      ragDb: ragHandle.path,
      workspace: args.workspace,
      dataMigrationVersion: currentVersion(dataHandle.db),
      seedCounts: {
        medicalDocuments: countRows(dataHandle.db, "medical_documents"),
        tiradsRules: countRows(dataHandle.db, "tirads_rules"),
        reportTemplates: countRows(dataHandle.db, "report_templates"),
        safetyRules: countRows(dataHandle.db, "safety_rules"),
        medicalTerms: countRows(dataHandle.db, "medical_terms"),
      },
      ragReady: true,
      sampleKnowledge,
    };
  } finally {
    ragHandle.close();
    dataHandle.close();
  }
}

function countRows(db: import("better-sqlite3").Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
