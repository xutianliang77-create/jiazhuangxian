import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildTeamPlan,
  executeClaimedFileWrite,
} from "../../../../src/agent/team";
import type { TeamClaim } from "../../../../src/agent/team";
import { isHandledLocalToolResult } from "../../../../src/tools/local";

describe("Agent Team claimed-file write executor", () => {
  async function setupWorkspace() {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "codeclaw-team-write-"));
    const target = "src/example.ts";
    const absoluteTarget = path.join(workspace, target);
    await mkdir(path.dirname(absoluteTarget), { recursive: true });
    await writeFile(absoluteTarget, "const value = 'old';\n", "utf8");

    const plan = buildTeamPlan("修复 src/example.ts");
    const task = plan.tasks.find((item) => item.role === "implementer");
    expect(task).toBeDefined();
    const claim: TeamClaim = {
      id: "claim-1",
      teamRunId: "run-1",
      taskId: task!.id,
      path: target,
      mode: "write",
      status: "active",
      createdAt: 1,
    };

    return { workspace, target, task: task!, claim };
  }

  it("executes write tools after an active claimed-file approval", async () => {
    const { workspace, target, task, claim } = await setupWorkspace();

    const result = await executeClaimedFileWrite({
      task,
      workspace,
      claims: [claim],
      prompt: `/replace ${target} :: old :: new`,
    });

    expect(isHandledLocalToolResult(result)).toBe(true);
    if (!isHandledLocalToolResult(result)) throw new Error("expected handled local tool result");
    expect(result.status).toBe("completed");
    await expect(readFile(path.join(workspace, target), "utf8")).resolves.toContain("'new'");
  });

  it("blocks pending, unclaimed, and bash writes before local tool execution", async () => {
    const { workspace, target, task, claim } = await setupWorkspace();

    const pendingResult = await executeClaimedFileWrite({
      task,
      workspace,
      claims: [{ ...claim, status: "pending_approval" }],
      prompt: `/append ${target} :: // comment`,
    });
    expect(isHandledLocalToolResult(pendingResult)).toBe(true);
    if (!isHandledLocalToolResult(pendingResult)) throw new Error("expected handled local tool result");
    expect(pendingResult.status).toBe("blocked");

    const unclaimedResult = await executeClaimedFileWrite({
      task,
      workspace,
      claims: [claim],
      prompt: "/write src/other.ts :: content",
    });
    expect(isHandledLocalToolResult(unclaimedResult)).toBe(true);
    if (!isHandledLocalToolResult(unclaimedResult)) throw new Error("expected handled local tool result");
    expect(unclaimedResult.status).toBe("blocked");

    const bashResult = await executeClaimedFileWrite({
      task,
      workspace,
      claims: [claim],
      prompt: `/bash echo unsafe > ${target}`,
    });
    expect(isHandledLocalToolResult(bashResult)).toBe(true);
    if (!isHandledLocalToolResult(bashResult)) throw new Error("expected handled local tool result");
    expect(bashResult.status).toBe("blocked");
    await expect(readFile(path.join(workspace, target), "utf8")).resolves.toContain("'old'");
  });
});
