import { describe, expect, it } from "vitest";
import { applyCompletionGate } from "../../../src/agent/completionGate";
import type { ToolEvidence } from "../../../src/agent/evidence";

describe("CompletionGate", () => {
  it("adds a warning when a report completion claim has no creation evidence", () => {
    const result = applyCompletionGate("报告已成功创建，并且可以在 Reports 中看到。", []);

    expect(result.blocked).toBe(true);
    expect(result.text).toContain("[CompletionGate]");
    expect(result.text).toContain("CreateReportArtifact");
  });

  it("allows report completion claims when CreateReportArtifact succeeded", () => {
    const result = applyCompletionGate("报告已成功创建，并且可以在 Reports 中看到。", [
      evidence({ toolName: "CreateReportArtifact" }),
    ]);

    expect(result.blocked).toBe(false);
    expect(result.text).not.toContain("[CompletionGate]");
  });

  it("blocks chart completion claims without report or dashboard product evidence", () => {
    const result = applyCompletionGate("柱状图已经正确生成，可以在 Reports 中看到。", []);

    expect(result.blocked).toBe(true);
    expect(result.text).toContain("图表完成声明缺少");
  });

  it("allows chart completion claims after an existing report was updated", () => {
    const result = applyCompletionGate("柱状图已经正确生成，可以在 Reports 中看到。", [
      evidence({ toolName: "UpdateReportArtifact", resultSummary: "Report updated: report-1 charts=1 datasets=1" }),
    ]);

    expect(result.blocked).toBe(false);
  });

  it("does not allow chart claims from a report tool result with zero charts", () => {
    const result = applyCompletionGate("柱状图已经正确生成，可以在 Reports 中看到。", [
      evidence({ toolName: "CreateReportArtifact", resultSummary: "Report created: report-1 charts=0 datasets=1" }),
    ]);

    expect(result.blocked).toBe(true);
  });

  it("does not treat non-completion analysis as a blocked artifact claim", () => {
    const result = applyCompletionGate("建议下一步创建报告，但目前还没有执行保存。", []);

    expect(result.blocked).toBe(false);
  });

  it("does not treat SQL-only caveats about missing metadata files as artifact completion claims", () => {
    const result = applyCompletionGate(
      "工作空间内无本地表结构元数据文件，无法确认列名。你要求只输出 SQL，因此如下：\n\n```sql\nSELECT D FROM \"@xu\".sample_sales_daily\n```",
      []
    );

    expect(result.blocked).toBe(false);
    expect(result.text).not.toContain("[CompletionGate]");
  });
});

function evidence(overrides: Partial<ToolEvidence> = {}): ToolEvidence {
  return {
    id: "ev-1",
    sessionId: "session-1",
    toolName: "read",
    status: "succeeded",
    createdAt: 1,
    argsHash: "hash",
    argsPreview: "{}",
    resultSummary: "ok",
    ...overrides,
  };
}
