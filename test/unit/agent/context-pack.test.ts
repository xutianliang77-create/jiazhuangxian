import { describe, expect, it } from "vitest";
import { buildContextPack, coerceSqlOnlyResponse } from "../../../src/agent/contextPack";
import type { ToolEvidence } from "../../../src/agent/evidence";

describe("ContextPack", () => {
  it("adds report done criteria for report prompts", () => {
    const pack = buildContextPack({ prompt: "生成一个销售报告" });

    expect(pack).toContain("[ContextPack]");
    expect(pack).toContain("CreateReportArtifact");
    expect(pack).toContain("UpdateReportArtifact");
    expect(pack).toContain("RenderReportHtml");
  });

  it("routes chart prompts through report artifacts instead of standalone chart MCP tools", () => {
    const pack = buildContextPack({ prompt: "继续分析女性购买的物品分布，按照购买量做前10排名，然后生成柱状图" });

    expect(pack).toContain("ReportArtifact charts");
    expect(pack).toContain("do not use standalone ECharts MCP tools");
    expect(pack).toContain("ReadReport");
  });

  it("stays out of ordinary chat when there is no useful context", () => {
    expect(buildContextPack({ prompt: "hi" })).toBeNull();
  });

  it("adds SQL-only criteria without treating negated report wording as report creation", () => {
    const pack = buildContextPack({
      prompt:
        "请基于 Dremio 表 @xu.sample_sales_daily 生成一个只读 SQL，只输出 SQL，不要执行，不要生成报表。",
    });

    expect(pack).toContain("SQL only");
    expect(pack).toContain("Do not execute SQL");
    expect(pack).not.toContain("CreateReportArtifact");
  });

  it("does not treat distant negated report wording as positive report intent", () => {
    const pack = buildContextPack({
      prompt: "请帮我分析一下数据，先给出重点发现和 SQL 思路，但是不要生成报告。",
    });

    expect(pack).toContain("SQL only");
    expect(pack).not.toContain("CreateReportArtifact");
  });

  it("summarizes recent evidence for continuation prompts", () => {
    const pack = buildContextPack({
      prompt: "继续",
      evidence: [
        evidence({ toolName: "ExploreForQuestion", resultSummary: "Found @xu.sample_sales_daily" }),
        evidence({ toolName: "RunSqlQuery", resultSummary: "Query preview rows: 5" }),
      ],
    });

    expect(pack).toContain("Recent evidence");
    expect(pack).toContain("ExploreForQuestion succeeded");
    expect(pack).toContain("RunSqlQuery succeeded");
  });

  it("coerces SQL-only responses to the SQL code block", () => {
    const text = [
      "字段说明如下。",
      "",
      "```sql",
      'SELECT D AS product FROM "@xu".sample_sales_daily LIMIT 10',
      "```",
      "",
      "注意：这是只读 SQL。",
    ].join("\n");

    expect(coerceSqlOnlyResponse(text)).toBe('SELECT D AS product FROM "@xu".sample_sales_daily LIMIT 10;');
  });

  it("skips non-SQL fenced blocks when coercing SQL-only responses", () => {
    const text = [
      "这里有个解释：",
      "```python",
      "select = 'not sql'",
      "```",
      "实际 SQL：",
      "```",
      "SELECT id FROM orders",
      "```",
    ].join("\n");

    expect(coerceSqlOnlyResponse(text)).toBe("SELECT id FROM orders;");
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
