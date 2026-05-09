import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ingestMedicalKnowledgeManifest,
  loadMedicalKnowledgeManifest,
  type MedicalKnowledgeManifest,
} from "../../../src/medical/knowledge/ingestion";
import { openRagDb, type RagDbHandle } from "../../../src/rag/store";
import { migrateIfNeeded } from "../../../src/storage/migrate";

let tmpRoot: string;
let dataDb: Database.Database;
let ragHandle: RagDbHandle;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-med-knowledge-"));
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

describe("medical knowledge ingestion", () => {
  it("writes approved manifest content to medical tables and CodeClaw RAG", () => {
    const manifest = makeManifest();
    const result = ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, manifest, {
      jobId: "job-med-knowledge-1",
      now: 1778245200000,
      workspaceRelPath: "examples/medical-knowledge/test.manifest.json",
    });

    expect(result).toMatchObject({
      jobId: "job-med-knowledge-1",
      documentId: "doc-test-medical-knowledge-v1",
      chunksUpserted: 2,
      templatesUpserted: 1,
    });
    expect(result.ragChunkIds).toEqual([
      "medical/doc-test-medical-knowledge-v1/composition",
      "medical/doc-test-medical-knowledge-v1/report-safety",
    ]);

    const document = dataDb
      .prepare("SELECT review_status, approved_by FROM medical_documents WHERE id = ?")
      .get(manifest.document.id) as { review_status: string; approved_by: string };
    expect(document).toEqual({ review_status: "approved", approved_by: "unit_test" });

    expect(countDataRows("medical_chunk_metadata", "document_id = ?", manifest.document.id)).toBe(2);
    expect(countRagRows("rag_chunks", "chunk_id = ?", result.ragChunkIds[0])).toBe(1);
    expect(countRagRows("rag_terms", "chunk_id = ?", result.ragChunkIds[0])).toBeGreaterThan(0);

    const chunk = ragHandle.db
      .prepare("SELECT rel_path, content FROM rag_chunks WHERE chunk_id = ?")
      .get(result.ragChunkIds[0]) as { rel_path: string; content: string };
    expect(chunk.rel_path).toBe("examples/medical-knowledge/test.manifest.json");
    expect(chunk.content).toContain("composition");

    const template = dataDb
      .prepare("SELECT status FROM report_templates WHERE id = ?")
      .get("tpl-test-medical-evidence-v1") as { status: string };
    expect(template.status).toBe("active");

    const job = dataDb
      .prepare("SELECT status, document_id, output_json FROM knowledge_ingestion_job WHERE id = ?")
      .get("job-med-knowledge-1") as { status: string; document_id: string; output_json: string };
    expect(job.status).toBe("succeeded");
    expect(job.document_id).toBe(manifest.document.id);
    expect(JSON.parse(job.output_json)).toMatchObject({ chunks_upserted: 2, templates_upserted: 1 });
  });

  it("replaces document chunk metadata and removes stale RAG chunks on reingestion", () => {
    const manifest = makeManifest();
    ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, manifest, {
      jobId: "job-med-knowledge-1",
      now: 1778245200000,
      workspaceRelPath: "examples/medical-knowledge/test.manifest.json",
    });

    const updatedManifest: MedicalKnowledgeManifest = {
      ...manifest,
      chunks: [
        {
          ...manifest.chunks[0],
          text: "Updated ACR TI-RADS composition evidence for validation ingestion.",
        },
      ],
    };
    const result = ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, updatedManifest, {
      jobId: "job-med-knowledge-2",
      now: 1778245300000,
      workspaceRelPath: "examples/medical-knowledge/test.manifest.json",
    });

    expect(result.chunksUpserted).toBe(1);
    expect(countDataRows("medical_chunk_metadata", "document_id = ?", manifest.document.id)).toBe(1);
    expect(countRagRows("rag_chunks", "chunk_id = ?", "medical/doc-test-medical-knowledge-v1/composition")).toBe(1);
    expect(countRagRows("rag_chunks", "chunk_id = ?", "medical/doc-test-medical-knowledge-v1/report-safety")).toBe(0);
  });

  it("rejects non-approved documents and records a failed ingestion job", () => {
    const manifest: MedicalKnowledgeManifest = {
      ...makeManifest(),
      document: {
        ...makeManifest().document,
        review_status: "draft",
      },
    };

    expect(() =>
      ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, manifest, {
        jobId: "job-med-knowledge-failed",
        now: 1778245200000,
        workspaceRelPath: "examples/medical-knowledge/test.manifest.json",
      })
    ).toThrow(/approved/);

    expect(countDataRows("medical_documents", "id = ?", manifest.document.id)).toBe(0);
    const job = dataDb
      .prepare("SELECT status, error_json FROM knowledge_ingestion_job WHERE id = ?")
      .get("job-med-knowledge-failed") as { status: string; error_json: string };
    expect(job.status).toBe("failed");
    expect(JSON.parse(job.error_json).message).toContain("approved");
  });

  it("loads the checked-in validation manifest", () => {
    const manifest = loadMedicalKnowledgeManifest(
      path.join(process.cwd(), "examples/medical-knowledge/acr-tirads-validation.manifest.json")
    );
    expect(manifest.document.review_status).toBe("approved");
    expect(manifest.chunks.length).toBeGreaterThan(0);
    expect(manifest.report_templates?.[0]?.scene).toBe("tirads_evidence_summary");
  });

  it("loads the first-version thyroid guideline knowledge base", () => {
    const manifest = loadMedicalKnowledgeManifest(
      path.join(process.cwd(), "examples/medical-knowledge/thyroid-guidelines-v1.manifest.json")
    );

    expect(manifest.document.id).toBe("doc-thyroid-guidelines-v1");
    expect(manifest.document.review_status).toBe("approved");
    expect(manifest.chunks).toHaveLength(13);
    expect(manifest.chunks.map((chunk) => chunk.id)).toEqual(
      expect.arrayContaining([
        "acr-tirads-category-score",
        "acr-tirads-size-actions",
        "ata-2015-fna-thresholds",
        "eu-tirads-fna-thresholds",
        "c-tirads-reference-boundary",
        "report-safety-evidence-required",
      ])
    );
    expect(manifest.report_templates?.map((template) => template.scene)).toEqual(
      expect.arrayContaining(["guideline_evidence_summary", "guideline_conflict_review"])
    );
  });

  it("loads Markdown front matter and chunks headings into RAG-ready sections", () => {
    const file = path.join(tmpRoot, "markdown-knowledge.md");
    writeFileSync(
      file,
      `---
document:
  id: doc-test-markdown-knowledge-v1
  title: Markdown Knowledge
  source_type: guideline_summary
  source_name: unit_test_markdown
  version: v1
  language: zh-CN
  review_status: approved
  approved_by: unit_test
chunk_defaults:
  chunk_type: guideline_summary
  topic: tirads
  evidence_level: test
  tirads_system: ACR_TI_RADS
  body_part: thyroid
report_templates:
  - id: tpl-test-markdown-v1
    template_name: Markdown Template
    scene: tirads_evidence_summary
    template_text: "{evidence_summary}"
    required_fields: ["evidence_summary"]
    forbidden_phrases: ["确诊"]
    version: v1
    status: active
---

# Composition

Solid composition adds points.

## Safety

AI text remains a draft.
`
    );

    const manifest = loadMedicalKnowledgeManifest(file);
    expect(manifest.document.id).toBe("doc-test-markdown-knowledge-v1");
    expect(manifest.chunks).toHaveLength(2);
    expect(manifest.chunks[0]).toMatchObject({
      id: "composition",
      section_title: "Composition",
      chunk_type: "guideline_summary",
      tirads_system: "ACR_TI_RADS",
      body_part: "thyroid",
    });

    const result = ingestMedicalKnowledgeManifest(dataDb, ragHandle.db, manifest, {
      jobId: "job-med-markdown-1",
      now: 1778245200000,
      workspaceRelPath: "examples/medical-knowledge/markdown-knowledge.md",
    });

    expect(result).toMatchObject({
      documentId: "doc-test-markdown-knowledge-v1",
      chunksUpserted: 2,
      templatesUpserted: 1,
    });
    expect(countRagRows("rag_chunks", "chunk_id = ?", "medical/doc-test-markdown-knowledge-v1/composition")).toBe(1);
  });
});

