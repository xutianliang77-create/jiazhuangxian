import type { TeamClaim, TeamTask } from "./types";

export interface TeamClaimResult {
  claims: TeamClaim[];
  blockedReason: string;
}

export class TeamClaimRegistry {
  private readonly activeWrites = new Map<string, TeamClaim>();

  claimWriteTask(teamRunId: string, task: TeamTask, now: () => number): TeamClaimResult {
    const files = normalizeFiles(task.scope.files ?? []);
    if (files.length === 0) {
      return {
        claims: [],
        blockedReason: "write worker requires explicit file scope before claimed-file execution",
      };
    }

    const claims: TeamClaim[] = [];
    const conflicts: string[] = [];
    for (const file of files) {
      const existing = this.activeWrites.get(file);
      if (existing && existing.taskId !== task.id) {
        conflicts.push(`${file} already claimed by ${existing.taskId}`);
        claims.push({
          id: claimId(teamRunId, task.id, file),
          teamRunId,
          taskId: task.id,
          path: file,
          mode: "write",
          status: "blocked",
          reason: `conflicts with ${existing.taskId}`,
          createdAt: now(),
        });
        continue;
      }
      const claim: TeamClaim = {
        id: claimId(teamRunId, task.id, file),
        teamRunId,
        taskId: task.id,
        path: file,
        mode: "write",
        status: "pending_approval",
        reason: "write worker is gated until parent approval integration is enabled",
        createdAt: now(),
      };
      this.activeWrites.set(file, claim);
      claims.push(claim);
    }

    if (conflicts.length > 0) {
      return {
        claims,
        blockedReason: `claim conflict: ${conflicts.join("; ")}`,
      };
    }
    return {
      claims,
      blockedReason: `write worker pending approval for claimed files: ${files.join(", ")}`,
    };
  }
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort();
}

function claimId(teamRunId: string, taskId: string, file: string): string {
  return `${teamRunId}:${taskId}:${file}`.replace(/[^a-zA-Z0-9_.:@/-]+/g, "_");
}
