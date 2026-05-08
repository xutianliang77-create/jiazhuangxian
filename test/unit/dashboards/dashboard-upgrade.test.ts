import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileDashboardStore } from "../../../src/dashboards/store";
import { upgradeReportToDashboard } from "../../../src/dashboards/upgrade";
import { FileReportStore } from "../../../src/reports/store";
import type { ReportArtifact } from "../../../src/reports/types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-dashboard-upgrade-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("upgradeReportToDashboard", () => {
  it("upgrades report datasets, charts, and sections into a dashboard draft", async () => {
    const reportStore = new FileReportStore({ artifactsRoot: tmpRoot });
    const dashboardStore = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await reportStore.create(sampleReport());

    const dashboard = await upgradeReportToDashboard(
      {
        reportId: "report-1",
        dashboardId: "dashboard-1",
        title: "Food dashboard",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
        now: () => new Date("2026-05-03T00:00:00.000Z"),
      },
      { reportStore, dashboardStore }
    );

    expect(dashboard).toMatchObject({
      id: "dashboard-1",
      title: "Food dashboard",
      sourceReportId: "report-1",
      provenance: { source: "report_upgrade", sourceReportId: "report-1" },
    });
    expect(dashboard.datasets).toHaveLength(1);
    expect(dashboard.datasets[0]).toMatchObject({ id: "dataset-1", kind: "sql" });
    expect(dashboard.datasets[0].provenance).toMatchObject({
      queryId: "q-1",
      generatedBy: { provider: "lmstudio", model: "qwen3.6" },
      preview: { rows: 5, rowCount: 10, truncated: true },
    });
    expect(dashboard.pages[0].widgets.map((widget) => widget.type)).toEqual(["chart", "text"]);
    expect((await reportStore.read("report-1")).upgrade?.dashboardId).toBe("dashboard-1");
    expect((await dashboardStore.read("dashboard-1")).id).toBe("dashboard-1");
  });

  it("can include only selected charts", async () => {
    const reportStore = new FileReportStore({ artifactsRoot: tmpRoot });
    const dashboardStore = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await reportStore.create({
      ...sampleReport(),
      charts: [
        ...sampleReport().charts,
        {
          id: "chart-2",
          title: "Skip me",
          datasetId: "dataset-1",
          chart: { kind: "line", x: "item_name", y: "quantity" },
        },
      ],
    });

    const dashboard = await upgradeReportToDashboard(
      {
        reportId: "report-1",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
        includeChartIds: ["chart-1"],
      },
      { reportStore, dashboardStore }
    );

    expect(dashboard.pages[0].widgets.filter((widget) => widget.type === "chart").map((widget) => widget.title)).toEqual([
      "Top items",
    ]);
  });

  it("upgrades reports with legacy chart objects that are missing chart.kind", async () => {
    const reportStore = new FileReportStore({ artifactsRoot: tmpRoot });
    const dashboardStore = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await reportStore.create({
      ...sampleReport(),
      charts: [
        {
          id: "chart-legacy",
          title: "Legacy chart",
          datasetId: "dataset-1",
        } as never,
      ],
    });

    const dashboard = await upgradeReportToDashboard(
      {
        reportId: "report-1",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
      },
      { reportStore, dashboardStore }
    );

    expect(dashboard.pages[0].widgets[0].chart).toMatchObject({ kind: "bar" });
  });

  it("preserves legacy chart type when upgrading reports", async () => {
    const reportStore = new FileReportStore({ artifactsRoot: tmpRoot });
    const dashboardStore = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await reportStore.create({
      ...sampleReport(),
      charts: [
        {
          id: "chart-legacy-pie",
          title: "Legacy pie",
          datasetId: "dataset-1",
          type: "pie",
        } as never,
      ],
    });

    const dashboard = await upgradeReportToDashboard(
      {
        reportId: "report-1",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
      },
      { reportStore, dashboardStore }
    );

    expect(dashboard.pages[0].widgets[0].chart).toMatchObject({ kind: "pie" });
  });

  it("upgrades legacy LLM reports with missing columns and content sections", async () => {
    const reportStore = new FileReportStore({ artifactsRoot: tmpRoot });
    const dashboardStore = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await reportStore.create({
      ...sampleReport(),
      datasets: [
        {
          id: "dataset-legacy",
          name: "Legacy dataset",
          sql: "select item_name from sales",
          rows: [{ item_name: "Bread", quantity: 10 }],
          previewRows: 5,
          provenance: {
            sql: "select item_name from sales",
            queryId: "q-legacy",
            ruleCheck: { passed: true, errors: [], warnings: [] },
          },
        } as never,
      ],
      charts: [
        {
          id: "chart-legacy",
          title: "Legacy chart",
          datasetId: "dataset-legacy",
          chart: { x: "item_name", y: "quantity" },
        } as never,
      ],
      sections: [{ id: "section-content", title: "Summary", content: "Legacy content" } as never],
    });

    const dashboard = await upgradeReportToDashboard(
      {
        reportId: "report-1",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
      },
      { reportStore, dashboardStore }
    );

    expect(dashboard.datasets[0].columns.map((column) => column.name)).toEqual(["item_name", "quantity"]);
    expect(dashboard.datasets[0].rows).toEqual([{ item_name: "Bread", quantity: 10 }]);
    expect(dashboard.pages[0].widgets[0].chart).toMatchObject({ kind: "bar" });
    expect(dashboard.pages[0].widgets[1]).toMatchObject({ type: "text", text: "Legacy content" });
  });

  it("hydrates dashboard datasets from report result artifacts", async () => {
    const artifactPath = path.join(tmpRoot, "beelink-mcp", "q-full.json");
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        summary: { queryId: "q-full", rowCount: 2 },
        columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
        rows: [{ item_name: "Bread", quantity: 10 }, { item_name: "Coffee", quantity: 7 }],
      }),
      "utf8"
    );
    const baseReport = sampleReport();
    const baseDataset = baseReport.datasets[0]!;
    const reportStore = new FileReportStore({ artifactsRoot: tmpRoot });
    const dashboardStore = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await reportStore.create({
      ...baseReport,
      datasets: [
        {
          ...baseDataset,
          columns: [],
          previewRows: 0,
          rowCount: undefined,
          resultArtifact: { path: artifactPath, kind: "json", createdAt: "2026-05-03T00:00:00.000Z" },
          provenance: {
            ...baseDataset.provenance,
            sql: baseDataset.provenance!.sql,
            artifacts: {
              result: { path: artifactPath, kind: "json", createdAt: "2026-05-03T00:00:00.000Z" },
            },
          },
        },
      ],
    });

    const dashboard = await upgradeReportToDashboard(
      {
        reportId: "report-1",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
        artifactsRoot: tmpRoot,
      },
      { reportStore, dashboardStore }
    );

    expect(dashboard.datasets[0].rows).toEqual([
      { item_name: "Bread", quantity: 10 },
      { item_name: "Coffee", quantity: 7 },
    ]);
    expect(dashboard.datasets[0].columns.map((column) => column.name)).toEqual(["item_name", "quantity"]);
  });
});

function sampleReport(): ReportArtifact {
  const now = "2026-05-03T00:00:00.000Z";
  return {
    version: 1,
    id: "report-1",
    title: "Food report",
    question: "Analyze food sales",
    owner: { type: "user", id: "user-1" },
    workspaceId: "ws-1",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    datasets: [
      {
        id: "dataset-1",
        name: "sales",
        sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
        queryId: "q-1",
        previewRows: 5,
        rowCount: 10,
        columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
        provenance: {
          sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
          queryId: "q-1",
          ruleCheck: { passed: true, errors: [], warnings: [] },
        },
      },
    ],
    charts: [
      {
        id: "chart-1",
        title: "Top items",
        datasetId: "dataset-1",
        chart: { kind: "bar", x: "item_name", y: "quantity" },
      },
    ],
    sections: [{ id: "section-1", title: "Summary", markdown: "Bread wins" }],
    insights: [],
    caveats: [],
    exports: [],
    provenance: { source: "manual", question: "Analyze food sales", provider: "lmstudio", model: "qwen3.6" },
  };
}
