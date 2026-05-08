import type Database from "better-sqlite3";

import { embedTexts, vectorToBlob, type EmbedOptions } from "../../rag/embedding";
import { setEmbedding } from "../../rag/store";

export interface MedicalEmbeddingBackfillOptions extends EmbedOptions {
  maxChunks?: number;
  batch?: number;
}

export interface MedicalEmbeddingBackfillResult {
  candidates: number;
  embeddedNow: number;
  remainingMedical: number;
  model: string;
  baseUrl: string;
}

interface MedicalChunkForEmbedding {
  chunkId: string;
  content: string;
}

export async function backfillMedicalKnowledgeEmbeddings(
  dataDb: Database.Database,
  ragDb: Database.Database,
  options: MedicalEmbeddingBackfillOptions
): Promise<MedicalEmbeddingBackfillResult> {
  const candidates = listMedicalChunksMissingEmbedding(dataDb, ragDb, options.maxChunks ?? 500);
  if (candidates.length === 0) {
    return {
      candidates: 0,
      embeddedNow: 0,
      remainingMedical: countMedicalChunksMissingEmbedding(dataDb, ragDb),
      model: options.model,
      baseUrl: options.baseUrl,
    };
  }

  const vectors = await embedTexts(
    candidates.map((chunk) => chunk.content),
    {
      ...options,
      batchSize: options.batch ?? options.batchSize,
    }
  );
  for (let i = 0; i < candidates.length && i < vectors.length; i += 1) {
    setEmbedding(ragDb, candidates[i].chunkId, vectorToBlob(vectors[i]));
  }

  return {
    candidates: candidates.length,
    embeddedNow: Math.min(candidates.length, vectors.length),
    remainingMedical: countMedicalChunksMissingEmbedding(dataDb, ragDb),
    model: options.model,
    baseUrl: options.baseUrl,
  };
}

export function listMedicalChunksMissingEmbedding(
  dataDb: Database.Database,
  ragDb: Database.Database,
  limit: number
): MedicalChunkForEmbedding[] {
  const chunkIds = listApprovedMedicalRagChunkIds(dataDb);
  const out: MedicalChunkForEmbedding[] = [];
  const stmt = ragDb.prepare("SELECT chunk_id, content FROM rag_chunks WHERE chunk_id = ? AND embedding IS NULL");
  for (const chunkId of chunkIds) {
    if (out.length >= limit) break;
    const row = stmt.get(chunkId) as { chunk_id: string; content: string } | undefined;
    if (row) out.push({ chunkId: row.chunk_id, content: row.content });
  }
  return out;
}

export function countMedicalChunksMissingEmbedding(dataDb: Database.Database, ragDb: Database.Database): number {
  const chunkIds = listApprovedMedicalRagChunkIds(dataDb);
  const stmt = ragDb.prepare("SELECT COUNT(*) AS count FROM rag_chunks WHERE chunk_id = ? AND embedding IS NULL");
  let count = 0;
  for (const chunkId of chunkIds) {
    count += (stmt.get(chunkId) as { count: number }).count;
  }
  return count;
}

function listApprovedMedicalRagChunkIds(dataDb: Database.Database): string[] {
  return (
    dataDb
      .prepare(
        `SELECT rag_chunk_id
         FROM medical_chunk_metadata
         WHERE review_status = 'approved'
         ORDER BY created_at ASC, rag_chunk_id ASC`
      )
      .all() as Array<{ rag_chunk_id: string }>
  ).map((row) => row.rag_chunk_id);
}
