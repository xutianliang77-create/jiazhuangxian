import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileDashboardStore } from "../../../../src/dashboards/store";
import type { DashboardDataset, DashboardPage } from "../../../../src/dashboards/types";
import { FileReportStore } from "../../../../src/reports/store";
import type { ReportArtifact, ReportDataset } from "../../../../src/reports/types";
import type { ToolRegistry } from "../../../../src/agent/tools/registry";
import type { PermissionManager } from "../../../../src/permissions/manager";
import type { WebServerHandle } from "../../../../src/channels/web/server";
import { startWebServer } from "../../../../src/channels/web/server";

const TOKEN = "test-token-aaaa1111";
const USER_ID = "web-test-tok";

let tmpRoot: string;
let handle: WebServerHandle;
let baseUrl: string;

beforeEach(async () => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-products-"));
  handle = await startWebServer({
    port: 0,
    auth: { bearerToken: TOKEN },
    artifactsRoot: tmpRoot,
    engineDefaults: {
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: "ws-1",
      sessionsDir: path.join(tmpRoot, "sessions"),
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

describe("Web server · reports API", () => {
  it("lists, reads, renders, exports, and upgrades owned reports", async () => {
    await new FileReportStore({ artifactsRoot: tmpRoot }).create(sampleReport());

    const list = await fetch(`${baseUrl}/v1/web/reports`, { headers: authHeaders() });
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown).toMatchObject({
      reports: [{ id: "report-1", title: "Food report" }],
    });

    const read = await fetch(`${baseUrl}/v1/web/reports/report-1`, { headers: authHeaders() });
    expect(read.status).toBe(200);
    expect((await read.json()) as unknown).toMatchObject({ report: { id: "report-1" } });

    const html = await fetch(`${baseUrl}/v1/web/reports/report-1/html`, { headers: authHeaders() });
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toMatch(/text\/html/);
    expect(await html.text()).toContain("Food report");
    expect((await new FileReportStore({ artifactsRoot: tmpRoot }).read("report-1")).exports).toEqual([]);

    const exported = await fetch(`${baseUrl}/v1/web/reports/report-1/export`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ format: "markdown" }),
    });
    expect(exported.status).toBe(200);
    expect((await exported.json()) as unknown).toMatchObject({
      artifact: { kind: "markdown" },
    });

    const upgraded = await fetch(`${baseUrl}/v1/web/reports/report-1/upgrade-dashboard`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ dashboardId: "dashboard-from-report", title: "Food dashboard" }),
    });
    expect(upgraded.status).toBe(201);
    expect((await upgraded.json()) as unknown).toMatchObject({
      dashboard: { id: "dashboard-from-report", sourceReportId: "report-1" },
    });
  });

  it("does not expose reports owned by another user", async () => {
    await new FileReportStore({ artifactsRoot: tmpRoot }).create({
      ...sampleReport(),
      owner: { type: "user", id: "other-user" },
    });

    const list = await fetch(`${baseUrl}/v1/web/reports`, { headers: authHeaders() });
    expect((await list.json()) as unknown).toMatchObject({ reports: [] });

    const read = await fetch(`${baseUrl}/v1/web/reports/report-1`, { headers: authHeaders() });
    expect(read.status).toBe(404);
  });

  it("shows reports created by a web chat session tool", async () => {
    const session = handle.store.create(USER_ID);
    const internal = (handle.store as unknown as {
      map: Map<string, { engine: { toolRegistry: ToolRegistry } }>;
    }).map.get(session.sessionId);
    expect(internal).toBeTruthy();

    const created = await internal!.engine.toolRegistry.invoke(
      "CreateReportArtifact",
      {
        id: "report-from-chat",
        title: "Chat-created report",
        question: "Analyze food sales",
        workspaceId: "ws-1",
        datasets: [
          {
            id: "dataset-1",
            name: "sales",
            previewRows: 5,
            columns: [{ name: "item_name", type: "VARCHAR" }],
          },
        ],
        provenance: { source: "manual", question: "Analyze food sales" },
      },
      {
        workspace: "ws-1",
        channel: "http",
        userId: USER_ID,
        artifactsRoot: tmpRoot,
        permissionManager: {} as PermissionManager,
      }
    );
    expect(created.ok).toBe(true);

    const list = await fetch(`${baseUrl}/v1/web/reports`, { headers: authHeaders() });
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown).toMatchObject({
      reports: [{ id: "report-from-chat", owner: { id: USER_ID } }],
    });
  });
});

