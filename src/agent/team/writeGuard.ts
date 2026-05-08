import path from "node:path";

import type { TeamClaim, TeamTask } from "./types";

export type TeamWriteToolName = "write" | "append" | "replace";

export interface TeamWriteGuardInput {
  task: TeamTask;
  claims: TeamClaim[];
  prompt: string;
  workspace: string;
}

export interface ParsedTeamWritePrompt {
  toolName: TeamWriteToolName;
  target: string;
  args: string[];
}

export type TeamWriteGuardResult =
  | {
      ok: true;
      toolName: TeamWriteToolName;
      target: string;
      claimId: string;
    }
  | {
      ok: false;
      reason: string;
      toolName?: TeamWriteToolName;
      target?: string;
    };

export function enforceClaimedFileWrite(input: TeamWriteGuardInput): TeamWriteGuardResult {
  if (input.task.writePolicy !== "claimed_files_only") {
    return { ok: false, reason: `task ${input.task.id} is not a claimed-file write task` };
  }

  const parsed = parseWritePrompt(input.prompt);
  if (!parsed) {
    return { ok: false, reason: "write worker may only execute /write, /append, or /replace local tools" };
  }

  const target = normalizeWorkspaceRelativePath(input.workspace, parsed.target);
  if (!target) {
    return {
      ok: false,
      toolName: parsed.toolName,
      target: parsed.target,
      reason: `target is outside workspace or invalid: ${parsed.target}`,
    };
  }

  const claim = input.claims.find(
    (item) =>
      item.taskId === input.task.id &&
      item.mode === "write" &&
      item.status === "active" &&
      normalizeWorkspaceRelativePath(input.workspace, item.path) === target
  );

  if (!claim) {
    return {
      ok: false,
      toolName: parsed.toolName,
      target,
      reason: `write target is not actively claimed by ${input.task.id}: ${target}`,
    };
  }

  return {
    ok: true,
    toolName: parsed.toolName,
    target,
    claimId: claim.id,
  };
}

export function parseTeamWritePrompt(prompt: string): ParsedTeamWritePrompt | null {
  if (prompt.startsWith("/write")) {
    const parts = parseDoubleColonParts(prompt.slice("/write".length).trim(), 2);
    return parts ? { toolName: "write", target: parts[0] ?? "", args: parts.slice(1) } : null;
  }
  if (prompt.startsWith("/append")) {
    const parts = parseDoubleColonParts(prompt.slice("/append".length).trim(), 2);
    return parts ? { toolName: "append", target: parts[0] ?? "", args: parts.slice(1) } : null;
  }
  if (prompt.startsWith("/replace")) {
    const parts = parseDoubleColonParts(prompt.slice("/replace".length).trim(), 3);
    return parts ? { toolName: "replace", target: parts[0] ?? "", args: parts.slice(1) } : null;
  }
  return null;
}

function parseDoubleColonParts(input: string, count: number): string[] | null {
  const parts = input.split("::").map((part) => part.trim());
  return parts.length >= count ? parts : null;
}

function normalizeWorkspaceRelativePath(workspace: string, target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  const workspaceRoot = path.resolve(workspace);
  const absoluteTarget = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceRoot, trimmed);
  if (absoluteTarget !== workspaceRoot && !absoluteTarget.startsWith(`${workspaceRoot}${path.sep}`)) {
    return null;
  }
  return path.relative(workspaceRoot, absoluteTarget).replace(/\\/g, "/");
}

const parseWritePrompt = parseTeamWritePrompt;
