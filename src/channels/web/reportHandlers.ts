import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { FileDashboardStore } from "../../dashboards/store";
import { upgradeReportToDashboard } from "../../dashboards/upgrade";
import { FileReportStore } from "../../reports/store";
import { ReportService } from "../../reports/service";
import type { PrincipalRef, ReportArtifact } from "../../reports/types";
import { authenticate, jsonResponse, readJsonBody, type HandlerDeps } from "./handlers";

function reportService(deps: HandlerDeps): ReportService {
  return new ReportService(new FileReportStore({ artifactsRoot: deps.artifactsRoot }), {
    artifactsRoot: deps.artifactsRoot,
  });
}

function dashboardStore(deps: HandlerDeps): FileDashboardStore {
  return new FileDashboardStore({ artifactsRoot: deps.artifactsRoot });
}

function owner(userId: string): PrincipalRef {
  return { type: "user", id: userId };
}

function ownsReport(report: ReportArtifact, userId: string): boolean {
  return report.owner.id === userId;
}

function listLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : undefined;
}

async function readOwnedReport(
  service: ReportService,
  id: string,
  userId: string,
  res: ServerResponse
): Promise<ReportArtifact | null> {
  try {
    const report = await service.read(id);
    if (!ownsReport(report, userId)) {
      jsonResponse(res, 404, { error: "report not found" });
      return null;
    }
    return report;
  } catch (err) {
    jsonResponse(res, 404, { error: "report not found", detail: String(err) });
    return null;
  }
}

export async function handleListReports(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  url: URL
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = reportService(deps);
  const result = await service.list({
    ownerId: auth.userId,
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    status: (url.searchParams.get("status") as ReportArtifact["status"] | null) ?? undefined,
    limit: listLimit(url),
  });
  jsonResponse(res, 200, result);
}

export async function handleReadReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  reportId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = reportService(deps);
  const report = await readOwnedReport(service, reportId, auth.userId, res);
  if (!report) return;
  jsonResponse(res, 200, { report });
}

export async function handleReadReportHtml(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  reportId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = reportService(deps);
  const report = await readOwnedReport(service, reportId, auth.userId, res);
  if (!report) return;
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(await service.renderHtmlContent(report.id));
}

export async function handleExportReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  reportId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = reportService(deps);
  const report = await readOwnedReport(service, reportId, auth.userId, res);
  if (!report) return;
  let body: { format?: "html" | "markdown" };
  try {
    body = await readJsonBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: "bad request", detail: String(err) });
    return;
  }
  const format = body.format ?? "html";
  if (format !== "html" && format !== "markdown") {
    jsonResponse(res, 400, { error: "unsupported report export format" });
    return;
  }
  const artifact = await service.exportReport(report.id, format);
  jsonResponse(res, 200, { artifact });
}

export async function handleUpgradeReportToDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
  reportId: string
): Promise<void> {
  const auth = authenticate(req, res, deps);
  if (!auth) return;
  const service = reportService(deps);
  const report = await readOwnedReport(service, reportId, auth.userId, res);
  if (!report) return;
  let body: {
    dashboardId?: string;
    title?: string;
    workspaceId?: string;
    includeChartIds?: string[];
    refreshMode?: "manual" | "scheduled";
  };
  try {
    body = await readJsonBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: "bad request", detail: String(err) });
    return;
  }
  const dashboard = await upgradeReportToDashboard(
    {
      reportId: report.id,
      dashboardId: body.dashboardId,
      title: body.title,
      owner: owner(auth.userId),
      workspaceId: body.workspaceId ?? report.workspaceId,
      includeChartIds: body.includeChartIds,
      refreshMode: body.refreshMode,
      ...(deps.artifactsRoot ? { artifactsRoot: deps.artifactsRoot } : {}),
    },
    {
      reportStore: new FileReportStore({ artifactsRoot: deps.artifactsRoot }),
      dashboardStore: dashboardStore(deps),
    }
  );
  jsonResponse(res, 201, { dashboard });
}
