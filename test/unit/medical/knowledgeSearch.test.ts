import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ingestMedicalKnowledgeManifest, type MedicalKnowledgeManifest } from "../../../src/medical/knowledge/ingestion";
import { searchMedicalKnowledge } from "../../../src/medical/knowledge/search";
import { openRagDb, type RagDbHandle } from "../../../src/rag/store";
import { migrateIfNeeded } from "../../../src/storage/migrate";

let tmpRoot: string;
let dataDb: Database.Database;
let ragHandle: RagDbHandle;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-med-knowledge-search-"));
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

describe("medical knowledge search", () => {
  it("returns approved RAG chunks with medical provenance", () => {
    ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, manifest(), {
      jobId: "job-med-knowledge-search-1",
      now: 1778245200000,
      workspaceRelPath: "examples/medical-knowledge/search-test.md",
    });

    const result = searchMedicalKnowledge({
      query: "solid composition",
      topK: 3,
      filters: { bodyPart: "thyroid" },
    }, {
      dataDb,
      ragDb: ragHandle.db,
    });

    expect(result).toMatchObject({
      enabled: true,
      query: "solid composition",
      count: 1,
      warnings: [],
      evidence: [
        {
          chunkId: "medical/doc-search-knowledge-v1/composition",
          document: {
            id: "doc-search-knowledge-v1",
            reviewStatus: "approved",
            sourceName: "unit_test_guideline",
          },
          metadata: {
            sectionTitle: "Composition",
            bodyPart: "thyroid",
            reviewStatus: "approved",
            relPath: "examples/medical-knowledge/search-test.md",
          },
        },
      ],
    });
    expect(result.evidence[0]?.text).toContain("Solid composition");
  });

  it("falls back to content LIKE matching for Chinese evidence text", () => {
    ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, manifest(), {
      jobId: "job-med-knowledge-search-2",
      now: 1778245200000,
      workspaceRelPath: "examples/medical-knowledge/search-test.md",
    });

    const result = searchMedicalKnowledge({
      query: "甲状腺结节",
      topK: 3,
    }, {
      dataDb,
      ragDb: ragHandle.db,
    });

    expect(result.count).toBe(1);
    expect(result.evidence[0]?.chunkId).toBe("medical/doc-search-knowledge-v1/safety");
    expect(result.evidence[0]?.text).toContain("甲状腺结节");
  });
});

function manifest(): MedicalKnowledgeManifest {
  return {
    document: {
      id: "doc-search-knowledge-v1",
      title: "Search Knowledge",
      source_type: "guideline_summary",
      source_name: "unit_test_guideline",
      version: "v1",
      language: "zh-CN",
      review_status: "approved",
      approved_by: "unit_test",
      approved_at: 1778245200000,
    },
    chunks: [
      {
        id: "composition",
        text: "Solid composition adds two points in ACR TI-RADS validation scoring.",
        section_title: "Composition",
        chunk_type: "guideline_summary",
        topic: "tirads",
        evidence_level: "guideline",
        tirads_system: "ACR_TI_RADS",
        body_part: "thyroid",
      },
      {
        id: "safety",
        text: "甲状腺结节报告建议必须由医生确认，AI 草稿不能作为最终诊断。",
        section_title: "Safety",
        chunk_type: "safety_policy",
        topic: "report_safety",
        evidence_level: "policy",
        body_part: "thyroid",
      },
    ],
  };
}
