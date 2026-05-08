import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type Database from "better-sqlite3";

import { authenticate, jsonResponse, type HandlerDeps } from "./handlers";

interface CountRow {
  count: number;
}

interface StatusCountRow {
  status: string;
  count: number;
}

interface RecentStudyRow {
  id: string;
  patient_id: string | null;
  external_patient_id: string | null;
  accession_no: string | null;
  modality: string;
  body_part: string;
  study_time: number | null;
  status: string;
  source_type: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  image_count: number;
  nodule_count: number;
  latest_analysis_status: string | null;
  latest_report_status: string | null;
}

export async function handleMedicalSummary(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL
): Promise<void> {
  if (!authenticate(req, res, deps)) return;
  if (!deps.dataDb) {
    jsonResponse(res, 200, {
      enabled: false,
      message: "medical storage disabled (no data.db)",
      counts: emptyCounts(),
      queues: emptyQueues(),
      recentStudies: [],
      warnings: ["data_db_not_configured"],
    });
    return;
  }

  try {
    const limit = queryLimit(url, 12, 50);
    jsonResponse(res, 200, {
      enabled: true,
      counts: readCounts(deps.dataDb),
      queues: readQueues(deps.dataDb),
      recentStudies: readRecentStudies(deps.dataDb, limit),
      warnings: [],
    });
  } catch (err) {
    jsonResponse(res, 503, {
      error: {
        code: "medical-schema-unavailable",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function readCounts(db: Database.Database): Record<string, number> {
  return {
    patients: count(db, "patient"),
    studies: count(db, "study"),
    images: count(db, "image"),
    analysisSessions: count(db, "analysis_session"),
    nodules: count(db, "nodule"),
    reports: count(db, "report"),
    pendingReviews: count(db, "report", "status IN ('draft', 'pending_review')"),
  };
}

function readQueues(db: Database.Database): Record<string, Record<string, number>> {
  return {
    modelJobs: statusCounts(db, "model_job"),
    agentTasks: statusCounts(db, "agent_task"),
  };
}

function readRecentStudies(db: Database.Database, limit: number): Array<Record<string, unknown>> {
  return db
    .prepare<[number], RecentStudyRow>(
      `SELECT
         s.id,
         s.patient_id,
         p.external_patient_id,
         s.accession_no,
         s.modality,
         s.body_part,
         s.study_time,
         s.status,
         s.source_type,
         s.created_by,
         s.created_at,
         s.updated_at,
         (SELECT COUNT(*) FROM image i WHERE i.study_id = s.id) AS image_count,
         (SELECT COUNT(*) FROM nodule n WHERE n.study_id = s.id) AS nodule_count,
         (
           SELECT a.status
           FROM analysis_session a
           WHERE a.study_id = s.id
           ORDER BY a.updated_at DESC, a.created_at DESC, a.id DESC
           LIMIT 1
         ) AS latest_analysis_status,
         (
           SELECT r.status
           FROM report r
           WHERE r.study_id = s.id
           ORDER BY r.updated_at DESC, r.created_at DESC, r.id DESC
           LIMIT 1
         ) AS latest_report_status
       FROM study s
       LEFT JOIN patient p ON p.id = s.patient_id
       ORDER BY s.updated_at DESC, s.created_at DESC, s.id DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      externalPatientId: row.external_patient_id,
      accessionNo: row.accession_no,
      modality: row.modality,
      bodyPart: row.body_part,
      studyTime: row.study_time,
      status: row.status,
      sourceType: row.source_type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      imageCount: row.image_count,
      noduleCount: row.nodule_count,
      latestAnalysisStatus: row.latest_analysis_status,
      latestReportStatus: row.latest_report_status,
    }));
}

function count(db: Database.Database, table: string, where?: string): number {
  const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return (db.prepare(sql).get() as CountRow).count;
}

function statusCounts(db: Database.Database, table: string): Record<string, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status ORDER BY status ASC`)
    .all() as StatusCountRow[];
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function queryLimit(url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.trunc(value))) : fallback;
}

function emptyCounts(): Record<string, number> {
  return {
    patients: 0,
    studies: 0,
    images: 0,
    analysisSessions: 0,
    nodules: 0,
    reports: 0,
    pendingReviews: 0,
  };
}

function emptyQueues(): Record<string, Record<string, number>> {
  return {
    modelJobs: {},
    agentTasks: {},
  };
}
