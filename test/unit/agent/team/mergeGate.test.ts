import { describe, expect, it } from "vitest";

import { buildTeamPlan, evaluateTeamMergeGate } from "../../../../src/agent/team";
import type { TeamTaskRun } from "../../../../src/agent/team";

describe("Agent Team merge gate", () => {
  it("requires reviewer evidence for reviewer-gated plans", () => {
    const plan = buildTeamPlan("审查 src/agent/queryEngine.ts");
    const taskRuns: TeamTaskRun[] = plan.tasks.map((task) => ({
      task,
      status: "completed",
      result: {
        taskId: task.id,
        role: task.role,
        status: "completed",
        summary: `${task.role} done`,
        changedFiles: [],
        evidence: task.role === "reviewer"
          ? [{ type: "tool", id: "Task:code-reviewer", status: "passed" }]
          : [{ type: "tool", id: "Task:Explore", status: "passed" }],
        risks: [],
        nextSteps: [],
      },
    }));

    const gate = evaluateTeamMergeGate(plan, taskRuns);

    expect(gate.status).toBe("passed");
    expect(gate.requiredRoles).toEqual(["reviewer"]);
    expect(gate.satisfiedRoles).toEqual(["reviewer"]);
  });

  it("requires both test_engineer and reviewer evidence for test-gated plans", () => {
    const plan = buildTeamPlan("修复 src/agent/queryEngine.ts 并补测试验证");
    const taskRuns: TeamTaskRun[] = plan.tasks.map((task) => ({
      task,
      status: "completed",
      result: {
        taskId: task.id,
        role: task.role,
        status: "completed",
        summary: `${task.role} done`,
        changedFiles: [],
        evidence: task.role === "reviewer"
          ? [{ type: "tool", id: "Task:code-reviewer", status: "passed" }]
          : [],
        risks: [],
        nextSteps: [],
      },
    }));

    const gate = evaluateTeamMergeGate(plan, taskRuns);

    expect(gate.status).toBe("blocked");
    expect(gate.requiredRoles).toEqual(["test_engineer", "reviewer"]);
    expect(gate.satisfiedRoles).toEqual(["reviewer"]);
    expect(gate.missingRoles).toEqual(["test_engineer"]);
  });
});
