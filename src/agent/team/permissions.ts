import type { TeamTask, TeamWorkerRole } from "./types";

const READ_ONLY_TOOLS = new Set(["read", "glob", "symbol", "definition", "references"]);

const READ_ONLY_ROLE_TO_SUBAGENT: Partial<Record<TeamWorkerRole, string>> = {
  explorer: "Explore",
  reviewer: "code-reviewer",
};

export function subagentRoleForReadOnlyTask(task: TeamTask): string | null {
  if (task.writePolicy !== "read_only") return null;
  return READ_ONLY_ROLE_TO_SUBAGENT[task.role] ?? null;
}

export function validateReadOnlyTeamTask(task: TeamTask): { ok: true } | { ok: false; reason: string } {
  const role = subagentRoleForReadOnlyTask(task);
  if (!role) {
    return { ok: false, reason: `role ${task.role} is not executable by the read-only Team runner` };
  }
  const disallowed = task.allowedTools.filter((tool) => !READ_ONLY_TOOLS.has(tool));
  if (disallowed.length > 0) {
    return { ok: false, reason: `read-only Team task has disallowed tools: ${disallowed.join(", ")}` };
  }
  return { ok: true };
}
