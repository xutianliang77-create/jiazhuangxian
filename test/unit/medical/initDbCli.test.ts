import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeMedicalValidationDb, parseMedicalInitDbArgs } from "../../../scripts/medical-init-db";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-med-init-db-"));
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("medical init db CLI helpers", () => {
  it("parses default project-local validation database paths", () => {
    const args = parseMedicalInitDbArgs([], "/repo");
    expect(args).toEqual({
      dataDb: "/repo/data/artifacts/medical-validation/data.db",
      ragDb: "/repo/data/artifacts/medical-validation/rag.db",
      workspace: "/repo",
      ingestSampleKnowledge: false,
      sampleManifest: "/repo/examples/medical-knowledge/thyroid-guidelines-v1.manifest.json",
    });
  });

  it("initializes SQLite data/RAG databases and can ingest sample knowledge", () => {
    const dataDb = path.join(tmpRoot, "data.db");
    const ragDb = path.join(tmpRoot, "rag.db");
    const result = initializeMedicalValidationDb({
      dataDb,
      ragDb,
      workspace: process.cwd(),
      ingestSampleKnowledge: true,
      sampleManifest: path.join(process.cwd(), "examples/medical-knowledge/thyroid-guidelines-v1.manifest.json"),
    });

    expect(existsSync(dataDb)).toBe(true);
    expect(existsSync(ragDb)).toBe(true);
    expect(result).toMatchObject({
      dataDb,
      ragDb,
      ragReady: true,
      sampleKnowledge: {
        documentId: "doc-thyroid-guidelines-v1",
        chunksUpserted: 13,
        templatesUpserted: 2,
      },
    });
    expect((result.seedCounts as Record<string, number>).tiradsRules).toBe(36);
    expect((result.seedCounts as Record<string, number>).medicalTerms).toBe(10);
  });
});
