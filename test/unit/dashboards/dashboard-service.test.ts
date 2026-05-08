import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileDashboardStore } from "../../../src/dashboards/store";
import { DashboardService } from "../../../src/dashboards/service";
import type { DashboardDataset, DashboardPage } from "../../../src/dashboards/types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-dashboard-service-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("DashboardService", () => {
  it("creates, validates, and renders dashboard html artifacts", async () => {
    const service = new DashboardService(new FileDashboardStore({ artifactsRoot: tmpRoot }), {
      artifactsRoot: tmpRoot,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
    });

    const dashboard = await service.create({
      id: "dashboard-1",
      title: "Food dashboard",
      owner: { type: "user", id: "user-1" },
      workspaceId: "ws-1",
      datasets: [dataset()],
      pages: [page()],
      provenance: { source: "manual" },
    });

    const validation = await service.validate(dashboard.id);
    const html = await service.renderHtml(dashboard.id);

    expect(validation.valid).toBe(true);
    expect(html.path).toBe(path.join(tmpRoot, "dashboards", "dashboard-1", "dashboard.html"));
    expect(existsSync(html.path)).toBe(true);
    expect(readFileSync(html.path, "utf8")).toContain("Food dashboard");
    expect(await service.read(dashboard.id)).toMatchObject({ id: "dashboard-1" });
  });

  it("rejects invalid dashboards before persisting", async () => {
    const service = new DashboardService(new FileDashboardStore({ artifactsRoot: tmpRoot }), { artifactsRoot: tmpRoot });

    await expect(
      service.create({
        id: "dashboard-1",
        title: "Bad dashboard",
        owner: { type: "user", id: "user-1" },
        workspaceId: "ws-1",
        datasets: [dataset()],
        pages: [],
        provenance: { source: "manual" },
      })
    ).rejects.toThrow(/invalid dashboard/);
  });
});

function dataset(): DashboardDataset {
  return {
    id: "dataset-1",
    name: "sales",
    kind: "artifact",
    previewRows: 5,
    columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
    refresh: { mode: "manual" },
    safety: { readOnlyChecked: true, maxRows: 1000, upstreamPermissions: "current-user" },
  };
}

function page(): DashboardPage {
  return {
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
  };
}
