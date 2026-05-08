import { describe, expect, it } from "vitest";

import { renderDashboardHtml } from "../../../src/dashboards/renderHtml";
import type { DashboardSpec } from "../../../src/dashboards/types";

describe("renderDashboardHtml", () => {
  it("renders static dashboard HTML and escapes text", () => {
    const html = renderDashboardHtml(sampleDashboard({ title: "<img src=x onerror=alert(1)>" }), {
      echarts: { mode: "none" },
    });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("Overview");
    expect(html).toContain("Chart · bar");
    expect(html).toContain('id="dashboard-chart-widget-1"');
    expect(html).toContain("echarts.init");
    expect(html).toContain("Bread");
    expect(html).toContain("queryId=q-1");
    expect(html).toContain("truncated=true");
    expect(html).toContain("model=lmstudio / qwen3.6");
    expect(html).toContain("/tmp/dashboard-result.json");
  });
});

function sampleDashboard(overrides: Partial<DashboardSpec> = {}): DashboardSpec {
  const now = "2026-05-03T00:00:00.000Z";
  return {
    version: 1,
    id: "dashboard-1",
    title: "Sales dashboard",
    owner: { type: "user", id: "user-1" },
    workspaceId: "ws-1",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    datasets: [
      {
        id: "dataset-1",
        name: "sales",
        kind: "artifact",
        sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
        previewRows: 5,
        rowCount: 10,
        columns: [{ name: "item_name", type: "VARCHAR" }],
        rows: [
          { item_name: "Bread", quantity: 10 },
          { item_name: "Coffee", quantity: 7 },
        ],
        resultArtifact: {
          path: "/tmp/dashboard-result.json",
          kind: "json",
          createdAt: now,
        },
        refresh: { mode: "manual", queryId: "q-1" },
        safety: { readOnlyChecked: true, maxRows: 1000, upstreamPermissions: "current-user" },
        provenance: {
          sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
          queryId: "q-1",
          generatedBy: { provider: "lmstudio", model: "qwen3.6" },
          preview: { rows: 5, rowCount: 10, truncated: true },
          artifacts: {
            result: {
              path: "/tmp/dashboard-result.json",
              kind: "json",
              createdAt: now,
            },
          },
        },
      },
    ],
    pages: [
      {
        id: "page-1",
        title: "Overview",
        order: 1,
        layout: { columns: 12, rowHeight: 80, responsive: true },
        widgets: [
          {
            id: "widget-1",
            type: "chart",
            title: "Top items",
            datasetId: "dataset-1",
            layout: { x: 0, y: 0, w: 6, h: 4 },
            chart: { kind: "bar", x: "item_name", y: "quantity" },
          },
        ],
      },
    ],
    filters: [],
    parameters: [],
    interactions: [],
    permissions: [],
    schedules: [],
    subscriptions: [],
    provenance: { source: "manual", provider: "lmstudio", model: "qwen3.6" },
    lifecycle: { version: 1 },
    ...overrides,
  };
}
