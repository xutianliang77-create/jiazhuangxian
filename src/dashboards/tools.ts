import type { ToolDefinition, ToolRegistry } from "../agent/tools/registry";
import { FileReportStore } from "../reports/store";
import { FileDashboardStore } from "./store";
import { DashboardService, type CreateDashboardInput } from "./service";
import { upgradeReportToDashboard } from "./upgrade";
import type { DashboardListQuery } from "./types";
import type { PrincipalRef } from "../reports/types";

export interface RegisterDashboardToolsOptions {
  artifactsRoot?: string;
}

export const DASHBOARD_TOOL_NAMES = [
  "UpgradeReportToDashboard",
  "CreateDashboardSpec",
  "ValidateDashboardSpec",
  "RenderDashboardHtml",
  "ReadDashboard",
  "ListDashboards",
] as const;

export function createDashboardToolDefinitions(options: RegisterDashboardToolsOptions = {}): ToolDefinition[] {
  const dashboardStore = new FileDashboardStore({ artifactsRoot: options.artifactsRoot });
  const reportStore = new FileReportStore({ artifactsRoot: options.artifactsRoot });
  const service = new DashboardService(dashboardStore, { artifactsRoot: options.artifactsRoot });
  return [
    {
      name: "UpgradeReportToDashboard",
      description: "Upgrade an existing CodeClaw ReportArtifact into a draft DashboardSpec.",
      inputSchema: {
        type: "object",
        properties: {
          reportId: { type: "string" },
          dashboardId: { type: "string" },
          title: { type: "string" },
          owner: { type: "object" },
          workspaceId: { type: "string" },
          includeChartIds: { type: "array" },
          refreshMode: { type: "string" },
        },
        required: ["reportId"],
        additionalProperties: false,
      },
      async invoke(args, ctx) {
        const input = asRecord(args);
        const dashboard = await upgradeReportToDashboard(
          {
            reportId: requiredString(input.reportId, "reportId"),
            ...(typeof input.dashboardId === "string" ? { dashboardId: input.dashboardId } : {}),
            ...(typeof input.title === "string" ? { title: input.title } : {}),
            owner: ownerForContext(ctx.userId, input.owner),
            workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : ctx.workspace,
            includeChartIds: stringArray(input.includeChartIds),
            refreshMode: input.refreshMode === "scheduled" ? "scheduled" : "manual",
            ...(options.artifactsRoot ? { artifactsRoot: options.artifactsRoot } : {}),
          },
          { reportStore, dashboardStore }
        );
        return { ok: true, content: formatDashboardToolResult("Dashboard created", dashboard) };
      },
    },
    {
      name: "CreateDashboardSpec",
      description: "Create a CodeClaw DashboardSpec draft from datasets, pages, filters, and provenance.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          owner: { type: "object" },
          workspaceId: { type: "string" },
          sourceReportId: { type: "string" },
          datasets: { type: "array" },
          pages: { type: "array" },
          filters: { type: "array" },
          parameters: { type: "array" },
          interactions: { type: "array" },
          provenance: { type: "object" },
        },
        required: ["title", "datasets", "pages", "provenance"],
        additionalProperties: false,
      },
      async invoke(args, ctx) {
        const input = asRecord(args);
        const dashboard = await service.create({
          ...(typeof input.id === "string" ? { id: input.id } : {}),
          title: requiredString(input.title, "title"),
          ...(typeof input.description === "string" ? { description: input.description } : {}),
          owner: ownerForContext(ctx.userId, input.owner),
          workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : ctx.workspace,
          ...(typeof input.sourceReportId === "string" ? { sourceReportId: input.sourceReportId } : {}),
          datasets: arrayOrEmpty(input.datasets) as CreateDashboardInput["datasets"],
          pages: arrayOrEmpty(input.pages) as CreateDashboardInput["pages"],
          filters: arrayOrEmpty(input.filters) as CreateDashboardInput["filters"],
          parameters: arrayOrEmpty(input.parameters) as CreateDashboardInput["parameters"],
          interactions: arrayOrEmpty(input.interactions) as CreateDashboardInput["interactions"],
          provenance: input.provenance as CreateDashboardInput["provenance"],
        });
        return { ok: true, content: formatDashboardToolResult("Dashboard created", dashboard) };
      },
    },
    {
      name: "ValidateDashboardSpec",
      description: "Validate a saved DashboardSpec by id.",
      inputSchema: {
        type: "object",
        properties: {
          dashboardId: { type: "string" },
        },
        required: ["dashboardId"],
        additionalProperties: false,
      },
      async invoke(args) {
        const validation = await service.validate(requiredString(asRecord(args).dashboardId, "dashboardId"));
        return { ok: validation.valid, content: JSON.stringify(validation, null, 2), isError: !validation.valid };
      },
    },
    {
      name: "RenderDashboardHtml",
      description: "Render a saved DashboardSpec into a local HTML artifact and return its path.",
      inputSchema: {
        type: "object",
        properties: {
          dashboardId: { type: "string" },
        },
        required: ["dashboardId"],
        additionalProperties: false,
      },
      async invoke(args) {
        const artifact = await service.renderHtml(requiredString(asRecord(args).dashboardId, "dashboardId"));
        return { ok: true, content: `Dashboard HTML: ${artifact.path}` };
      },
    },
    {
      name: "ReadDashboard",
      description: "Read a saved CodeClaw DashboardSpec JSON by id.",
      inputSchema: {
        type: "object",
        properties: {
          dashboardId: { type: "string" },
        },
        required: ["dashboardId"],
        additionalProperties: false,
      },
      async invoke(args) {
        const dashboard = await service.read(requiredString(asRecord(args).dashboardId, "dashboardId"));
        return { ok: true, content: JSON.stringify(dashboard, null, 2) };
      },
    },
    {
      name: "ListDashboards",
      description: "List saved CodeClaw dashboards, optionally filtered by owner, workspace, status, or limit.",
      inputSchema: {
        type: "object",
        properties: {
          ownerId: { type: "string" },
          workspaceId: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      async invoke(args) {
        const input = asRecord(args);
        const result = await service.list({
          ...(typeof input.ownerId === "string" ? { ownerId: input.ownerId } : {}),
          ...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
          ...(typeof input.status === "string" ? { status: input.status as DashboardListQuery["status"] } : {}),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        });
        return { ok: true, content: JSON.stringify(result, null, 2) };
      },
    },
  ];
}

