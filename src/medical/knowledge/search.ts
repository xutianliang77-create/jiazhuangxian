import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

import { bm25Search } from "../../rag/bm25";
import { getChunk, getRagDbPath, type ChunkRecord } from "../../rag/store";

export interface MedicalKnowledgeSearchInput {
  query: string;
  topK?: number;
  filters?: {
    documentId?: string;
    sourceType?: string;
    chunkType?: string;
    topic?: string;
    evidenceLevel?: string;
    tiradsSystem?: string;
    bodyPart?: string;
  };
}

export interface MedicalKnowledgeSearchOptions {
  dataDb: Database.Database;
  dataDbPath?: string;
  ragDb?: Database.Database;
  ragDbPath?: string;
  workspace?: string;
}

export interface MedicalKnowledgeEvidence {
  chunkId: string;
  score: number;
  hits: string[];
  text: string;
  document: {
    id: string;
    title: string;
    sourceType: string;
    sourceName: string;
    version: string;
    language: string;
    effectiveDate: string | null;
    fileUri: string | null;
    reviewStatus: string;
    approvedBy: string | null;
    approvedAt: number | null;
  };
  metadata: {
    sectionTitle: string | null;
    chunkType: string;
    topic: string | null;
    pageNo: number | null;
    evidenceLevel: string | null;
    tiradsSystem: string | null;
    bodyPart: string | null;
    reviewStatus: string;
    relPath: string;
    lineStart: number;
    lineEnd: number;
    indexedAt: number;
  };
}

export interface MedicalKnowledgeSearchResult {
  enabled: boolean;
  mode: "bm25" | "like" | "mixed";
  query: string;
  count: number;
  evidence: MedicalKnowledgeEvidence[];
  warnings: string[];
}

interface MedicalChunkMetadataRow {
  document_id: string;
  rag_chunk_id: string;
  section_title: string | null;
  chunk_type: string;
  topic: string | null;
  page_no: number | null;
  evidence_level: string | null;
  tirads_system: string | null;
  body_part: string | null;
  chunk_review_status: string;
  title: string;
  source_type: string;
  source_name: string;
  version: string;
  language: string;
  effective_date: string | null;
  file_uri: string | null;
  document_review_status: string;
  approved_by: string | null;
  approved_at: number | null;
}

interface Candidate {
  chunkId: string;
  score: number;
  hits: string[];
  mode: "bm25" | "like";
}

export function searchMedicalKnowledge(
  input: MedicalKnowledgeSearchInput,
  options: MedicalKnowledgeSearchOptions
): MedicalKnowledgeSearchResult {
  const query = input.query.trim();
  if (!query) {
    return {
      enabled: true,
      mode: "bm25",
      query,
      count: 0,
      evidence: [],
      warnings: ["missing_query"],
    };
  }

  const topK = clampTopK(input.topK);
  const ragDbResult = withRagDb(options, query, (ragDb) => {
    const candidateLimit = Math.max(topK * 5, 20);
    const candidates = mergeCandidates([
      ...bm25Search(ragDb, query, candidateLimit).map((item): Candidate => ({
        chunkId: item.chunkId,
        score: item.score,
        hits: item.hits,
        mode: "bm25",
      })),
      ...likeSearch(ragDb, query, candidateLimit),
    ]);

    const evidence: MedicalKnowledgeEvidence[] = [];
    for (const candidate of candidates) {
      const chunk = getChunk(ragDb, candidate.chunkId);
      if (!chunk) continue;
      const metadata = getApprovedMedicalMetadata(options.dataDb, candidate.chunkId, input.filters);
      if (!metadata) continue;
      evidence.push(mapEvidence(candidate, chunk, metadata));
      if (evidence.length >= topK) break;
    }

    const modes = new Set(evidence.map((item) => candidateMode(candidates, item.chunkId)));
    const mode: MedicalKnowledgeSearchResult["mode"] = modes.size > 1
      ? "mixed"
      : modes.has("like")
        ? "like"
        : "bm25";
    return {
      enabled: true,
      mode,
      query,
      count: evidence.length,
      evidence,
      warnings: evidence.length === 0 ? ["medical_knowledge_no_matches"] : [],
    };
  });

  return ragDbResult;
}

export function resolveMedicalRagDbPath(options: {
  dataDbPath?: string;
  ragDbPath?: string;
  workspace?: string;
}): string | undefined {
  if (options.ragDbPath) return options.ragDbPath;
  if (process.env.JZX_RAG_DB) return process.env.JZX_RAG_DB;
  if (options.dataDbPath) {
    const sibling = path.join(path.dirname(options.dataDbPath), "rag.db");
    if (existsSync(sibling)) return sibling;
  }
  if (options.workspace) return getRagDbPath(options.workspace);
  return undefined;
}

