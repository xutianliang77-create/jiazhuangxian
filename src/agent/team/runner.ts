import { TeamBlackboard } from "./blackboard";
import { buildTeamPlan } from "./coordinator";
import { TeamClaimRegistry } from "./claims";
import { evaluateTeamMergeGate } from "./mergeGate";
import { TeamMailbox } from "./mailbox";
import type {
  BlackboardEntry,
  TeamClaim,
  TeamMergeGateResult,
  TeamMailboxMessage,
  TeamPlan,
  TeamRun,
  TeamTask,
  TeamTaskRun,
  WorkerResult,
} from "./types";

export interface RunReadOnlyTeamOptions {
  sessionId?: string;
  now?: () => number;
}

export interface RunReadOnlyTeamWithWorkersOptions extends RunReadOnlyTeamOptions {
  runWorker?: (task: TeamTask, prompt: string) => Promise<WorkerResult>;
}

export function runReadOnlyTeamPlan(
  plan: TeamPlan,
  options: RunReadOnlyTeamOptions = {}
): TeamRun {
  return runReadOnlyTeamPlanInternal(plan, options);
}

export async function runReadOnlyTeamPlanWithWorkers(
  plan: TeamPlan,
  options: RunReadOnlyTeamWithWorkersOptions = {}
): Promise<TeamRun> {
  return runReadOnlyTeamPlanAsync(plan, options);
}

function runReadOnlyTeamPlanInternal(
  plan: TeamPlan,
  options: RunReadOnlyTeamOptions
): TeamRun {
  const now = options.now ?? Date.now;
  const createdAt = now();
  const runId = `team-run-${createdAt.toString(36)}`;
  const blackboard = new TeamBlackboard();
  const claimRegistry = new TeamClaimRegistry();
  const claims: TeamClaim[] = [];
  const mailbox = new TeamMailbox();
  const taskRuns: TeamTaskRun[] = plan.tasks.map((task) => ({ task, status: "pending" }));
  const completed = new Set<string>();

  for (const taskRun of taskRuns) {
    const unmetDeps = taskRun.task.deps.filter((dep) => !completed.has(dep));
    if (unmetDeps.length > 0) {
      taskRun.status = "blocked";
      taskRun.blockedReason = `unmet deps: ${unmetDeps.join(", ")}`;
      taskRun.completedAt = now();
      continue;
    }

    taskRun.startedAt = now();
    if (taskRun.task.writePolicy !== "read_only") {
      blockNonReadOnlyTask(taskRun, runId, blackboard, claimRegistry, claims, now);
      continue;
    }

    const result = runLocalReadOnlyWorker(taskRun.task, blackboard.list());
    taskRun.result = result;
    taskRun.status = result.status;
    taskRun.completedAt = now();
    if (result.status === "completed") {
      completed.add(taskRun.task.id);
      const entry = blackboard.add({
        taskId: taskRun.task.id,
        kind: taskRun.task.role === "reviewer" ? "decision" : "fact",
        summary: result.summary,
        evidenceRefs: result.evidence,
      });
      writeHandoff(mailbox, runId, taskRun.task, plan.tasks, result, entry);
    }
  }

  const finalBlackboard = blackboard.list();
  const finalMailbox = mailbox.list();
  const mergeGate = evaluateTeamMergeGate(plan, taskRuns);
  const status = deriveTeamRunStatus(taskRuns, claims, mergeGate);

  return {
    id: runId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    userGoal: plan.userGoal,
    status,
    plan,
    taskRuns,
    claims,
    mergeGate,
    blackboard: finalBlackboard,
    mailbox: finalMailbox,
    summary: buildLocalTeamSummary(status, taskRuns, finalBlackboard, mergeGate),
    createdAt,
    updatedAt: now(),
  };
}

