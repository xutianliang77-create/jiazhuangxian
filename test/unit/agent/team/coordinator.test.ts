import { describe, expect, it } from "vitest";
import { buildTeamPlan, formatTeamPlan } from "../../../../src/agent/team";

describe("Agent Team coordinator M1", () => {
  it("stages whole-repo tasks into bounded read-only first pass", () => {
    const plan = buildTeamPlan("扫描整个项目的所有源码文件，每一个文件都要详细阅读，输出报告，寻找bug");

    expect(plan.status).toBe("planning");
    expect(plan.stagingReason).toContain("over-budget");
    expect(plan.tasks.map((task) => task.role)).toEqual(["explorer", "reviewer", "writer"]);
    expect(plan.tasks[0]?.writePolicy).toBe("read_only");
    expect(plan.tasks[0]?.scope.maxFiles).toBeLessThanOrEqual(40);
    expect(plan.tasks[0]?.objective).toContain("Do not read every file");
    expect(plan.tasks[0]?.acceptance.join(" ")).toContain("Do not claim");
  });

  it("builds a feature plan with implementation, verification, and review gates", () => {
    const plan = buildTeamPlan("修复 src/agent/queryEngine.ts 的 session 恢复 bug，并补测试验证");

    expect(plan.stagingReason).toBeUndefined();
    expect(plan.mergeStrategy).toBe("test-gated");
    expect(plan.tasks.map((task) => task.role)).toEqual([
      "explorer",
      "implementer",
      "test_engineer",
      "reviewer",
    ]);
    expect(plan.tasks[1]?.writePolicy).toBe("claimed_files_only");
    expect(plan.tasks[2]?.deps).toEqual(["team-task-2"]);
    expect(plan.tasks[3]?.deps).toEqual(["team-task-3"]);
    expect(plan.tasks[0]?.scope.files).toContain("src/agent/queryEngine.ts");
  });

  it("keeps output renderable and includes budget plus task evidence requirements", () => {
    const plan = buildTeamPlan("设计 Agent Team 文档");
    const rendered = formatTeamPlan(plan);

    expect(rendered).toContain("Agent Team Plan");
    expect(rendered).toContain("budget: workers=5, concurrent=2");
    expect(rendered).toContain("model: inherit-parent");
    expect(rendered).toContain("write-policy:");
    expect(rendered).toContain("acceptance:");
    expect(rendered).toContain("M1 is plan-only");
  });

  it("attaches role-level model preferences without changing roles that inherit parent model", () => {
    const plan = buildTeamPlan("审查 src/agent/queryEngine.ts", {
      roleModels: {
        explorer: "qwen/qwen3.6-14b",
        reviewer: "qwen/qwen3.6-27b",
      },
    });

    expect(plan.tasks.find((task) => task.role === "explorer")?.model).toBe("qwen/qwen3.6-14b");
    expect(plan.tasks.find((task) => task.role === "reviewer")?.model).toBe("qwen/qwen3.6-27b");
    expect(formatTeamPlan(plan)).toContain("model: qwen/qwen3.6-14b");
  });

  it("rejects empty goals", () => {
    expect(() => buildTeamPlan("   ")).toThrow("Team goal is required");
  });
});
