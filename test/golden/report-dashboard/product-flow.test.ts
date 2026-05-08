import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ToolRegistry } from "../../../src/agent/tools/registry";
import { registerDashboardTools } from "../../../src/dashboards/tools";
import { registerReportTools } from "../../../src/reports/tools";
import type { PermissionManager } from "../../../src/permissions/manager";
import type { WebServerHandle } from "../../../src/channels/web/server";
import { startWebServer } from "../../../src/channels/web/server";

const TOKEN = "test-token-aaaa1111";
const USER_ID = "web-test-tok";

let tmpRoot: string;
let handle: WebServerHandle;
let baseUrl: string;

beforeEach(async () => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-product-golden-"));
  handle = await startWebServer({
    port: 0,
    auth: { bearerToken: TOKEN },
    artifactsRoot: tmpRoot,
    engineDefaults: {
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: "ws-golden",
    },
  });
  baseUrl = `http://${handle.host}:${handle.port}`;
});

afterEach(async () => {
  await handle.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

describe("Report/Dashboard golden product flow", () => {
  it("creates a report with tools, serves it over Web API, then upgrades it to a dashboard", async () => {
    const registry = new ToolRegistry();
    registerReportTools(registry, { artifactsRoot: tmpRoot });
    registerDashboardTools(registry, { artifactsRoot: tmpRoot });
    const resultArtifact = path.join(tmpRoot, "beelink-mcp", "q-food-sales.json");
    mkdirSync(path.dirname(resultArtifact), { recursive: true });
    writeFileSync(
      resultArtifact,
      JSON.stringify({
        summary: { queryId: "q-food-sales", rowCount: 2 },
        columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
        rows: [{ item_name: "Bread", quantity: 12 }, { item_name: "Coffee", quantity: 7 }],
      }),
      "utf8"
    );

    const report = await registry.invoke(
      "CreateReportArtifact",
      {
        id: "golden-report-1",
        title: "Food sales report",
        question: "Which food sells best?",
        owner: { type: "user", id: USER_ID },
        workspaceId: "ws-golden",
        datasets: [
          {
            id: "dataset-food-sales",
            name: "food_sales",
            sql: "select item_name, sum(quantity) as quantity from food_sales group by item_name",
            queryId: "q-food-sales",
            previewRows: 5,
            rowCount: 20,
            columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
            resultArtifact,
            provenance: {
              sql: "select item_name, sum(quantity) as quantity from food_sales group by item_name",
              queryId: "q-food-sales",
              ruleCheck: { passed: true, errors: [], warnings: [] },
              artifacts: { result: resultArtifact },
            },
          },
        ],
        charts: [
          {
            id: "chart-top-food",
            title: "Top food items",
            datasetId: "dataset-food-sales",
            chart: { kind: "bar", x: "item_name", y: "quantity" },
          },
        ],
        sections: [{ id: "section-summary", title: "Summary", markdown: "Bread is the leading item." }],
        insights: [{ id: "insight-1", markdown: "Demand is concentrated in a few food items." }],
        provenance: { source: "manual", question: "Which food sells best?" },
      },
      ctx()
    );
    expect(report.ok).toBe(true);

    const rendered = await registry.invoke("RenderReportHtml", { reportId: "golden-report-1" }, ctx());
    expect(rendered.ok).toBe(true);
    expect(existsSync(path.join(tmpRoot, "reports", "golden-report-1", "report.html"))).toBe(true);

    const reports = await fetch(`${baseUrl}/v1/web/reports?workspaceId=ws-golden`, {
      headers: authHeaders(),
    });
    expect(reports.status).toBe(200);
    expect((await reports.json()) as unknown).toMatchObject({
      reports: [{ id: "golden-report-1", title: "Food sales report" }],
    });

    const reportHtml = await fetch(`${baseUrl}/v1/web/reports/golden-report-1/html`, {
      headers: authHeaders(),
    });
    expect(reportHtml.status).toBe(200);
    expect(await reportHtml.text()).toContain("Food sales report");

    const upgrade = await fetch(`${baseUrl}/v1/web/reports/golden-report-1/upgrade-dashboard`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ dashboardId: "golden-dashboard-1", title: "Food sales dashboard" }),
    });
    expect(upgrade.status).toBe(201);
    expect((await upgrade.json()) as unknown).toMatchObject({
      dashboard: {
        id: "golden-dashboard-1",
        sourceReportId: "golden-report-1",
        pages: [{ widgets: [{ type: "chart" }, { type: "text" }] }],
      },
    });

    const validation = await registry.invoke("ValidateDashboardSpec", { dashboardId: "golden-dashboard-1" }, ctx());
    expect(validation.ok).toBe(true);
    expect(validation.content).toContain('"valid": true');
  });
});

function ctx() {
  return {
    workspace: "ws-golden",
    permissionManager: {} as PermissionManager,
  };
}
