import type {
  TeamBudget,
  TeamPlan,
  TeamPlanOptions,
  TeamScope,
  TeamTask,
  TeamWorkerRole,
  TeamWritePolicy,
} from "./types";

const DEFAULT_BUDGET: TeamBudget = {
  maxWorkers: 5,
  maxConcurrentWorkers: 2,
  maxToolCallsPerWorker: 12,
  maxDurationMsPerWorker: 5 * 60 * 1000,
  maxOutputBytesPerWorker: 24 * 1024,
  maxTotalDurationMs: 20 * 60 * 1000,
};

const ROLE_TOOLS: Record<TeamWorkerRole, string[]> = {
  explorer: ["read", "glob", "symbol", "definition", "references"],
  implementer: ["read", "replace", "append", "bash"],
  test_engineer: ["read", "glob", "bash"],
  reviewer: ["read", "glob", "symbol", "definition", "references"],
  writer: ["read", "append", "replace"],
};

const ROLE_WRITE_POLICY: Record<TeamWorkerRole, TeamWritePolicy> = {
  explorer: "read_only",
  implementer: "claimed_files_only",
  test_engineer: "approval_required",
  reviewer: "read_only",
  writer: "claimed_files_only",
};

export function buildTeamPlan(goal: string, options: TeamPlanOptions = {}): TeamPlan {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal) {
    throw new Error("Team goal is required");
  }

  const budget = buildBudget(options);
  const scope = inferScope(normalizedGoal);
  const oversized = looksOversized(normalizedGoal);
  const wantsWrite = looksLikeWriteTask(normalizedGoal);
  const wantsDocs = looksLikeDocsTask(normalizedGoal);
  const wantsTests = looksLikeTestTask(normalizedGoal);
  const wantsReview = looksLikeReviewTask(normalizedGoal);

  const tasks: TeamTask[] = [];
  const addTask = createTaskAdder(tasks, budget.maxWorkers, options.roleModels);

  if (oversized) {
    addTask({
      role: "explorer",
      objective:
        "Map the repository or requested scope into modules and risk areas. Do not read every file; produce staged batches for follow-up work.",
      scope: clampScope(scope, 40),
      deps: [],
      acceptance: [
        "List module groups and priority order.",
        "Identify at most 10 files for the next detailed pass.",
        "Do not claim that every file was reviewed.",
      ],
    });
    addTask({
      role: "reviewer",
      objective:
        "Review the explorer handoff for scope quality, hidden risks, and whether the next stage is bounded enough to run safely.",
      scope: { maxFiles: 10 },
      deps: ["team-task-1"],
      acceptance: [
        "Call out missing modules or over-broad follow-up tasks.",
        "Produce a concise next-stage recommendation with evidence references.",
      ],
    });
    addTask({
      role: "writer",
      objective:
        "Prepare a compact handoff summary for the user and the next session/stage.",
      scope: { maxFiles: 5 },
      deps: ["team-task-1", "team-task-2"],
      acceptance: [
        "Summarize completed scope, open risks, and next batch.",
        "Keep output under the worker output budget.",
      ],
    });
  } else {
    addTask({
      role: "explorer",
      objective:
        "Locate the relevant files, symbols, existing patterns, and constraints before any implementation work.",
      scope,
      deps: [],
      acceptance: [
        "Return concrete file or symbol candidates.",
        "Identify risks and required verification steps.",
      ],
    });

    if (wantsWrite || wantsDocs) {
      addTask({
        role: wantsDocs && !wantsWrite ? "writer" : "implementer",
        objective: wantsDocs && !wantsWrite
          ? "Draft the requested documentation changes within the scoped files."
          : "Implement the requested change only within claimed files.",
        scope: clampScope(scope, 12),
        deps: ["team-task-1"],
        acceptance: [
          "Touch only files named in scope or claimed after exploration.",
          "Return changed files and evidence for each change.",
        ],
      });
    }

    if (wantsTests || wantsWrite) {
      addTask({
        role: "test_engineer",
        objective:
          "Run or design focused verification for the scoped change and capture pass/fail evidence.",
        scope: clampScope(scope, 12),
        deps: tasks.some((task) => task.role === "implementer" || task.role === "writer")
          ? ["team-task-2"]
          : ["team-task-1"],
        acceptance: [
          "Run the smallest relevant checks when available.",
          "If tests cannot run, explain the exact blocker.",
        ],
      });
    }

    addTask({
      role: "reviewer",
      objective: wantsReview
        ? "Perform the requested review with file-level evidence and prioritized findings."
        : "Review the plan/results and verify that completion claims are backed by evidence.",
      scope: clampScope(scope, 12),
      deps: tasks.length > 1 ? [tasks[tasks.length - 1]!.id] : ["team-task-1"],
      acceptance: [
        "List findings or confirm no findings with residual risk.",
        "Do not approve completion without evidence references.",
      ],
    });
  }

  const warnings = buildWarnings(normalizedGoal, tasks, budget, oversized);

  return {
    id: "team-plan-local",
    userGoal: normalizedGoal,
    status: "planning",
    tasks,
    budget,
    mergeStrategy: tasks.some((task) => task.role === "test_engineer")
      ? "test-gated"
      : "reviewer-gated",
    ...(oversized
      ? { stagingReason: "goal looks whole-repo, every-file, or over-budget; generated staged read-only first pass" }
      : {}),
    warnings,
  };
}

