import { describe, expect, it } from "vitest";

import { buildTeamPlan, enforceClaimedFileWrite } from "../../../../src/agent/team";

const WORKSPACE = "/workspace/project";

describe("Agent Team claimed-file write guard", () => {
  it("allows write tools only for active claimed files", () => {
    const plan = buildTeamPlan("修复 src/agent/queryEngine.ts");
    const task = plan.tasks.find((item) => item.role === "implementer");
    expect(task).toBeDefined();

    const result = enforceClaimedFileWrite({
      task: task!,
      workspace: WORKSPACE,
      prompt: "/replace src/agent/queryEngine.ts :: old :: next",
      claims: [
        {
          id: "claim-1",
          teamRunId: "run-1",
          taskId: task!.id,
          path: "src/agent/queryEngine.ts",
          mode: "write",
          status: "active",
          createdAt: 1,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      toolName: "replace",
      target: "src/agent/queryEngine.ts",
      claimId: "claim-1",
    });
  });

  it("blocks unclaimed write targets", () => {
    const plan = buildTeamPlan("修复 src/agent/queryEngine.ts");
    const task = plan.tasks.find((item) => item.role === "implementer");
    expect(task).toBeDefined();

    const result = enforceClaimedFileWrite({
      task: task!,
      workspace: WORKSPACE,
      prompt: "/write src/agent/other.ts :: content",
      claims: [
        {
          id: "claim-1",
          teamRunId: "run-1",
          taskId: task!.id,
          path: "src/agent/queryEngine.ts",
          mode: "write",
          status: "active",
          createdAt: 1,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: "write",
      target: "src/agent/other.ts",
    });
    if (!result.ok) {
      expect(result.reason).toContain("not actively claimed");
    }
  });

  it("blocks pending claims, bash, and paths outside the workspace", () => {
    const plan = buildTeamPlan("修复 src/agent/queryEngine.ts");
    const task = plan.tasks.find((item) => item.role === "implementer");
    expect(task).toBeDefined();
    const pendingClaim = {
      id: "claim-1",
      teamRunId: "run-1",
      taskId: task!.id,
      path: "src/agent/queryEngine.ts",
      mode: "write" as const,
      status: "pending_approval" as const,
      createdAt: 1,
    };

    expect(enforceClaimedFileWrite({
      task: task!,
      workspace: WORKSPACE,
      prompt: "/append src/agent/queryEngine.ts :: content",
      claims: [pendingClaim],
    })).toMatchObject({ ok: false });

    expect(enforceClaimedFileWrite({
      task: task!,
      workspace: WORKSPACE,
      prompt: "/bash echo unsafe > src/agent/queryEngine.ts",
      claims: [{ ...pendingClaim, status: "active" }],
    })).toMatchObject({ ok: false });

    expect(enforceClaimedFileWrite({
      task: task!,
      workspace: WORKSPACE,
      prompt: "/write ../outside.ts :: content",
      claims: [{ ...pendingClaim, status: "active" }],
    })).toMatchObject({ ok: false, toolName: "write" });
  });
});
