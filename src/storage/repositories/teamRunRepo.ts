import type Database from "better-sqlite3";

import { evaluateTeamMergeGate } from "../../agent/team/mergeGate";
import type { TeamRun } from "../../agent/team/types";

export class TeamRunRepo {
  constructor(private readonly db: Database.Database) {}

  save(run: TeamRun): void {
    this.db
      .prepare(
        `INSERT INTO team_runs(run_id, session_id, user_goal, status, summary, run_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           session_id = excluded.session_id,
           user_goal = excluded.user_goal,
           status = excluded.status,
           summary = excluded.summary,
           run_json = excluded.run_json,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
      .run(
        run.id,
        run.sessionId ?? null,
        run.userGoal,
        run.status,
        run.summary,
        JSON.stringify(run),
        run.createdAt,
        run.updatedAt
      );
    this.saveClaims(run);
  }

  get(id: string): TeamRun | undefined {
    const row = this.db
      .prepare<[string], { run_json: string }>("SELECT run_json FROM team_runs WHERE run_id = ?")
      .get(id);
    return row ? parseRun(row.run_json) : undefined;
  }

  list(sessionId?: string, limit = 20): TeamRun[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = sessionId
      ? this.db
          .prepare<[string, number], { run_json: string }>(
            `SELECT run_json FROM team_runs
             WHERE session_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`
          )
          .all(sessionId, safeLimit)
      : this.db
          .prepare<[number], { run_json: string }>(
            `SELECT run_json FROM team_runs
             ORDER BY updated_at DESC
             LIMIT ?`
          )
          .all(safeLimit);
    return rows.map((row) => parseRun(row.run_json)).filter((run): run is TeamRun => Boolean(run));
  }

  private saveClaims(run: TeamRun): void {
    const claims = run.claims ?? [];
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM team_claims WHERE run_id = ?").run(run.id);
      const insert = this.db.prepare(
        `INSERT INTO team_claims(
           claim_id, run_id, task_id, path, mode, status, reason, created_at, released_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const claim of claims) {
        insert.run(
          claim.id,
          claim.teamRunId,
          claim.taskId,
          claim.path,
          claim.mode,
          claim.status,
          claim.reason ?? null,
          claim.createdAt,
          claim.releasedAt ?? null
        );
      }
    });
    tx();
  }
}

function parseRun(json: string): TeamRun | undefined {
  try {
    const value = JSON.parse(json) as TeamRun;
    if (!value || typeof value.id !== "string") return undefined;
    if (!value.mergeGate && value.plan && Array.isArray(value.taskRuns)) {
      value.mergeGate = evaluateTeamMergeGate(value.plan, value.taskRuns);
    }
    return value;
  } catch {
    return undefined;
  }
}
