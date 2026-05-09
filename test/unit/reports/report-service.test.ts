import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileReportStore } from "../../../src/reports/store";
import { ReportService } from "../../../src/reports/service";
import type { ReportDataset } from "../../../src/reports/types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-report-service-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ReportService", () => {
  it("creates a report and renders markdown/html artifacts", async () => {
    const service = new ReportService(new FileReportStore({ artifactsRoot: tmpRoot }), {
      artifactsRoot: tmpRoot,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
    });

    const report = await service.create({
      id: "report-1",
      title: "Food report",
      question: "Analyze food sales",
      owner: { type: "user", id: "user-1" },
      workspaceId: "ws-1",
      datasets: [dataset()],
      insights: [{ id: "insight-1", markdown: "Bread wins by quantity" }],
      provenance: { source: "manual", question: "Analyze food sales", provider: "lmstudio", model: "qwen3.6" },
    });

    const markdown = await service.renderMarkdown(report.id);
    const html = await service.renderHtml(report.id);
    const reread = await service.read(report.id);

    expect(markdown.path).toBe(path.join(tmpRoot, "reports", "report-1", "report.md"));
    expect(html.path).toBe(path.join(tmpRoot, "reports", "report-1", "report.html"));
    expect(existsSync(markdown.path)).toBe(true);
    expect(readFileSync(html.path, "utf8")).toContain("Food report");
    expect(reread.exports.map((item) => item.format).sort()).toEqual(["html", "markdown"]);
    expect(reread.datasets[0].provenance).toMatchObject({
      queryId: "q-1",
      generatedBy: { provider: "lmstudio", model: "qwen3.6" },
      preview: { rows: 5, truncated: false },
    });
  });

  it("normalizes LLM chart shorthand before persisting and rendering", async () => {
    const service = new ReportService(new FileReportStore({ artifactsRoot: tmpRoot }), {
      artifactsRoot: tmpRoot,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
    });

    const report = await service.create({
      id: "report-shorthand",
      question: "Analyze food sales",
      owner: { type: "user", id: "user-1" },
      workspaceId: "ws-1",
      datasets: [dataset()],
      charts: [
        {
          id: "chart-1",
          title: "By category",
          datasetId: "dataset-1",
          type: "column",
          x: "category",
          y: "quantity",
        } as never,
      ],
      provenance: { source: "llm", question: "Analyze food sales" },
    });

    expect(report.charts[0].chart).toMatchObject({ kind: "bar", x: "category", y: "quantity" });
    const html = await service.renderHtml(report.id);
    expect(readFileSync(html.path, "utf8")).toContain("<p>bar</p>");
  });

  it("normalizes LLM dataset rows/data shorthands before persisting", async () => {
    const service = new ReportService(new FileReportStore({ artifactsRoot: tmpRoot }), {
      artifactsRoot: tmpRoot,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
    });

    const report = await service.create({
      id: "report-dataset-shorthand",
      question: "Analyze food sales",
      owner: { type: "user", id: "user-1" },
      workspaceId: "ws-1",
      datasets: [
        {
          id: "dataset-1",
          name: "sales",
          data: [{ item_name: "Bread", quantity: 10 }],
        } as never,
      ],
      provenance: { source: "llm", question: "Analyze food sales" },
    });

    expect(report.datasets[0]).toMatchObject({
      previewRows: 1,
      columns: [{ name: "item_name" }, { name: "quantity" }],
    });
    const html = await service.renderHtml(report.id);
    expect(readFileSync(html.path, "utf8")).toContain("previewRows=1");
  });

  it("renders charts from bounded result artifacts when inline rows are only previews", async () => {
    const artifactPath = path.join(tmpRoot, "beelink-mcp", "q-full.json");
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        summary: { queryId: "q-full", rowCount: 2, exportedRows: 2 },
        columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
        rows: [{ item_name: "Bread", quantity: 10 }, { item_name: "Coffee", quantity: 7 }],
      }),
      "utf8"
    );
    const service = new ReportService(new FileReportStore({ artifactsRoot: tmpRoot }), {
      artifactsRoot: tmpRoot,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
    });

    const report = await service.create({
      id: "report-artifact-rows",
      question: "Analyze food sales",
      owner: { type: "user", id: "user-1" },
      workspaceId: "ws-1",
      datasets: [
        {
          id: "dataset-1",
          name: "sales",
          sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
          queryId: "q-full",
          previewRows: 0,
          columns: [],
          resultArtifact: { path: artifactPath, kind: "json", createdAt: "2026-05-03T00:00:00.000Z" },
          provenance: {
            sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
            queryId: "q-full",
            ruleCheck: { passed: true, errors: [], warnings: [] },
            artifacts: {
              result: { path: artifactPath, kind: "json", createdAt: "2026-05-03T00:00:00.000Z" },
            },
          },
        },
      ],
      charts: [{ id: "chart-1", title: "Top items", datasetId: "dataset-1", chart: { kind: "bar" } }],
      provenance: { source: "llm", question: "Analyze food sales" },
    });

    const html = await service.renderHtml(report.id);
    expect(readFileSync(html.path, "utf8")).toContain("Bread");
    expect(readFileSync(html.path, "utf8")).toContain("echarts.init");
  });

  it("rejects invalid reports before persisting", async () => {
    const service = new ReportService(new FileReportStore({ artifactsRoot: tmpRoot }), { artifactsRoot: tmpRoot });

    await expect(
      service.create({
        id: "report-1",
        question: "Analyze food sales",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
        datasets: [],
        provenance: { source: "manual", question: "Analyze food sales" },
      })
    ).rejects.toThrow(/invalid report/);
  });

  it("rejects SQL reports without a persisted result artifact", async () => {
    const service = new ReportService(new FileReportStore({ artifactsRoot: tmpRoot }), { artifactsRoot: tmpRoot });

    await expect(
      service.create({
        id: "report-sql-no-artifact",
        question: "Analyze food sales",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
        datasets: [
          {
            id: "dataset-1",
            name: "sales",
            sql: "select item_name from sales",
            queryId: "q-missing-artifact",
            previewRows: 1,
            columns: [{ name: "item_name" }],
            provenance: {
              sql: "select item_name from sales",
              queryId: "q-missing-artifact",
              ruleCheck: { passed: true, errors: [], warnings: [] },
            },
          },
        ],
        provenance: { source: "manual", question: "Analyze food sales" },
      })
    ).rejects.toThrow(/persisted result artifact/);
  });
});

function dataset(): ReportDataset {
  const resultArtifact = {
    path: path.join(tmpRoot, "beelink-mcp", "q-1.json"),
    kind: "json" as const,
    createdAt: "2026-05-03T00:00:00.000Z",
  };
  return {
    id: "dataset-1",
    name: "sales",
    sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
    queryId: "q-1",
    previewRows: 5,
    columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
    resultArtifact,
    provenance: {
      sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
      queryId: "q-1",
      ruleCheck: { passed: true, errors: [], warnings: [] },
      artifacts: { result: resultArtifact },
    },
  };
}
