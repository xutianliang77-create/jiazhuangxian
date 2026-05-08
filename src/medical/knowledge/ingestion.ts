import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

import { deleteChunk, insertTerms, setMeta, upsertChunk } from "../../rag/store";
import { tokenFreqs, tokenize } from "../../rag/tokenize";

export type JsonObject = Record<string, unknown>;

export interface MedicalKnowledgeDocumentManifest {
  id: string;
  title: string;
  source_type: string;
  source_name: string;
  version: string;
  language: string;
  effective_date?: string;
  file_uri?: string;
  review_status: string;
  approved_by?: string;
  approved_at?: number;
  metadata?: JsonObject;
}

export interface MedicalKnowledgeChunkManifest {
  id?: string;
  text: string;
  section_title?: string;
  chunk_type?: string;
  topic?: string;
  page_no?: number;
  evidence_level?: string;
  tirads_system?: string;
  body_part?: string;
  line_start?: number;
  line_end?: number;
  metadata?: JsonObject;
}

export interface MedicalReportTemplateManifest {
  id: string;
  template_name: string;
  scene: string;
  tirads_category?: string | null;
  template_text: string;
  required_fields?: string[];
  forbidden_phrases?: string[];
  version: string;
  status?: string;
}

export interface MedicalKnowledgeManifest {
  document: MedicalKnowledgeDocumentManifest;
  chunks: MedicalKnowledgeChunkManifest[];
  report_templates?: MedicalReportTemplateManifest[];
}

export interface MedicalKnowledgeIngestionOptions {
  now?: number;
  jobId?: string;
  workspaceRelPath?: string;
}

export interface MedicalKnowledgeIngestionResult {
  jobId: string;
  documentId: string;
  chunksUpserted: number;
  templatesUpserted: number;
  ragChunkIds: string[];
}

interface BuiltChunk {
  ragChunkId: string;
  metadataId: string;
  relPath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  tokenCount: number;
  contentHash: string;
  sectionTitle: string | null;
  chunkType: string;
  topic: string | null;
  pageNo: number | null;
  evidenceLevel: string | null;
  tiradsSystem: string | null;
  bodyPart: string | null;
  metadataJson: string;
}

