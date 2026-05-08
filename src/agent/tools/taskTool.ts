/**
 * Task tool · 父 agent 派生 subagent 的 native tool（M3-02 step c）
 *
 * LLM 输入：{ role: "<one-of-builtin>", prompt: "<task description>" }
 * 调用：runSubagent → 返回子 agent 最终 text 给父 turn 当 tool result
 *
 * 防递归：runner 内部已 unregister 子 engine 的 Task tool；本工具仅注册到父 engine。
 *
 * Permission：Task 不走 evaluate gate（子 engine 内部各 tool 仍受 role.permissionMode
 * 与父 PermissionManager 拦截）；父 LLM 调 Task 不需额外审批。
 */

import { BUILTIN_ROLES, listRoleNames } from "../subagents/roles";
import { runSubagent, type RunSubagentDeps } from "../subagents/runner";
import type { SubagentRegistry } from "../subagents/registry";
import type { ToolDefinition, ToolRegistry } from "./registry";

export interface RegisterTaskToolDeps extends RunSubagentDeps {
  /** 工具描述前缀；默认列出所有 builtin role */
  descriptionPrefix?: string;
  /** B.8：父 engine 的 SubagentRegistry；不传则不追踪 */
  subagentRegistry?: SubagentRegistry;
}

export function registerTaskTool(registry: ToolRegistry, deps: RegisterTaskToolDeps): void {
  if (registry.has("Task")) return; // 重入注册无害
  registry.register(buildTaskToolDefinition(deps));
}

function buildTaskToolDefinition(deps: RegisterTaskToolDeps): ToolDefinition {
  const roleSummary = Object.values(BUILTIN_ROLES)
    .map((r) => `${r.name}: ${r.description}`)
    .join("\n");
  const description =
    (deps.descriptionPrefix ??
      "Spawn a subagent to handle a focused task with isolated tool access. ") +
    "Do not use one Task for whole-repo, every-file, exhaustive, or over-budget work; split it into staged, bounded phases first. " +
    "\nAvailable roles:\n" +
    roleSummary;

  return {
    name: "Task",
    description,
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: listRoleNames(),
          description: "Which builtin subagent role to spawn",
        },
        prompt: {
          type: "string",
          description: "What the subagent should do; be specific and self-contained",
        },
        model: {
          type: "string",
          description: "Optional model override for this subagent. Uses the current provider with a different model id.",
        },
      },
      required: ["role", "prompt"],
      additionalProperties: false,
    },
    async invoke(args, ctx) {
      const { role, prompt, model } = parseArgs(args);
      if (!role) {
        return {
          ok: false,
          content: "[Task] missing or invalid 'role'; choose one of: " + listRoleNames().join(", "),
          isError: true,
          errorCode: "invalid_args",
        };
      }
      if (!prompt) {
        return {
          ok: false,
          content: "[Task] missing or empty 'prompt'",
          isError: true,
          errorCode: "invalid_args",
        };
      }
      const staging = shouldStageOversizedTaskPrompt(prompt) ? buildStagedTaskGuardMessage() : null;
      if (staging) {
        return {
          ok: false,
          content: staging,
          isError: true,
          errorCode: "task_needs_staging",
        };
      }

      const rec = deps.subagentRegistry?.start({ role, prompt });
      // C2: 父 abortSignal 透传到子 runner，父 Ctrl-C 时子 engine 立即停
      const result = await runSubagent(
        { role, prompt, ...(model ? { model } : {}) },
        { ...deps, ...(ctx.abortSignal ? { abortSignal: ctx.abortSignal } : {}) }
      );
      if (rec) {
        deps.subagentRegistry?.finish(rec.id, {
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
          toolCallCount: result.toolCallCount,
          durationMs: result.durationMs,
          resultText: result.finalText,
        });
      }
      const header = `[Task ${role}] ${result.toolCallCount} tool call(s), ${result.durationMs}ms`;
      const body = result.error ? `error: ${result.error}\n\n${result.finalText}` : result.finalText;
      return {
        ok: result.ok,
        content: `${header}\n\n${body}`,
        ...(result.ok ? {} : { isError: true, errorCode: "subagent_failed" }),
      };
    },
  };
}

export function buildStagedTaskGuardMessage(): string {
  return [
    "[Task] task_needs_staging",
    "This request looks like a whole-repo / every-file / over-budget task. CodeClaw blocked spawning one giant subagent so the final summary does not become empty or destabilize the session.",
    "",
    "请自动拆成阶段执行，每个阶段单独完成并产出可继续的摘要：",
    "1. 阶段 1：只做目录/文件清单扫描，输出模块分组和优先级，不读取每个文件全文。",
    "2. 阶段 2：选择一个模块或最多 10 个相关文件，读取并总结风险。",
    "3. 阶段 3：按模块继续下一批文件，复用上一阶段摘要，不重复展开旧输出。",
    "4. 阶段 4：汇总已验证发现、剩余风险、下一批建议。",
    "",
    "下一步建议：请先执行阶段 1，或重新调用 Task 时明确 `阶段/批次/目录/文件上限`。",
  ].join("\n");
}

export function shouldStageOversizedTaskPrompt(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return looksLikeOversizedTask(normalized) && !looksAlreadyStaged(normalized);
}

function looksLikeOversizedTask(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  const oversizedPatterns = [
    /超预算|上下文.*超|打满|撑爆|空转/,
    /全仓|整个仓库|整个项目|全部源码|所有源码|所有文件|每一个文件|逐文件|完整阅读|详细阅读.*所有/,
    /全量扫描|完整扫描|全面审查|深度审查.*全/,
    /\b(entire|whole|full)\s+(repo|repository|codebase|project)\b/,
    /\b(all|every)\s+(source\s+)?files?\b/,
    /\bread\s+every\s+file\b/,
    /\bscan\s+(the\s+)?(entire|whole|full)\b/,
    /\bexhaustive\b/,
  ];
  if (oversizedPatterns.some((pattern) => pattern.test(lower))) return true;

  const fileLikeMentions = (prompt.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|sql|css|html)\b/g) ?? []).length;
  return prompt.length > 1800 && fileLikeMentions >= 8;
}

function looksAlreadyStaged(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /阶段|分阶段|批次|第\s*\d+\s*阶段|只读|最多\s*\d+|不超过\s*\d+|module|batch|phase|stage|first pass|scope:|limit:/i.test(lower);
}

function parseArgs(args: unknown): { role?: string; prompt?: string; model?: string } {
  if (!args || typeof args !== "object") return {};
  const a = args as Record<string, unknown>;
  return {
    role: typeof a.role === "string" ? a.role : undefined,
    prompt: typeof a.prompt === "string" ? a.prompt : undefined,
    model: typeof a.model === "string" && a.model.trim() ? a.model.trim() : undefined,
  };
}