export function formatTeamPlan(plan: TeamPlan): string {
  const lines = [
    "Agent Team Plan",
    `goal: ${plan.userGoal}`,
    `status: ${plan.status}`,
    `merge-strategy: ${plan.mergeStrategy}`,
    `budget: workers=${plan.budget.maxWorkers}, concurrent=${plan.budget.maxConcurrentWorkers}, tool-calls/worker=${plan.budget.maxToolCallsPerWorker}, output/worker=${formatBytes(plan.budget.maxOutputBytesPerWorker)}`,
    plan.stagingReason ? `staging: ${plan.stagingReason}` : "staging: none",
    plan.warnings.length > 0 ? `warnings: ${plan.warnings.join(" | ")}` : "warnings: none",
    `tasks: ${plan.tasks.length}`,
  ];

  for (const task of plan.tasks) {
    lines.push(
      "",
      `${task.id} [${task.role}]`,
      `objective: ${task.objective}`,
      `deps: ${task.deps.length > 0 ? task.deps.join(", ") : "none"}`,
      `model: ${task.model ?? "inherit-parent"}`,
      `write-policy: ${task.writePolicy}`,
      `allowed-tools: ${task.allowedTools.join(", ")}`,
      `scope: ${formatScope(task.scope)}`,
      `acceptance: ${task.acceptance.join(" | ")}`
    );
  }

  lines.push(
    "",
    "next: M1 is plan-only. Use this plan to confirm scope before running read-only workers."
  );

  return lines.join("\n");
}

function buildBudget(options: TeamPlanOptions): TeamBudget {
  const maxWorkers = clampInt(options.maxWorkers, 1, DEFAULT_BUDGET.maxWorkers, DEFAULT_BUDGET.maxWorkers);
  const maxConcurrentWorkers = clampInt(
    options.maxConcurrentWorkers,
    1,
    Math.min(maxWorkers, DEFAULT_BUDGET.maxConcurrentWorkers),
    Math.min(maxWorkers, DEFAULT_BUDGET.maxConcurrentWorkers)
  );
  return {
    ...DEFAULT_BUDGET,
    maxWorkers,
    maxConcurrentWorkers,
  };
}

function createTaskAdder(
  tasks: TeamTask[],
  maxWorkers: number,
  roleModels: TeamPlanOptions["roleModels"] = {}
) {
  return (input: Omit<TeamTask, "id" | "allowedTools" | "writePolicy">): void => {
    if (tasks.length >= maxWorkers) return;
    const model = input.model ?? roleModels[input.role]?.trim();
    const id = `team-task-${tasks.length + 1}`;
    tasks.push({
      id,
      ...input,
      ...(model ? { model } : {}),
      allowedTools: ROLE_TOOLS[input.role],
      writePolicy: ROLE_WRITE_POLICY[input.role],
    });
  };
}