export function registerDashboardTools(registry: ToolRegistry, options: RegisterDashboardToolsOptions = {}): void {
  for (const tool of createDashboardToolDefinitions(options)) registry.register(tool);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return out.length > 0 ? out : undefined;
}

function asOwner(value: unknown): PrincipalRef | undefined {
  const record = asRecord(value);
  if (
    (record.type === "user" || record.type === "service" || record.type === "team") &&
    typeof record.id === "string"
  ) {
    return {
      type: record.type,
      id: record.id,
      ...(typeof record.displayName === "string" ? { displayName: record.displayName } : {}),
    };
  }
  return undefined;
}

function ownerForContext(userId: string | undefined, value: unknown): PrincipalRef {
  if (userId) return { type: "user", id: userId };
  return asOwner(value) ?? { type: "user", id: "local" };
}

function formatDashboardToolResult(prefix: string, dashboard: Awaited<ReturnType<DashboardService["create"]>>): string {
  const widgets = dashboard.pages.reduce((count, page) => count + page.widgets.length, 0);
  const charts = dashboard.pages.reduce(
    (count, page) => count + page.widgets.filter((widget) => widget.type === "chart").length,
    0
  );
  return [
    `${prefix}: ${dashboard.id}`,
    `charts=${charts}`,
    `widgets=${widgets}`,
    `pages=${dashboard.pages.length}`,
    `datasets=${dashboard.datasets.length}`,
  ].join("\n");
}