function makeManifest(): MedicalKnowledgeManifest {
  return {
    document: {
      id: "doc-test-medical-knowledge-v1",
      title: "Test Medical Knowledge",
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
        text: "ACR TI-RADS composition evidence uses cystic, mixed, and solid findings.",
        section_title: "Composition",
        chunk_type: "guideline_summary",
        topic: "tirads",
        evidence_level: "test",
        tirads_system: "ACR_TI_RADS",
        body_part: "thyroid",
      },
      {
        id: "report-safety",
        text: "AI generated thyroid report text must remain a draft until doctor review.",
        section_title: "Safety",
        chunk_type: "safety_policy",
        topic: "report_generation",
        evidence_level: "test",
        tirads_system: "ACR_TI_RADS",
        body_part: "thyroid",
      },
    ],
    report_templates: [
      {
        id: "tpl-test-medical-evidence-v1",
        template_name: "Test Medical Evidence Template",
        scene: "tirads_evidence_summary",
        tirads_category: null,
        template_text: "Nodule {nodule_index}: {feature_summary}; evidence: {evidence_summary}.",
        required_fields: ["nodule_index", "feature_summary", "evidence_summary"],
        forbidden_phrases: ["final diagnosis"],
        version: "v1",
        status: "active",
      },
    ],
  };
}

function countDataRows(table: string, where: string, value: string): number {
  return (dataDb.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(value) as { count: number })
    .count;
}

function countRagRows(table: string, where: string, value: string): number {
  return (ragHandle.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(value) as { count: number })
    .count;
}
