import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  backfillMedicalKnowledgeEmbeddings,
  countMedicalChunksMissingEmbedding,
} from "../../../src/medical/knowledge/embeddingBackfill";
import {
  ingestMedicalKnowledgeManifest,
  type MedicalKnowledgeManifest,
} from "../../../src/medical/knowledge/ingestion";
import { openRagDb, upsertChunk, type RagDbHandle } from "../../../src/rag/store";
import { migrateIfNeeded } from "../../../src/storage/migrate";

let tmpRoot: string;
let dataDb: Database.Database;
let ragHandle: RagDbHandle;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-med-embed-"));
  dataDb = new Database(path.join(tmpRoot, "data.db"));
  dataDb.pragma("foreign_keys = ON");
  migrateIfNeeded(dataDb, "data");
  ragHandle = openRagDb(tmpRoot, { path: path.join(tmpRoot, "rag.db") });
});

afterEach(() => {
  try {
    ragHandle.close();
  } catch {
    // noop
  }
  try {
    dataDb.close();
  } catch {
    // noop
  }
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("medical knowledge embedding backfill", () => {
  it("embeds only approved medical RAG chunks and respects maxChunks", async () => {
    ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, makeManifest(), {
      jobId: "job-med-embed-1",
      now: 1778245200000,
      workspaceRelPath: "examples/medical-knowledge/embed-test.json",
    });
    upsertChunk(ragHandle.db, {
      chunkId: "non-medical/chunk",
      relPath: "docs/non-medical.md",
      lineStart: 1,
      lineEnd: 1,
      content: "general code knowledge",
      tokenCount: 3,
      contentHash: "nonmedical",
      indexedAt: 1778245200000,
    });

    expect(countMedicalChunksMissingEmbedding(dataDb, ragHandle.db)).toBe(2);

    const first = await backfillMedicalKnowledgeEmbeddings(dataDb, ragHandle.db, {
      baseUrl: "http://embedding.local/v1",
      model: "test-embedding",
      maxChunks: 1,
      fetchImpl: fakeEmbeddingFetch,
    });
    expect(first).toMatchObject({
      candidates: 1,
      embeddedNow: 1,
      remainingMedical: 1,
      model: "test-embedding",
    });

    const second = await backfillMedicalKnowledgeEmbeddings(dataDb, ragHandle.db, {
      baseUrl: "http://embedding.local/v1",
      model: "test-embedding",
      fetchImpl: fakeEmbeddingFetch,
    });
    expect(second).toMatchObject({
      candidates: 1,
      embeddedNow: 1,
      remainingMedical: 0,
    });

    const embeddedMedical = ragHandle.db
      .prepare("SELECT COUNT(*) AS count FROM rag_chunks WHERE chunk_id LIKE 'medical/%' AND embedding IS NOT NULL")
      .get() as { count: number };
    const embeddedNonMedical = ragHandle.db
      .prepare("SELECT COUNT(*) AS count FROM rag_chunks WHERE chunk_id = 'non-medical/chunk' AND embedding IS NOT NULL")
      .get() as { count: number };
    expect(embeddedMedical.count).toBe(2);
    expect(embeddedNonMedical.count).toBe(0);
  });
});

async function fakeEmbeddingFetch(_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
  return new Response(
    JSON.stringify({
      data: (body.input ?? []).map((_text, index) => ({
        index,
        embedding: [index + 0.1, index + 0.2, index + 0.3],
      })),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function makeManifest(): MedicalKnowledgeManifest {
  return {
    document: {
      id: "doc-test-medical-embedding-v1",
      title: "Embedding Test Knowledge",
      source_type: "guideline_summary",
      source_name: "unit_test",
      version: "v1",
      language: "en",
      review_status: "approved",
      approved_by: "unit_test",
      approved_at: 1778245200000,
      metadata: { body_part: "thyroid" },
    },
    chunks: [
      {
        id: "composition",
        text: "solid composition evidence",
        section_title: "Composition",
        chunk_type: "guideline_summary",
        tirads_system: "ACR_TI_RADS",
        body_part: "thyroid",
      },
      {
        id: "safety",
        text: "AI report text remains draft",
        section_title: "Safety",
        chunk_type: "safety_policy",
        tirads_system: "ACR_TI_RADS",
        body_part: "thyroid",
      },
    ],
  };
}