export async function runReadOnlyTeamPlanAsync(
  plan: TeamPlan,
  options: RunReadOnlyTeamWithWorkersOptions = {}
): Promise<TeamRun> {
  const now = options.now ?? Date.now;
  const createdAt = now();
  const runId = `team-run-${createdAt.toString(36)}`;
  const blackboard = new TeamBlackboard();
  const claimRegistry = new TeamClaimRegistry();
  const claims: TeamClaim[] = [];
  const mailbox = new TeamMailbox();
  const taskRuns: TeamTaskRun[] = plan.tasks.map((task) => ({ task, status: "pending" }));
  const completed = new Set<string>();

  for (const taskRun of taskRuns) {
    const unmetDeps = taskRun.task.deps.filter((dep) => !completed.has(dep));
    if (unmetDeps.length > 0) {
      taskRun.status = "blocked";
      taskRun.blockedReason = `unmet deps: ${unmetDeps.join(", ")}`;
      taskRun.completedAt = now();
      continue;
    }

    taskRun.startedAt = now();
    if (taskRun.task.writePolicy !== "read_only") {
      blockNonReadOnlyTask(taskRun, runId, blackboard, claimRegistry, claims, now);
      continue;
    }

    const result = options.runWorker
      ? await options.runWorker(taskRun.task, buildReadOnlyWorkerPrompt(taskRun.task, blackboard.list()))
      : runLocalReadOnlyWorker(taskRun.task, blackboard.list());

    taskRun.result = result;
    taskRun.status = result.status;
    taskRun.completedAt = now();
    if (result.status === "completed") {
      completed.add(taskRun.task.id);
      const entry = blackboard.add({
        taskId: taskRun.task.id,
        kind: taskRun.task.role === "reviewer" ? "decision" : "fact",
        summary: result.summary,
        evidenceRefs: result.evidence,
      });
      writeHandoff(mailbox, runId, taskRun.task, plan.tasks, result, entry);
    } else {
      blackboard.add({
        taskId: taskRun.task.id,
        kind: "risk",
        summary: `${taskRun.task.role} ${result.status}: ${result.summary}`,
        evidenceRefs: result.evidence,
      });
    }
  }

  const finalBlackboard = blackboard.list();
  const finalMailbox = mailbox.list();
  const mergeGate = evaluateTeamMergeGate(plan, taskRuns);
  const status = deriveTeamRunStatus(taskRuns, claims, mergeGate);

  return {
    id: runId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    userGoal: plan.userGoal,
    status,
    plan,
    taskRuns,
    claims,
    mergeGate,
    blackboard: finalBlackboard,
    mailbox: finalMailbox,
    summary: buildLocalTeamSummary(status, taskRuns, finalBlackboard, mergeGate),
    createdAt,
    updatedAt: now(),
  };
}

export function runReadOnlyTeam(goal: string, options: RunReadOnlyTeamOptions = {}): TeamRun {
  return runReadOnlyTeamPlan(buildTeamPlan(goal), options);
}

export function formatTeamRun(run: TeamRun): string {
  const lines = [
    "Agent Team Run",
    `id: ${run.id}`,
    `goal: ${run.userGoal}`,
    `status: ${run.status}`,
    `tasks: ${run.taskRuns.length}`,
    `blackboard: ${run.blackboard.length}`,
    `mailbox: ${run.mailbox.length}`,
    `merge-gate: ${run.mergeGate.status} (${run.mergeGate.strategy})`,
    `merge-required: ${run.mergeGate.requiredRoles.length > 0 ? run.mergeGate.requiredRoles.join(", ") : "none"}`,
    run.mergeGate.missingRoles.length > 0 ? `merge-missing: ${run.mergeGate.missingRoles.join(", ")}` : "merge-missing: none",
    "",
    "Task results:",
  ];

  for (const taskRun of run.taskRuns) {
    lines.push(
      `- ${taskRun.task.id} [${taskRun.task.role}] ${taskRun.status}` +
        (taskRun.blockedReason ? ` - ${taskRun.blockedReason}` : "")
    );
    if (taskRun.result) {
      lines.push(`  summary: ${taskRun.result.summary}`);
      if (taskRun.result.nextSteps.length > 0) {
        lines.push(`  next: ${taskRun.result.nextSteps.join(" | ")}`);
      }
    }
  }

  if (run.claims.length > 0) {
    lines.push("", "Claims:");
    for (const claim of run.claims) {
      lines.push(
        `- ${claim.id} [${claim.mode}] ${claim.status} ${claim.path}` +
          (claim.reason ? ` - ${claim.reason}` : "")
      );
    }
  }

  lines.push("", "Blackboard:");
  for (const entry of run.blackboard.slice(-8)) {
    lines.push(`- ${entry.kind} ${entry.taskId}: ${entry.summary}`);
  }

  lines.push("", "Local fallback summary:", run.summary);
  return lines.join("\n");
}

