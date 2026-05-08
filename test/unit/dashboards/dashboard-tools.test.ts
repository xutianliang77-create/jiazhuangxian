import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ToolRegistry } from "../../../src/agent/tools/registry";
import { registerDashboardTools } from "../../../src/dashboards/tools";
import { registerReportTools } from "../../../src/reports/tools";
import type { PermissionManager } from "../../../src/permissions/manager";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-dashboard-tools-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("dashboard product tools", () => {
  it("upgrades report to dashboard, validates, renders, reads, and lists dashboards", async () => {
    const registry = new ToolRegistry();
    registerReportTools(registry, { artifactsRoot: tmpRoot });
    registerDashboardTools(registry, { artifactsRoot: tmpRoot });

    await registry.invoke(
      "CreateReportArtifact",
      {
        id: "report-1",
        title: "Food report",
        question: "Analyze food sales",
        workspaceId: "ws-1",
        datasets: [
          {
            id: "dataset-1",
            name: "sales",
            previewRows: 5,
            columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
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
        provenance: { source: "manual", question: "Analyze food sales" },
      },
      ctx()
    );

    const upgrade = await registry.invoke(
      "UpgradeReportToDashboard",
      { reportId: "report-1", dashboardId: "dashboard-1", workspaceId: "ws-1" },
      ctx()
    );
    expect(upgrade).toMatchObject({ ok: true });
    expect(upgrade.content).toContain("dashboard-1");
    expect(upgrade.content).toContain("charts=1");
    expect(upgrade.content).toContain("datasets=1");

    const validation = await registry.invoke("ValidateDashboardSpec", { dashboardId: "dashboard-1" }, ctx());
    expect(validation.ok).toBe(true);
    expect(validation.content).toContain('"valid": true');

    const html = await registry.invoke("RenderDashboardHtml", { dashboardId: "dashboard-1" }, ctx());
    expect(html.ok).toBe(true);
    expect(existsSync(path.join(tmpRoot, "dashboards", "dashboard-1", "dashboard.html"))).toBe(true);

    const read = await registry.invoke("ReadDashboard", { dashboardId: "dashboard-1" }, ctx());
    expect(read.content).toContain("dashboard-1");
    expect(read.content).toContain('"id": "tool-user"');

    const list = await registry.invoke("ListDashboards", { workspaceId: "ws-1" }, ctx());
    expect(list.content).toContain("dashboard-1");
  });

  it("uses the authenticated tool context owner for dashboard creation and upgrade", async () => {
    const registry = new ToolRegistry();
    registerReportTools(registry, { artifactsRoot: tmpRoot });
    registerDashboardTools(registry, { artifactsRoot: tmpRoot });

    await registry.invoke(
      "CreateReportArtifact",
      {
        id: "report-context-owner",
        question: "Analyze food sales",
        owner: { type: "user", id: "local" },
        datasets: [{ id: "dataset-1", name: "sales", previewRows: 1 }],
        provenance: { source: "manual" },
      },
      ctx()
    );

    await registry.invoke(
      "UpgradeReportToDashboard",
      {
        reportId: "report-context-owner",
        dashboardId: "dashboard-context-owner",
        owner: { type: "user", id: "local" },
      },
      ctx()
    );

    const upgraded = await registry.invoke("ReadDashboard", { dashboardId: "dashboard-context-owner" }, ctx());
    expect(upgraded.content).toContain('"id": "tool-user"');
    expect(upgraded.content).not.toContain('"id": "local"');

    const createdSpec = await registry.invoke(
      "CreateDashboardSpec",
      {
        id: "dashboard-created-context-owner",
        title: "Food dashboard",
        owner: { type: "user", id: "local" },
        datasets: [{ id: "dataset-1", name: "sales", previewRows: 1 }],
        pages: [{ id: "page-1", title: "Overview", widgets: [{ id: "chart-1", type: "chart", datasetId: "dataset-1" }] }],
        provenance: { source: "manual" },
      },
      ctx()
    );
    expect(createdSpec.content).toContain("charts=1");
    expect(createdSpec.content).toContain("datasets=1");

    const created = await registry.invoke("ReadDashboard", { dashboardId: "dashboard-created-context-owner" }, ctx());
    expect(created.content).toContain('"id": "tool-user"');
    expect(created.content).not.toContain('"id": "local"');
  });
});

function ctx() {
  return {
    workspace: "ws-1",
    userId: "tool-user",
    channel: "http",
    artifactsRoot: tmpRoot,
    permissionManager: {} as PermissionManager,
  };
}
