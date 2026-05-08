import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileDashboardStore } from "../../../src/dashboards/store";
import type { DashboardSpec } from "../../../src/dashboards/types";
import type { ArtifactRef } from "../../../src/reports/types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-dashboard-store-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("FileDashboardStore", () => {
  it("creates, reads, and lists dashboards", async () => {
    const store = new FileDashboardStore({ artifactsRoot: tmpRoot });
    const dashboard = sampleDashboard("dashboard-a", { ownerId: "user-1", workspaceId: "ws-1" });

    await store.create(dashboard);

    expect(await store.read("dashboard-a")).toMatchObject({ id: "dashboard-a", title: "Sales dashboard" });
    expect(existsSync(path.join(tmpRoot, "dashboards", "dashboard-a", "dashboard.json"))).toBe(true);
    expect((await store.list({ workspaceId: "ws-1" })).dashboards.map((item) => item.id)).toEqual(["dashboard-a"]);
    expect((await store.list({ ownerId: "other" })).dashboards).toEqual([]);
  });

  it("updates dashboards and writes immutable versions", async () => {
    const store = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await store.create(sampleDashboard("dashboard-a"));

    const updated = sampleDashboard("dashboard-a", { title: "Updated dashboard", lifecycleVersion: 2 });
    await store.update(updated);
    const version = await store.writeVersion(updated);

    expect((await store.read("dashboard-a")).title).toBe("Updated dashboard");
    expect(version.version).toBe(2);
    expect(readFileSync(version.artifact.path, "utf8")).toContain("Updated dashboard");
  });

  it("appends audit events", async () => {
    const store = new FileDashboardStore({ artifactsRoot: tmpRoot });
    await store.create(sampleDashboard("dashboard-a"));

    await store.appendAudit("dashboard-a", {
      id: "evt-1",
      dashboardId: "dashboard-a",
      actor: { type: "user", id: "user-1" },
      action: "render",
      at: "2026-05-03T00:00:00.000Z",
    });

    expect(readFileSync(path.join(tmpRoot, "dashboards", "dashboard-a", "audit.jsonl"), "utf8")).toContain("evt-1");
  });

  it("rejects unsafe ids and artifact refs outside artifact root", async () => {
    const store = new FileDashboardStore({ artifactsRoot: tmpRoot });

    await expect(store.create(sampleDashboard("../bad"))).rejects.toThrow(/invalid dashboard id/);
    await expect(
      store.create(
        sampleDashboard("dashboard-a", {
          datasets: [
            {
              ...sampleDashboard("x").datasets[0],
              resultArtifact: artifact(path.join(tmpRoot, "..", "outside.json"), "json"),
            },
          ],
        })
      )
    ).rejects.toThrow(/outside artifact root/);
  });
});

function sampleDashboard(
  id: string,
  overrides: Partial<DashboardSpec> & { ownerId?: string; workspaceId?: string; lifecycleVersion?: number } = {}
): DashboardSpec {
  const now = "2026-05-03T00:00:00.000Z";
  const ownerId = overrides.ownerId ?? "user-1";
  const workspaceId = overrides.workspaceId ?? "ws-1";
  return {
    version: 1,
    id,
    title: overrides.title ?? "Sales dashboard",
    owner: { type: "user", id: ownerId },
    workspaceId,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    status: overrides.status ?? "draft",
    datasets: overrides.datasets ?? [
      {
        id: "dataset-1",
        name: "sales",
        kind: "artifact",
        previewRows: 5,
        columns: [{ name: "item_name", type: "VARCHAR", semanticRole: "dimension" }],
        refresh: { mode: "manual" },
        safety: {
          readOnlyChecked: true,
          maxRows: 1000,
          upstreamPermissions: "current-user",
        },
      },
    ],
    pages: overrides.pages ?? [
      {
        id: "page-1",
        title: "Overview",
        order: 1,
        layout: { columns: 12, rowHeight: 80, responsive: true },
        widgets: [],
      },
    ],
    filters: overrides.filters ?? [],
    parameters: overrides.parameters ?? [],
    interactions: overrides.interactions ?? [],
    permissions: overrides.permissions ?? [],
    schedules: overrides.schedules ?? [],
    subscriptions: overrides.subscriptions ?? [],
    provenance: overrides.provenance ?? { source: "manual" },
    lifecycle: overrides.lifecycle ?? { version: overrides.lifecycleVersion ?? 1 },
  };
}

function artifact(p: string, kind: ArtifactRef["kind"]): ArtifactRef {
  return {
    path: p,
    kind,
    createdAt: "2026-05-03T00:00:00.000Z",
  };
}