function runLocalReadOnlyWorker(task: TeamTask, entries: BlackboardEntry[]): WorkerResult {
  if (task.role === "reviewer") {
    const previousFacts = entries.filter((entry) => entry.kind === "fact" || entry.kind === "risk");
    return {
      taskId: task.id,
      role: task.role,
      status: "completed",
      summary:
        previousFacts.length > 0
          ? `Reviewed ${previousFacts.length} blackboard entries; completion remains evidence-gated.`
          : "Reviewed the plan; no prior blackboard facts were available yet.",
      changedFiles: [],
      evidence: previousFacts.slice(0, 5).map((entry) => ({
        type: "blackboard",
        id: entry.id,
        status: entry.kind === "risk" ? "blocked" : "passed",
      })),
      risks: previousFacts.some((entry) => entry.kind === "risk")
        ? ["Some team tasks remain blocked or need a later stage."]
        : [],
      nextSteps: ["Proceed only with bounded follow-up tasks that reference blackboard evidence."],
    };
  }

  return {
    taskId: task.id,
    role: task.role,
    status: "completed",
    summary: buildExplorerSummary(task),
    changedFiles: [],
    evidence: buildScopeEvidence(task),
    risks: task.scope.maxFiles && task.scope.maxFiles > 20
      ? ["Scope is broad; continue in batches rather than reading every file."]
      : [],
    nextSteps: [
      "Use this scoped handoff before launching any write worker.",
      "Keep later workers within claimed files and output budgets.",
    ],
  };
}

function blockNonReadOnlyTask(
  taskRun: TeamTaskRun,
  runId: string,
  blackboard: TeamBlackboard,
  claimRegistry: TeamClaimRegistry,
  claims: TeamClaim[],
  now: () => number
): void {
  if (taskRun.task.writePolicy === "claimed_files_only") {
    const result = claimRegistry.claimWriteTask(runId, taskRun.task, now);
    claims.push(...result.claims);
    taskRun.status = "blocked";
    taskRun.blockedReason = result.blockedReason;
    taskRun.completedAt = now();
    blackboard.add({
      taskId: taskRun.task.id,
      kind: "risk",
      summary: `${taskRun.task.role} blocked: ${result.blockedReason}`,
      evidenceRefs:
        result.claims.length > 0
          ? result.claims.map((claim) => ({ type: "file" as const, path: claim.path, status: "blocked" as const }))
          : [{ type: "blackboard", id: taskRun.task.id, status: "blocked" }],
    });
    return;
  }

  const reason = "approval-required worker pending parent approval integration";
  taskRun.status = "blocked";
  taskRun.blockedReason = reason;
  taskRun.completedAt = now();
  blackboard.add({
    taskId: taskRun.task.id,
    kind: "risk",
    summary: `${taskRun.task.role} blocked: ${reason}`,
    evidenceRefs: [{ type: "approval", id: taskRun.task.id, status: "blocked" }],
  });
}

