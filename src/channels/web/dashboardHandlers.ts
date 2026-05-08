import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { DashboardService } from "../../dashboards/service";
import { FileDashboardStore } from "../../dashboards/store";
import type { DashboardListQuery, DashboardSpec } from "../../dashboards/types";
import type { PrincipalRef } from "../../reports/types";
import { authenticate, jsonResponse, readJsonBody, type HandlerDeps } from "./handlers";

function dashboardService(deps: HandlerDeps): DashboardService {
  return new DashboardService(new FileDashboardStore({ artifactsRoot: deps.artifactsRoot }), {
    artifactsRoot: deps.artifactsRoot,
  });
}

function owner(userId: string): PrincipalRef {
  return { type: "user", id: userId };
}

function ownsDashboard(dashboard: DashboardSpec, userId: string): boolean {
  return dashboard.owner.id === userId;
}

function listLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : undefined;
}

async function readOwnedDashboard(
  service: DashboardService,
  id: string,
  userId: string,
  res: ServerResponse
): Promise<DashboardSpec | null> {
  try {
    const dashboard = await service.read(id);
    if (!ownsDashboard(dashboard, userId)) {
      jsonResponse(res, 404, { error: "dashboard not found" });
      return null;
    }
    return dashboard;
  } catch (err) {
    jsonResponse(res, 404, { error: "dashboard not found", detail: String(err) });
    return null;
  }
}

export async function handleListDashboards(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const query: DashboardListQuery = {
    ownerId: auth.userId,
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    status: (url.searchParams.get("status") as DashboardSpec["status"] | null) ?? undefined,
    limit: listLimit(url),
  };
  jsonResponse(res, 200, await dashboardService(deps).list(query));
}

export async function handleCreateDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  let body: Omit<Parameters<DashboardService["create"]>[0], "owner" | "workspaceId"> & {
    owner?: PrincipalRef;
    workspaceId?: string;
  };
  try {
    body = await readJsonBody(req, 1024 * 1024);
  } catch (err) {
    jsonResponse(res, 400, { error: "bad request", detail: String(err) });
    return;
  }
  try {
    const dashboard = await dashboardService(deps).create({
      ...body,
      owner: owner(auth.userId),
      workspaceId: body.workspaceId ?? deps.workspace ?? "default",
    });
    jsonResponse(res, 201, { dashboard });
  } catch (err) {
    jsonResponse(res, 400, { error: "invalid dashboard", detail: String(err) });
  }
}

export async function handleReadDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  dashboardId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const dashboard = await readOwnedDashboard(dashboardService(deps), dashboardId, auth.userId, res);
  if (!dashboard) return;
  jsonResponse(res, 200, { dashboard });
}

export async function handleReadDashboardHtml(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  dashboardId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = dashboardService(deps);
  const dashboard = await readOwnedDashboard(service, dashboardId, auth.userId, res);
  if (!dashboard) return;
  const ref = await service.renderHtml(dashboard.id);
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(await readFile(ref.path, "utf8"));
}

export async function handleRenderDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  dashboardId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = dashboardService(deps);
  const dashboard = await readOwnedDashboard(service, dashboardId, auth.userId, res);
  if (!dashboard) return;
  const artifact = await service.renderHtml(dashboard.id);
  jsonResponse(res, 200, { artifact });
}

export async function handleValidateDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  dashboardId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = dashboardService(deps);
  const dashboard = await readOwnedDashboard(service, dashboardId, auth.userId, res);
  if (!dashboard) return;
  jsonResponse(res, 200, await service.validate(dashboard.id));
}
