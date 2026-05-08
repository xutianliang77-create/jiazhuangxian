import type { TeamRun } from "./types";

export class InMemoryTeamRunStore {
  private runs = new Map<string, TeamRun>();
  private latestId: string | null = null;

  save(run: TeamRun): void {
    this.runs.set(run.id, cloneRun(run));
    this.latestId = run.id;
  }

  get(id: string): TeamRun | undefined {
    const run = this.runs.get(id);
    return run ? cloneRun(run) : undefined;
  }

  latest(): TeamRun | undefined {
    return this.latestId ? this.get(this.latestId) : undefined;
  }

  list(): TeamRun[] {
    return [...this.runs.values()].map(cloneRun);
  }
}

function cloneRun(run: TeamRun): TeamRun {
  return {
    ...run,
    plan: {
      ...run.plan,
      tasks: run.plan.tasks.map((task) => ({
        ...task,
        deps: [...task.deps],
        allowedTools: [...task.allowedTools],
        acceptance: [...task.acceptance],
        scope: {
          ...(task.scope.files ? { files: [...task.scope.files] } : {}),
          ...(task.scope.directories ? { directories: [...task.scope.directories] } : {}),
          ...(task.scope.symbols ? { symbols: [...task.scope.symbols] } : {}),
          ...(task.scope.maxFiles !== undefined ? { maxFiles: task.scope.maxFiles } : {}),
        },
      })),
      budget: { ...run.plan.budget },
      warnings: [...run.plan.warnings],
    },
    taskRuns: run.taskRuns.map((taskRun) => ({
      ...taskRun,
      task: {
        ...taskRun.task,
        deps: [...taskRun.task.deps],
        allowedTools: [...taskRun.task.allowedTools],
        acceptance: [...taskRun.task.acceptance],
        scope: { ...taskRun.task.scope },
      },
      ...(taskRun.result
        ? {
            result: {
              ...taskRun.result,
              changedFiles: [...taskRun.result.changedFiles],
              evidence: taskRun.result.evidence.map((ref) => ({ ...ref })),
              risks: [...taskRun.result.risks],
              nextSteps: [...taskRun.result.nextSteps],
            },
          }
        : {}),
    })),
    claims: run.claims.map((claim) => ({ ...claim })),
    mergeGate: {
      ...run.mergeGate,
      requiredRoles: [...run.mergeGate.requiredRoles],
      satisfiedRoles: [...run.mergeGate.satisfiedRoles],
      missingRoles: [...run.mergeGate.missingRoles],
      evidence: run.mergeGate.evidence.map((ref) => ({ ...ref })),
    },
    blackboard: run.blackboard.map((entry) => ({
      ...entry,
      evidenceRefs: entry.evidenceRefs.map((ref) => ({ ...ref })),
    })),
    mailbox: run.mailbox.map((message) => ({
      ...message,
      evidenceRefs: message.evidenceRefs.map((ref) => ({ ...ref })),
    })),
  };
}