export function buildReadOnlyWorkerPrompt(task: TeamTask, entries: BlackboardEntry[]): string {
  return [
    `Agent Team task: ${task.id}`,
    `Role: ${task.role}`,
    `Model: ${task.model ?? "inherit-parent"}`,
    `Objective: ${task.objective}`,
    `Scope: ${formatScopeForPrompt(task)}`,
    `Acceptance: ${task.acceptance.join(" | ")}`,
    "",
    "Rules:",
    "- Read-only only. Do not write, modify, delete, install, commit, or run broad commands.",
    "- Return a concise summary with evidence references.",
    "- Keep the answer bounded; do not expand unrelated files.",
    "",
    entries.length > 0
      ? `Existing blackboard:\n${entries.map((entry) => `- ${entry.kind} ${entry.taskId}: ${entry.summary}`).join("\n")}`
      : "Existing blackboard: none",
  ].join("\n");
}

function buildExplorerSummary(task: TeamTask): string {
  const files = task.scope.files?.length ?? 0;
  const dirs = task.scope.directories?.length ?? 0;
  const symbols = task.scope.symbols?.length ?? 0;
  return `Mapped read-only scope for ${task.id}: files=${files}, dirs=${dirs}, symbols=${symbols}, maxFiles=${task.scope.maxFiles ?? 20}.`;
}

function formatScopeForPrompt(task: TeamTask): string {
  const parts = [
    task.scope.files?.length ? `files=${task.scope.files.join(",")}` : "",
    task.scope.directories?.length ? `directories=${task.scope.directories.join(",")}` : "",
    task.scope.symbols?.length ? `symbols=${task.scope.symbols.join(",")}` : "",
    `maxFiles=${task.scope.maxFiles ?? 20}`,
  ].filter(Boolean);
  return parts.join(" ");
}

function buildScopeEvidence(task: TeamTask): WorkerResult["evidence"] {
  const refs = [
    ...(task.scope.files ?? []).slice(0, 5).map((path) => ({ type: "file" as const, path, status: "passed" as const })),
    ...(task.scope.directories ?? []).slice(0, 5).map((path) => ({ type: "file" as const, path, status: "passed" as const })),
  ];
  if (refs.length > 0) return refs;
  return [{ type: "blackboard", id: task.id, status: "passed" }];
}

function writeHandoff(
  mailbox: TeamMailbox,
  runId: string,
  task: TeamTask,
  allTasks: TeamTask[],
  result: WorkerResult,
  entry: BlackboardEntry
): TeamMailboxMessage | null {
  const nextTask = allTasks.find((candidate) => candidate.deps.includes(task.id));
  if (!nextTask) return null;
  return mailbox.write({
    teamRunId: runId,
    fromTaskId: task.id,
    toTaskId: nextTask.id,
    kind: "handoff",
    summary: result.summary,
    text: `${result.summary}\nNext steps: ${result.nextSteps.join("; ")}`,
    evidenceRefs: [{ type: "blackboard", id: entry.id, status: "passed" }],
  });
}

function buildLocalTeamSummary(
  status: TeamRun["status"],
  taskRuns: TeamTaskRun[],
  entries: BlackboardEntry[],
  mergeGate: TeamMergeGateResult
): string {
  const completed = taskRuns.filter((taskRun) => taskRun.status === "completed").length;
  const blocked = taskRuns.filter((taskRun) => taskRun.status === "blocked").length;
  const risks = entries.filter((entry) => entry.kind === "risk").map((entry) => entry.summary);
  return [
    `Team run ${status}: completed=${completed}, blocked=${blocked}, evidence=${entries.length}.`,
    mergeGate.summary,
    risks.length > 0 ? `Open risks: ${risks.join(" | ")}` : "Open risks: none.",
    "This summary is generated locally from TeamRun/Blackboard state and does not require another provider call.",
  ].join(" ");
}

function deriveTeamRunStatus(
  taskRuns: TeamTaskRun[],
  claims: TeamClaim[],
  mergeGate: TeamMergeGateResult
): TeamRun["status"] {
  if (taskRuns.some((taskRun) => taskRun.status === "failed")) return "failed";
  if (claims.some((claim) => claim.status === "pending_approval")) return "waiting_approval";
  if (taskRuns.some((taskRun) => taskRun.status === "blocked")) return "blocked";
  if (mergeGate.status !== "passed") return "blocked";
  return "completed";
}
