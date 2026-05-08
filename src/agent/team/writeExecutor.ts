import { buildToolErrorResult } from "../../tools/types";
import { runLocalTool, type LocalToolResult } from "../../tools/local";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  enforceClaimedFileWrite,
  parseTeamWritePrompt,
  type TeamWriteGuardInput,
  type TeamWriteToolName,
} from "./writeGuard";

export type TeamWriteExecutionInput = TeamWriteGuardInput;

export async function executeClaimedFileWrite(input: TeamWriteExecutionInput): Promise<LocalToolResult> {
  const guard = enforceClaimedFileWrite(input);
  if (!guard.ok) {
    return buildToolErrorResult(
      guard.toolName ?? "write",
      "blocked",
      "permission_denied",
      "Team write blocked",
      guard.reason
    );
  }

  return runLocalTool(input.prompt, input.workspace);
}

export interface TeamWritePreview {
  ok: boolean;
  toolName?: TeamWriteToolName;
  target?: string;
  claimId?: string;
  summary: string;
  detail: string;
  beforeSnippet?: string;
  afterSnippet?: string;
}

export async function previewClaimedFileWrite(input: TeamWriteExecutionInput): Promise<TeamWritePreview> {
  const guard = enforceClaimedFileWrite(input);
  if (!guard.ok) {
    return {
      ok: false,
      toolName: guard.toolName,
      target: guard.target,
      summary: "Team write preview blocked",
      detail: guard.reason,
    };
  }

  const parsed = parseTeamWritePrompt(input.prompt);
  if (!parsed) {
    return {
      ok: false,
      summary: "Team write preview blocked",
      detail: "write worker may only preview /write, /append, or /replace local tools",
    };
  }

  const absoluteTarget = path.resolve(input.workspace, guard.target);
  const content = await readOptionalTextFile(absoluteTarget);
  const preview = buildPreview(parsed.toolName, parsed.args, content);
  return {
    ok: true,
    toolName: guard.toolName,
    target: guard.target,
    claimId: guard.claimId,
    ...preview,
  };
}

async function readOptionalTextFile(absoluteTarget: string): Promise<string> {
  try {
    return await readFile(absoluteTarget, "utf8");
  } catch {
    return "";
  }
}

function buildPreview(
  toolName: TeamWriteToolName,
  args: string[],
  current: string
): Pick<TeamWritePreview, "summary" | "detail" | "beforeSnippet" | "afterSnippet"> {
  if (toolName === "replace") {
    const findText = args[0] ?? "";
    const replaceText = args.slice(1).join(" :: ");
    if (!findText) {
      return {
        summary: "Replace preview failed",
        detail: "<find> cannot be empty",
      };
    }
    const index = current.indexOf(findText);
    if (index < 0) {
      return {
        summary: "Replace preview failed",
        detail: "target text not found",
      };
    }
    const before = snippetAround(current, index, findText.length);
    const afterContent = current.slice(0, index) + replaceText + current.slice(index + findText.length);
    const after = snippetAround(afterContent, index, replaceText.length);
    return {
      summary: "Preview replace first match",
      detail: `Will replace first match (${findText.length} chars -> ${replaceText.length} chars).`,
      beforeSnippet: before,
      afterSnippet: after,
    };
  }

  const content = args.join(" :: ");
  if (toolName === "append") {
    return {
      summary: "Preview append",
      detail: `Will append ${content.length} chars to the claimed file.`,
      beforeSnippet: tailSnippet(current),
      afterSnippet: tailSnippet(`${current}${content}`),
    };
  }

  return {
    summary: "Preview overwrite",
    detail: `Will overwrite the claimed file with ${content.length} chars.`,
    beforeSnippet: headSnippet(current),
    afterSnippet: headSnippet(content),
  };
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + length + 80);
  return text.slice(start, end);
}

function headSnippet(text: string): string {
  return text.slice(0, 240);
}

function tailSnippet(text: string): string {
  return text.slice(Math.max(0, text.length - 240));
}