export function loadMedicalKnowledgeManifest(manifestPath: string): MedicalKnowledgeManifest {
  if (path.extname(manifestPath).toLowerCase() !== ".json") {
    throw new Error("medical knowledge ingestion currently accepts JSON manifest files only");
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  return normalizeManifest(raw, manifestPath);
}

export function ingestMedicalKnowledgeManifest(
  dataDb: Database.Database,
  ragDb: Database.Database,
  manifest: MedicalKnowledgeManifest,
  options: MedicalKnowledgeIngestionOptions = {}
): MedicalKnowledgeIngestionResult {
  const now = options.now ?? Date.now();
  const jobId = options.jobId ?? `kij-${ulid(now)}`;
  const documentId = manifest.document.id;
  const workspaceRelPath = options.workspaceRelPath ?? `${documentId}.medical.json`;

  startJob(dataDb, jobId, manifest, workspaceRelPath, now);

  try {
    validateApprovedManifest(manifest);
    const chunks = buildChunks(manifest, workspaceRelPath, now);
    const previousRagChunkIds = listExistingRagChunkIds(dataDb, documentId);
    const nextRagChunkIds = new Set(chunks.map((chunk) => chunk.ragChunkId));

    for (const oldChunkId of previousRagChunkIds) {
      if (!nextRagChunkIds.has(oldChunkId)) deleteChunk(ragDb, oldChunkId);
    }
    for (const chunk of chunks) {
      upsertChunk(ragDb, {
        chunkId: chunk.ragChunkId,
        relPath: chunk.relPath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        contentHash: chunk.contentHash,
        indexedAt: now,
      });
      insertTerms(ragDb, chunk.ragChunkId, tokenFreqs(chunk.content));
    }

    const tx = dataDb.transaction(() => {
      upsertDocument(dataDb, manifest.document, now);
      dataDb.prepare("DELETE FROM medical_chunk_metadata WHERE document_id = ?").run(documentId);
      for (const chunk of chunks) insertChunkMetadata(dataDb, documentId, manifest.document, chunk, now);
      for (const template of manifest.report_templates ?? []) upsertReportTemplate(dataDb, template, now);
      completeJob(dataDb, jobId, documentId, chunks, manifest.report_templates?.length ?? 0, now);
    });
    tx();
    setMeta(ragDb, "medical_last_ingested_at", String(now));

    return {
      jobId,
      documentId,
      chunksUpserted: chunks.length,
      templatesUpserted: manifest.report_templates?.length ?? 0,
      ragChunkIds: chunks.map((chunk) => chunk.ragChunkId),
    };
  } catch (error) {
    failJob(dataDb, jobId, error, now);
    throw error;
  }
}

function normalizeManifest(raw: unknown, source: string): MedicalKnowledgeManifest {
  const obj = requireObject(raw, `${source}: manifest`);
  const doc = requireObject(obj.document, `${source}: document`);
  const chunksRaw = requireArray(obj.chunks, `${source}: chunks`);
  const templatesRaw = optionalArray(obj.report_templates, `${source}: report_templates`);

  return {
    document: {
      id: requiredString(doc, "id"),
      title: requiredString(doc, "title"),
      source_type: requiredString(doc, "source_type"),
      source_name: requiredString(doc, "source_name"),
      version: requiredString(doc, "version"),
      language: requiredString(doc, "language"),
      effective_date: optionalString(doc, "effective_date"),
      file_uri: optionalString(doc, "file_uri"),
      review_status: requiredString(doc, "review_status"),
      approved_by: optionalString(doc, "approved_by"),
      approved_at: optionalNumber(doc, "approved_at"),
      metadata: optionalObject(doc, "metadata") ?? {},
    },
    chunks: chunksRaw.map((item, index) => normalizeChunk(item, index, source)),
    report_templates: templatesRaw.map((item, index) => normalizeTemplate(item, index, source)),
  };
}

function normalizeChunk(raw: unknown, index: number, source: string): MedicalKnowledgeChunkManifest {
  const obj = requireObject(raw, `${source}: chunks[${index}]`);
  return {
    id: optionalString(obj, "id"),
    text: requiredString(obj, "text"),
    section_title: optionalString(obj, "section_title"),
    chunk_type: optionalString(obj, "chunk_type"),
    topic: optionalString(obj, "topic"),
    page_no: optionalNumber(obj, "page_no"),
    evidence_level: optionalString(obj, "evidence_level"),
    tirads_system: optionalString(obj, "tirads_system"),
    body_part: optionalString(obj, "body_part"),
    line_start: optionalNumber(obj, "line_start"),
    line_end: optionalNumber(obj, "line_end"),
    metadata: optionalObject(obj, "metadata") ?? {},
  };
}

function normalizeTemplate(raw: unknown, index: number, source: string): MedicalReportTemplateManifest {
  const obj = requireObject(raw, `${source}: report_templates[${index}]`);
  return {
    id: requiredString(obj, "id"),
    template_name: requiredString(obj, "template_name"),
    scene: requiredString(obj, "scene"),
    tirads_category: optionalString(obj, "tirads_category") ?? null,
    template_text: requiredString(obj, "template_text"),
    required_fields: optionalStringArray(obj, "required_fields") ?? [],
    forbidden_phrases: optionalStringArray(obj, "forbidden_phrases") ?? [],
    version: requiredString(obj, "version"),
    status: optionalString(obj, "status") ?? "active",
  };
}

function validateApprovedManifest(manifest: MedicalKnowledgeManifest): void {
  const doc = manifest.document;
  if (doc.review_status !== "approved") {
    throw new Error(`medical document ${doc.id} must be approved before ingestion`);
  }
  if (!doc.approved_by?.trim()) {
    throw new Error(`medical document ${doc.id} must include approved_by before ingestion`);
  }
  if (manifest.chunks.length === 0) {
    throw new Error(`medical document ${doc.id} must include at least one knowledge chunk`);
  }
  manifest.chunks.forEach((chunk, index) => {
    if (!chunk.text.trim()) throw new Error(`medical document ${doc.id} chunk ${index + 1} is empty`);
    if (chunk.line_start !== undefined && !Number.isInteger(chunk.line_start)) {
      throw new Error(`medical document ${doc.id} chunk ${index + 1} line_start must be an integer`);
    }
    if (chunk.line_end !== undefined && !Number.isInteger(chunk.line_end)) {
      throw new Error(`medical document ${doc.id} chunk ${index + 1} line_end must be an integer`);
    }
  });
  for (const template of manifest.report_templates ?? []) {
    if (!["active", "inactive"].includes(template.status ?? "active")) {
      throw new Error(`report template ${template.id} status must be active or inactive`);
    }
  }
}

function buildChunks(
  manifest: MedicalKnowledgeManifest,
  workspaceRelPath: string,
  indexedAt: number
): BuiltChunk[] {
  return manifest.chunks.map((chunk, index) => {
    const chunkKey = safeChunkKey(chunk.id ?? `chunk-${String(index + 1).padStart(4, "0")}`);
    const lineStart = chunk.line_start ?? index + 1;
    const lineEnd = chunk.line_end ?? lineStart + chunk.text.split(/\r?\n/).length - 1;
    if (lineEnd < lineStart) {
      throw new Error(`medical document ${manifest.document.id} chunk ${index + 1} line_end is before line_start`);
    }
    const ragChunkId = `medical/${manifest.document.id}/${chunkKey}`;
    return {
      ragChunkId,
      metadataId: stableId("mcm", `${manifest.document.id}:${ragChunkId}`),
      relPath: workspaceRelPath,
      lineStart,
      lineEnd,
      content: chunk.text,
      tokenCount: tokenize(chunk.text).length,
      contentHash: sha256(chunk.text),
      sectionTitle: chunk.section_title ?? null,
      chunkType: chunk.chunk_type ?? "guideline",
      topic: chunk.topic ?? null,
      pageNo: chunk.page_no ?? null,
      evidenceLevel: chunk.evidence_level ?? null,
      tiradsSystem: chunk.tirads_system ?? null,
      bodyPart: chunk.body_part ?? null,
      metadataJson: JSON.stringify({
        ...(chunk.metadata ?? {}),
        chunk_index: index + 1,
        source_document_id: manifest.document.id,
        source_version: manifest.document.version,
        indexed_at: indexedAt,
      }),
    };
  });
}

function startJob(
  db: Database.Database,
  jobId: string,
  manifest: MedicalKnowledgeManifest,
  workspaceRelPath: string,
  now: number
): void {
  db.prepare(
    `INSERT INTO knowledge_ingestion_job(
       id, document_id, job_type, status, input_json, created_at, updated_at, started_at
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    jobId,
    "medical_manifest",
    "running",
    JSON.stringify({
      document_id: manifest.document.id,
      title: manifest.document.title,
      source_type: manifest.document.source_type,
      source_name: manifest.document.source_name,
      version: manifest.document.version,
      chunk_count: manifest.chunks.length,
      template_count: manifest.report_templates?.length ?? 0,
      workspace_rel_path: workspaceRelPath,
    }),
    now,
    now,
    now
  );
}

function completeJob(
  db: Database.Database,
  jobId: string,
  documentId: string,
  chunks: BuiltChunk[],
  templatesUpserted: number,
  now: number
): void {
  db.prepare(
    `UPDATE knowledge_ingestion_job
     SET document_id = ?, status = ?, output_json = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`
  ).run(
    documentId,
    "succeeded",
    JSON.stringify({
      document_id: documentId,
      chunks_upserted: chunks.length,
      templates_upserted: templatesUpserted,
      rag_chunk_ids: chunks.map((chunk) => chunk.ragChunkId),
    }),
    now,
    now,
    jobId
  );
}

function failJob(db: Database.Database, jobId: string, error: unknown, now: number): void {
  db.prepare(
    `UPDATE knowledge_ingestion_job
     SET status = ?, error_json = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`
  ).run(
    "failed",
    JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
    }),
    now,
    now,
    jobId
  );
}

function upsertDocument(db: Database.Database, doc: MedicalKnowledgeDocumentManifest, now: number): void {
  db.prepare(
    `INSERT INTO medical_documents(
       id, title, source_type, source_name, version, language, effective_date,
       file_uri, review_status, approved_by, approved_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       source_type = excluded.source_type,
       source_name = excluded.source_name,
       version = excluded.version,
       language = excluded.language,
       effective_date = excluded.effective_date,
       file_uri = excluded.file_uri,
       review_status = excluded.review_status,
       approved_by = excluded.approved_by,
       approved_at = excluded.approved_at,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`
  ).run(
    doc.id,
    doc.title,
    doc.source_type,
    doc.source_name,
    doc.version,
    doc.language,
    doc.effective_date ?? null,
    doc.file_uri ?? null,
    doc.review_status,
    doc.approved_by ?? null,
    doc.approved_at ?? now,
    JSON.stringify(doc.metadata ?? {}),
    now,
    now
  );
}

function insertChunkMetadata(
  db: Database.Database,
  documentId: string,
  doc: MedicalKnowledgeDocumentManifest,
  chunk: BuiltChunk,
  now: number
): void {
  db.prepare(
    `INSERT INTO medical_chunk_metadata(
       id, document_id, rag_chunk_id, section_title, chunk_type, topic, page_no,
       source_type, guideline_version, evidence_level, tirads_system, body_part,
       review_status, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chunk.metadataId,
    documentId,
    chunk.ragChunkId,
    chunk.sectionTitle,
    chunk.chunkType,
    chunk.topic,
    chunk.pageNo,
    doc.source_type,
    doc.version,
    chunk.evidenceLevel,
    chunk.tiradsSystem,
    chunk.bodyPart,
    doc.review_status,
    chunk.metadataJson,
    now
  );
}

function upsertReportTemplate(db: Database.Database, template: MedicalReportTemplateManifest, now: number): void {
  db.prepare(
    `INSERT INTO report_templates(
       id, template_name, scene, tirads_category, template_text,
       required_fields_json, forbidden_phrases_json, version, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       template_name = excluded.template_name,
       scene = excluded.scene,
       tirads_category = excluded.tirads_category,
       template_text = excluded.template_text,
       required_fields_json = excluded.required_fields_json,
       forbidden_phrases_json = excluded.forbidden_phrases_json,
       version = excluded.version,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(
    template.id,
    template.template_name,
    template.scene,
    template.tirads_category ?? null,
    template.template_text,
    JSON.stringify(template.required_fields ?? []),
    JSON.stringify(template.forbidden_phrases ?? []),
    template.version,
    template.status ?? "active",
    now,
    now
  );
}

function listExistingRagChunkIds(db: Database.Database, documentId: string): string[] {
  return db
    .prepare("SELECT rag_chunk_id FROM medical_chunk_metadata WHERE document_id = ?")
    .all(documentId)
    .map((row) => (row as { rag_chunk_id: string }).rag_chunk_id);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function optionalArray(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  return requireArray(value, label);
}

function requiredString(obj: JsonObject, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function optionalString(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(obj: JsonObject, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

function optionalObject(obj: JsonObject, key: string): JsonObject | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  return requireObject(value, key);
}

function optionalStringArray(obj: JsonObject, key: string): string[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function safeChunkKey(value: string): string {
  const key = value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!key) throw new Error("chunk id must contain at least one safe character");
  return key;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
