import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildTeamPlan, runReadOnlyTeamPlan } from "../../../../src/agent/team";
import { TeamRunRepo } from "../../../../src/storage/repositories/teamRunRepo";
import { migrateIfNeeded } from "../../../../src/storage/migrate";

let tmpRoot: string;
let db: Database.Database;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-team-repo-"));
  db = new Database(path.join(tmpRoot, "data.db"));
  migrateIfNeeded(db, "data");
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // noop
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("TeamRunRepo", () => {
  it("saves and lists TeamRun snapshots by session", () => {
    const repo = new TeamRunRepo(db);
    const run = runReadOnlyTeamPlan(buildTeamPlan("审查 src/agent/queryEngine.ts"), {
      now: () => 1234,
      sessionId: "session-a",
    });
    repo.save(run);

    expect(repo.get(run.id)?.summary).toBe(run.summary);
    expect(repo.list("session-a")).toHaveLength(1);
    expect(repo.list("session-b")).toHaveLength(0);
  });

  it("persists claimed-file gate rows for blocked write workers", () => {
    const repo = new TeamRunRepo(db);
    const run = runReadOnlyTeamPlan(buildTeamPlan("修复 src/agent/queryEngine.ts 并补测试"), {
      now: () => 5678,
      sessionId: "session-write",
    });
    repo.save(run);

    const rows = db.prepare("SELECT path, status FROM team_claims WHERE run_id = ?").all(run.id) as Array<{
      path: string;
      status: string;
    }>;
    expect(rows).toContainEqual({
      path: "src/agent/queryEngine.ts",
      status: "pending_approval",
    });
  });
});