function withRagDb<T>(
  options: MedicalKnowledgeSearchOptions,
  query: string,
  callback: (db: Database.Database) => T
): T | MedicalKnowledgeSearchResult {
  if (options.ragDb) return callback(options.ragDb);
  const ragDbPath = resolveMedicalRagDbPath(options);
  if (!ragDbPath || !existsSync(ragDbPath)) {
    return {
      enabled: true,
      mode: "bm25",
      query,
      count: 0,
      evidence: [],
      warnings: ["rag_db_unavailable"],
    };
  }
  const db = new Database(ragDbPath, { readonly: true, fileMustExist: true });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function likeSearch(db: Database.Database, query: string, limit: number): Candidate[] {
  const pattern = `%${escapeLike(query)}%`;
  const rows = db
    .prepare<[string, number], { chunk_id: string; content: string }>(
      `SELECT chunk_id, content
       FROM rag_chunks
       WHERE content LIKE ? ESCAPE '\\'
       ORDER BY indexed_at DESC, chunk_id ASC
       LIMIT ?`
    )
    .all(pattern, limit);
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    score: likeScore(query, row.content),
    hits: [query],
    mode: "like",
  }));
}

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.chunkId);
    if (!existing) {
      merged.set(candidate.chunkId, { ...candidate });
      continue;
    }
    existing.score = Math.max(existing.score, candidate.score);
    existing.hits = Array.from(new Set([...existing.hits, ...candidate.hits])).sort();
    if (existing.mode !== candidate.mode) existing.mode = "bm25";
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
}

function getApprovedMedicalMetadata(
  db: Database.Database,
  ragChunkId: string,
  filters: MedicalKnowledgeSearchInput["filters"] | undefined
): MedicalChunkMetadataRow | null {
  const where = [
    "m.rag_chunk_id = ?",
    "m.review_status = 'approved'",
    "d.review_status = 'approved'",
  ];
  const params: Array<string | number> = [ragChunkId];
  addFilter(where, params, "d.id", filters?.documentId);
  addFilter(where, params, "d.source_type", filters?.sourceType);
  addFilter(where, params, "m.chunk_type", filters?.chunkType);
  addFilter(where, params, "m.topic", filters?.topic);
  addFilter(where, params, "m.evidence_level", filters?.evidenceLevel);
  addFilter(where, params, "m.tirads_system", filters?.tiradsSystem);
  addFilter(where, params, "m.body_part", filters?.bodyPart);

  const row = db
    .prepare(
      `SELECT
         m.document_id,
         m.rag_chunk_id,
         m.section_title,
         m.chunk_type,
         m.topic,
         m.page_no,
         m.evidence_level,
         m.tirads_system,
         m.body_part,
         m.review_status AS chunk_review_status,
         d.title,
         d.source_type,
         d.source_name,
         d.version,
         d.language,
         d.effective_date,
         d.file_uri,
         d.review_status AS document_review_status,
         d.approved_by,
         d.approved_at
       FROM medical_chunk_metadata m
       JOIN medical_documents d ON d.id = m.document_id
       WHERE ${where.join(" AND ")}
       LIMIT 1`
    )
    .get(...params) as MedicalChunkMetadataRow | undefined;
  return row ?? null;
}

function mapEvidence(
  candidate: Candidate,
  chunk: ChunkRecord,
  metadata: MedicalChunkMetadataRow
): MedicalKnowledgeEvidence {
  return {
    chunkId: candidate.chunkId,
    score: Number(candidate.score.toFixed(6)),
    hits: candidate.hits,
    text: chunk.content,
    document: {
      id: metadata.document_id,
      title: metadata.title,
      sourceType: metadata.source_type,
      sourceName: metadata.source_name,
      version: metadata.version,
      language: metadata.language,
      effectiveDate: metadata.effective_date,
      fileUri: metadata.file_uri,
      reviewStatus: metadata.document_review_status,
      approvedBy: metadata.approved_by,
      approvedAt: metadata.approved_at,
    },
    metadata: {
      sectionTitle: metadata.section_title,
      chunkType: metadata.chunk_type,
      topic: metadata.topic,
      pageNo: metadata.page_no,
      evidenceLevel: metadata.evidence_level,
      tiradsSystem: metadata.tirads_system,
      bodyPart: metadata.body_part,
      reviewStatus: metadata.chunk_review_status,
      relPath: chunk.relPath,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      indexedAt: chunk.indexedAt,
    },
  };
}

function candidateMode(candidates: Candidate[], chunkId: string): "bm25" | "like" {
  return candidates.find((item) => item.chunkId === chunkId)?.mode ?? "bm25";
}

function addFilter(where: string[], params: Array<string | number>, column: string, value: string | undefined): void {
  if (!value) return;
  where.push(`${column} = ?`);
  params.push(value);
}

function clampTopK(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function likeScore(query: string, content: string): number {
  const ratio = Math.min(1, query.length / Math.max(content.length, 1));
  return Number((0.1 + ratio).toFixed(6));
}