describe("Web server · sessions API", () => {
  it("lists the last persisted web session after server restart", async () => {
    const created = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { sessionId: string };

    await handle.close();
    handle = await startWebServer({
      port: 0,
      auth: { bearerToken: TOKEN },
      artifactsRoot: tmpRoot,
      engineDefaults: {
        currentProvider: null,
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: "ws-1",
        sessionsDir: path.join(tmpRoot, "sessions"),
      },
    });
    baseUrl = `http://${handle.host}:${handle.port}`;

    const listed = await fetch(`${baseUrl}/v1/web/sessions`, { headers: authHeaders() });
    expect(listed.status).toBe(200);
    expect((await listed.json()) as unknown).toMatchObject({
      sessions: [{ sessionId: body.sessionId, userId: USER_ID }],
    });
    expect(handle.store.get(body.sessionId, USER_ID)).toBeTruthy();
  });

  it("persists web session title and transcript messages", async () => {
    const session = handle.store.create(USER_ID);
    handle.store.appendUserMessage(session.sessionId, USER_ID, "生成食品销量分析报表");

    const listed = await fetch(`${baseUrl}/v1/web/sessions`, { headers: authHeaders() });
    expect((await listed.json()) as unknown).toMatchObject({
      sessions: [{ sessionId: session.sessionId, title: "生成食品销量分析报表", messageCount: 1 }],
    });

    const messages = await fetch(`${baseUrl}/v1/web/sessions/${encodeURIComponent(session.sessionId)}/messages`, {
      headers: authHeaders(),
    });
    expect(messages.status).toBe(200);
    expect((await messages.json()) as unknown).toMatchObject({
      messages: [{ role: "user", text: "生成食品销量分析报表" }],
    });
  });
});

describe("Web server · dashboards API", () => {
  it("creates, lists, reads, validates, and renders dashboards", async () => {
    const created = await fetch(`${baseUrl}/v1/web/dashboards`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        id: "dashboard-1",
        title: "Food dashboard",
        datasets: [dashboardDataset()],
        pages: [dashboardPage()],
        provenance: { source: "manual" },
      }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()) as unknown).toMatchObject({
      dashboard: { id: "dashboard-1", owner: { id: USER_ID } },
    });

    const list = await fetch(`${baseUrl}/v1/web/dashboards`, { headers: authHeaders() });
    expect((await list.json()) as unknown).toMatchObject({
      dashboards: [{ id: "dashboard-1" }],
    });

    const validation = await fetch(`${baseUrl}/v1/web/dashboards/dashboard-1/validate`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(validation.status).toBe(200);
    expect((await validation.json()) as unknown).toMatchObject({ valid: true });

    const rendered = await fetch(`${baseUrl}/v1/web/dashboards/dashboard-1/render`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(rendered.status).toBe(200);
    expect((await rendered.json()) as unknown).toMatchObject({ artifact: { kind: "html" } });

    const html = await fetch(`${baseUrl}/v1/web/dashboards/dashboard-1/html`, {
      headers: authHeaders(),
    });
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Food dashboard");
  });

  it("does not expose dashboards owned by another user", async () => {
    await new FileDashboardStore({ artifactsRoot: tmpRoot }).create({
      version: 1,
      id: "dashboard-foreign",
      title: "Foreign",
      owner: { type: "user", id: "other-user" },
      workspaceId: "ws-1",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
      status: "draft",
      datasets: [dashboardDataset()],
      pages: [dashboardPage()],
      filters: [],
      parameters: [],
      interactions: [],
      permissions: [],
      schedules: [],
      subscriptions: [],
      provenance: { source: "manual" },
      lifecycle: { version: 1 },
    });

    const list = await fetch(`${baseUrl}/v1/web/dashboards`, { headers: authHeaders() });
    expect((await list.json()) as unknown).toMatchObject({ dashboards: [] });

    const read = await fetch(`${baseUrl}/v1/web/dashboards/dashboard-foreign`, {
      headers: authHeaders(),
    });
    expect(read.status).toBe(404);
  });
});

function sampleReport(): ReportArtifact {
  const now = "2026-05-03T00:00:00.000Z";
  return {
    version: 1,
    id: "report-1",
    title: "Food report",
    question: "Analyze food sales",
    owner: { type: "user", id: USER_ID },
    workspaceId: "ws-1",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    datasets: [reportDataset()],
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
    provenance: { source: "manual", question: "Analyze food sales" },
  };
}

function reportDataset(): ReportDataset {
  return {
    id: "dataset-1",
    name: "sales",
    sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
    previewRows: 5,
    columns: [{ name: "item_name", type: "VARCHAR" }, { name: "quantity", type: "INTEGER" }],
    provenance: {
      sql: "select item_name, sum(quantity) as quantity from sales group by item_name",
      ruleCheck: { passed: true, errors: [], warnings: [] },
    },
  };
}

function dashboardDataset(): DashboardDataset {
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

function dashboardPage(): DashboardPage {
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
