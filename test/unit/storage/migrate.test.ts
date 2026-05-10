/**
 * P0-W1-03/04 · Storage 迁移单测
 * 覆盖：首次初始化 / 幂等 / schema_version 追踪 / 11+ 张表存在
 */

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { currentVersion, listMigrations, migrateIfNeeded } from "../../../src/storage/migrate";
import { closeDataDb, openDataDb } from "../../../src/storage/db";
import { closeAuditDb, openAuditDb } from "../../../src/storage/audit";

let tmpDir: string | null = null;

function tempPath(name: string): string {
  if (!tmpDir) tmpDir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-storage-"));
  return path.join(tmpDir, name);
}

afterEach(() => {
  // 每个用例清 singleton，避免污染
  try {
    closeDataDb();
  } catch { /* noop */ }
  try {
    closeAuditDb();
  } catch { /* noop */ }

  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("migrate · data", () => {
  it("listMigrations returns at least one file, sorted by version", () => {
    const files = listMigrations("data");
    expect(files.length).toBeGreaterThanOrEqual(1);
    const versions = files.map((f) => f.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it("applies on empty DB and advances schema_version", () => {
    const dbPath = tempPath("data.db");
    const db = new Database(dbPath);
    expect(currentVersion(db)).toBe(0);

    const applied = migrateIfNeeded(db, "data");
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(currentVersion(db)).toBeGreaterThanOrEqual(1);

    // 核心 11+ 张表应全部存在
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(tables).toContain("sessions");
    expect(tables).toContain("tasks");
    expect(tables).toContain("steps");
    expect(tables).toContain("observations");
    expect(tables).toContain("l1_memory");
    expect(tables).toContain("memory_digest");
    expect(tables).toContain("approvals");
    expect(tables).toContain("agents");
    expect(tables).toContain("agent_tasks");
    expect(tables).toContain("blackboard_entries");
    expect(tables).toContain("agent_messages");
    expect(tables).toContain("ingress_dedup");
    expect(tables).toContain("llm_calls_raw");
    expect(tables).toContain("team_runs");
    expect(tables).toContain("team_claims");
    expect(tables).toContain("schema_version");

    db.close();
  });

  it("is idempotent: second run applies nothing", () => {
    const dbPath = tempPath("data.db");
    const db = new Database(dbPath);
    migrateIfNeeded(db, "data");
    const v1 = currentVersion(db);
    const applied2 = migrateIfNeeded(db, "data");
    expect(applied2).toHaveLength(0);
    expect(currentVersion(db)).toBe(v1);
    db.close();
  });

  it("repairs older version-6 data DBs before medical seed migrations", () => {
    const dbPath = tempPath("legacy-v6-data.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_version(version, name, applied_at)
      VALUES (1, 'init', 1), (2, 'session_memory', 2), (3, 'cron_runs', 3),
             (4, 'team_runs', 4), (5, 'team_claims', 5), (6, 'team_write_proposals', 6);
    `);

    const applied = migrateIfNeeded(db, "data");
    expect(applied).toEqual([7, 8]);
    expect(currentVersion(db)).toBe(8);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(tables).toContain("medical_documents");
    expect(tables).toContain("medical_terms");
    expect(tables).toContain("tirads_rules");

    const documentCount = db.prepare("SELECT COUNT(*) AS c FROM medical_documents").get() as { c: number };
    const termCount = db.prepare("SELECT COUNT(*) AS c FROM medical_terms").get() as { c: number };
    expect(documentCount.c).toBeGreaterThan(0);
    expect(termCount.c).toBeGreaterThan(0);
    db.close();
  });
});

describe("migrate · audit", () => {
  it("creates audit_events and indexes", () => {
    const dbPath = tempPath("audit.db");
    const db = new Database(dbPath);
    migrateIfNeeded(db, "audit");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(tables).toContain("audit_events");
    expect(tables).toContain("schema_version");

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(indexes).toContain("idx_audit_trace");
    expect(indexes).toContain("idx_audit_actor");

    db.close();
  });
});

describe("openDataDb", () => {
  it("opens, applies PRAGMA, runs migration, supports insert", () => {
    const dbPath = tempPath("data.db");
    const h = openDataDb({ path: dbPath, singleton: false });
    const jm = h.db.pragma("journal_mode", { simple: true });
    expect(jm).toBe("wal");
    const fk = h.db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);

    const now = Date.now();
    h.db
      .prepare(
        "INSERT INTO sessions(session_id, channel, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("01HX1234567890ABCDEFGHIJKL", "cli", "u1", now, now);
    const row = h.db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    expect(row.c).toBe(1);
    h.close();
  });

  it("returns the same singleton on repeated calls with same path", () => {
    const dbPath = tempPath("data.db");
    const a = openDataDb({ path: dbPath });
    const b = openDataDb({ path: dbPath });
    expect(a).toBe(b);
    a.close();
  });

  it("rejects opening a second singleton at a different path", () => {
    const p1 = tempPath("data.db");
    const p2 = tempPath("other.db");
    const h = openDataDb({ path: p1 });
    expect(() => openDataDb({ path: p2 })).toThrowError(/already open/);
    h.close();
  });
});

describe("openAuditDb", () => {
  it("opens a separate audit.db and supports chained-hash insert shape", () => {
    const dbPath = tempPath("audit.db");
    const h = openAuditDb({ path: dbPath, singleton: false });
    h.db
      .prepare(
        `INSERT INTO audit_events(event_id, trace_id, actor, action, decision, prev_hash, event_hash, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "01HX1234567890ABCDEFGHIJKL",
        "01HX1234567890ABCDEFGHIJKM",
        "tool",
        "tool.read",
        "allow",
        "genesis",
        "deadbeef",
        Date.now()
      );
    const count = h.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get() as { c: number };
    expect(count.c).toBe(1);
    h.close();
  });
});
