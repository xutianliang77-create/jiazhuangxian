import { describe, expect, it } from "vitest";
import {
  buildTeamPlan,
  formatTeamRun,
  InMemoryTeamRunStore,
  runReadOnlyTeamPlan,
  runReadOnlyTeamPlanAsync,
} from "../../../../src/agent/team";

describe("Agent Team M2 read-only runner", () => {
  it("runs read-only explorer/reviewer tasks and writes blackboard plus mailbox", () => {
    const plan = buildTeamPlan("审查 src/agent/queryEngine.ts 的 session 恢复逻辑");
    const run = runReadOnlyTeamPlan(plan, { now: () => 1000, sessionId: "session-test" });

    expect(run.status).toBe("completed");
    expect(run.sessionId).toBe("session-test");
    expect(run.taskRuns.map((taskRun) => taskRun.status)).toEqual(["completed", "completed"]);
    expect(run.mergeGate.status).toBe("passed");
    expect(run.mergeGate.satisfiedRoles).toContain("reviewer");
    expect(run.blackboard.length).toBeGreaterThanOrEqual(2);
    expect(run.mailbox.length).toBe(1);
    expect(run.summary).toContain("generated locally");
  });

  it("blocks write workers in M2 without blocking completed read-only evidence", () => {
    const plan = buildTeamPlan("修复 src/agent/queryEngine.ts 的 session 恢复 bug，并补测试验证");
    const run = runReadOnlyTeamPlan(plan, { now: () => 2000 });

    expect(run.status).toBe("waiting_approval");
    expect(run.mergeGate.status).toBe("blocked");
    expect(run.mergeGate.missingRoles).toContain("test_engineer");
    expect(run.taskRuns[0]?.status).toBe("completed");
    expect(run.taskRuns[1]?.status).toBe("blocked");
    expect(run.taskRuns[1]?.blockedReason).toContain("pending approval");
    expect(run.claims.some((claim) => claim.path === "src/agent/queryEngine.ts")).toBe(true);
    expect(run.blackboard.some((entry) => entry.kind === "risk")).toBe(true);
    expect(formatTeamRun(run)).toContain("Claims:");
    expect(formatTeamRun(run)).toContain("Local fallback summary");
  });

  it("stores and retrieves TeamRun snapshots in memory", () => {
    const store = new InMemoryTeamRunStore();
    const run = runReadOnlyTeamPlan(buildTeamPlan("审查 docs/AGENT_TEAM_TECH_DESIGN.md"), {
      now: () => 3000,
    });
    store.save(run);

    expect(store.latest()?.id).toBe(run.id);
    expect(store.get(run.id)?.summary).toBe(run.summary);
    expect(store.list()).toHaveLength(1);
  });

  it("can run injected read-only workers and record their evidence", async () => {
    const plan = buildTeamPlan("审查 src/agent/queryEngine.ts 的 Team flow");
    const workerCalls: string[] = [];
    const run = await runReadOnlyTeamPlanAsync(plan, {
      now: () => 4000,
      async runWorker(task, prompt) {
        workerCalls.push(`${task.id}:${prompt}`);
        return {
          taskId: task.id,
          role: task.role,
          status: "completed",
          summary: `worker completed ${task.id}`,
          changedFiles: [],
          evidence: [{ type: "tool", id: `Task:${task.role}`, status: "passed" }],
          risks: [],
          nextSteps: ["continue with bounded handoff"],
        };
      },
    });

    expect(run.status).toBe("completed");
    expect(run.mergeGate.status).toBe("passed");
    expect(workerCalls).toHaveLength(2);
    expect(workerCalls[0]).toContain("Existing blackboard: none");
    expect(workerCalls[1]).toContain("worker completed team-task-1");
    expect(run.blackboard.map((entry) => entry.summary)).toContain("worker completed team-task-2");
    expect(run.mailbox).toHaveLength(1);
  });

  it("blocks completion when reviewer evidence is missing", async () => {
    const run = await runReadOnlyTeamPlanAsync(buildTeamPlan("审查 src/agent/queryEngine.ts"), {
      now: () => 4500,
      async runWorker(task) {
        return {
          taskId: task.id,
          role: task.role,
          status: "completed",
          summary: `worker completed ${task.id}`,
          changedFiles: [],
          evidence: task.role === "reviewer"
            ? []
            : [{ type: "tool", id: `Task:${task.role}`, status: "passed" }],
          risks: [],
          nextSteps: ["continue with bounded handoff"],
        };
      },
    });

    expect(run.status).toBe("blocked");
    expect(run.mergeGate).toMatchObject({
      status: "blocked",
      missingRoles: ["reviewer"],
    });
    expect(run.summary).toContain("Merge gate blocked");
  });

  it("records injected worker failures as risks and blocks dependent tasks", async () => {
    const run = await runReadOnlyTeamPlanAsync(buildTeamPlan("审查 src/agent/queryEngine.ts"), {
      now: () => 5000,
      async runWorker(task) {
        return {
          taskId: task.id,
          role: task.role,
          status: "blocked",
          summary: "provider unavailable",
          changedFiles: [],
          evidence: [{ type: "tool", id: "Task:Explore", status: "blocked" }],
          risks: ["provider unavailable"],
          nextSteps: ["retry later"],
        };
      },
    });

    expect(run.status).toBe("blocked");
    expect(run.taskRuns.map((taskRun) => taskRun.status)).toEqual(["blocked", "blocked"]);
    expect(run.taskRuns[1]?.blockedReason).toContain("unmet deps");
    expect(run.blackboard.some((entry) => entry.kind === "risk")).toBe(true);
  });
});