function inferScope(goal: string): TeamScope {
  const files = unique(goal.match(/\b[\w./@()-]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|sql|css|html|csv)\b/g) ?? []);
  const directories = unique(
    (goal.match(/\b(?:src|test|tests|docs|packages|scripts|web-react|stubs|config|public)(?:\/[\w.-]+)*\/?/g) ?? [])
      .map((dir) => dir.replace(/\/$/, ""))
  );
  const symbols = unique(goal.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\(\)?/g) ?? [])
    .map((symbol) => symbol.replace(/\(\)$/, ""))
    .filter((symbol) => symbol.length > 2 && !symbol.includes(".md"));

  return {
    ...(files.length > 0 ? { files: files.slice(0, 20) } : {}),
    ...(directories.length > 0 ? { directories: directories.slice(0, 10) } : {}),
    ...(symbols.length > 0 ? { symbols: symbols.slice(0, 10) } : {}),
    maxFiles: files.length > 0 ? Math.min(files.length, 20) : 20,
  };
}

function clampScope(scope: TeamScope, maxFiles: number): TeamScope {
  return {
    ...(scope.files ? { files: scope.files.slice(0, maxFiles) } : {}),
    ...(scope.directories ? { directories: scope.directories } : {}),
    ...(scope.symbols ? { symbols: scope.symbols } : {}),
    maxFiles: Math.min(scope.maxFiles ?? maxFiles, maxFiles),
  };
}

function buildWarnings(goal: string, tasks: TeamTask[], budget: TeamBudget, oversized: boolean): string[] {
  const warnings: string[] = [];
  if (oversized) {
    warnings.push("oversized goal staged into bounded read-only first pass");
  }
  if (tasks.length >= budget.maxWorkers) {
    warnings.push("task count reached maxWorkers; later phases should be planned separately");
  }
  if (looksLikeWriteTask(goal) && !tasks.some((task) => task.role === "implementer" || task.role === "writer")) {
    warnings.push("write intent detected but current budget did not include a write worker");
  }
  return warnings;
}

function looksOversized(goal: string): boolean {
  return /全仓|整个仓库|整个项目|全部源码|所有源码|所有文件|每一个文件|逐文件|完整阅读|详细阅读.*所有|全量扫描|完整扫描|全面审查|深度审查.*全/i.test(goal) ||
    /\b(entire|whole|full)\s+(repo|repository|codebase|project)\b/i.test(goal) ||
    /\b(all|every)\s+(source\s+)?files?\b/i.test(goal) ||
    /\bread\s+every\s+file\b/i.test(goal);
}

function looksLikeWriteTask(goal: string): boolean {
  return /开发|实现|修复|修改|新增|接入|重构|优化|补全|改造|写代码|implement|fix|add|modify|refactor|optimi[sz]e/i.test(goal);
}

function looksLikeDocsTask(goal: string): boolean {
  return /文档|设计|说明|计划|报告|README|docs?|design|document|plan/i.test(goal);
}

function looksLikeTestTask(goal: string): boolean {
  return /测试|验证|编译|typecheck|build|test|smoke|verify|ci/i.test(goal);
}

function looksLikeReviewTask(goal: string): boolean {
  return /审查|检查|找.*bug|bug.*分析|review|audit|inspect/i.test(goal);
}

function formatScope(scope: TeamScope): string {
  const parts: string[] = [];
  if (scope.files?.length) parts.push(`files=${scope.files.join(",")}`);
  if (scope.directories?.length) parts.push(`dirs=${scope.directories.join(",")}`);
  if (scope.symbols?.length) parts.push(`symbols=${scope.symbols.join(",")}`);
  parts.push(`maxFiles=${scope.maxFiles ?? 20}`);
  return parts.join(" ");
}

function formatBytes(value: number): string {
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value as number);
  return Math.max(min, Math.min(max, n));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
