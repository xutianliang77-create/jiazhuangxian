import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultArtifactsRoot } from "../agent/tools/artifact";
import { createDashboardId } from "./ids";
import { renderDashboardHtml } from "./renderHtml";
import { validateDashboardSpec, type DashboardValidationResult } from "./validate";
import type {
  DashboardDataset,
  DashboardFilter,
  DashboardInteraction,
  DashboardListQuery,
  DashboardListResult,
  DashboardPage,
  DashboardParameter,
  DashboardProvenance,
  DashboardSpec,
  DashboardStore,
  DashboardWidget,
} from "./types";
import type { ArtifactRef, PrincipalRef } from "../reports/types";

export interface CreateDashboardInput {
  id?: string;
  title: string;
  description?: string;
  owner: PrincipalRef;
  workspaceId: string;
  sourceReportId?: string;
  datasets: DashboardDataset[];
  pages: DashboardPage[];
  filters?: DashboardFilter[];
  parameters?: DashboardParameter[];
  interactions?: DashboardInteraction[];
  provenance: DashboardProvenance;
}

export interface DashboardServiceOptions {
  artifactsRoot?: string;
  now?: () => Date;
}

export class DashboardService {
  private readonly artifactsRoot: string;
  private readonly now: () => Date;

  constructor(private readonly store: DashboardStore, options: DashboardServiceOptions = {}) {
    this.artifactsRoot = path.resolve(options.artifactsRoot ?? defaultArtifactsRoot());
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateDashboardInput): Promise<DashboardSpec> {
    const now = this.nowIso();
    const dashboard: DashboardSpec = {
      version: 1,
      id: input.id ?? createDashboardId(),
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      owner: input.owner,
      workspaceId: input.workspaceId,
      createdAt: now,
      updatedAt: now,
      status: "draft",
      ...(input.sourceReportId ? { sourceReportId: input.sourceReportId } : {}),
      datasets: normalizeDashboardDatasets(input.datasets),
      pages: normalizeDashboardPages(input.pages),
      filters: input.filters ?? [],
      parameters: input.parameters ?? [],
      interactions: input.interactions ?? [],
      permissions: [],
      schedules: [],
      subscriptions: [],
      provenance: input.provenance,
      lifecycle: { version: 1 },
    };
    this.assertValid(dashboard);
    await this.store.create(dashboard);
    await this.store.writeVersion(dashboard);
    await this.store.appendAudit(dashboard.id, {
      id: `audit-${Date.now()}`,
      dashboardId: dashboard.id,
      actor: dashboard.owner,
      action: "create",
      at: now,
    });
    return dashboard;
  }

  async validate(idOrSpec: string | DashboardSpec): Promise<DashboardValidationResult> {
    const spec = typeof idOrSpec === "string" ? await this.store.read(idOrSpec) : idOrSpec;
    return validateDashboardSpec(spec, { artifactsRoot: this.artifactsRoot });
  }

  async renderHtml(id: string): Promise<ArtifactRef> {
    const dashboard = await this.store.read(id);
    this.assertValid(dashboard);
    const content = renderDashboardHtml(dashboard);
    const file = path.join(this.artifactsRoot, "dashboards", id, "dashboard.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
    await this.store.appendAudit(id, {
      id: `audit-${Date.now()}`,
      dashboardId: id,
      actor: dashboard.owner,
      action: "render",
      at: this.nowIso(),
      artifactPath: file,
    });
    return {
      path: file,
      kind: "html",
      bytes: Buffer.byteLength(content, "utf8"),
      createdAt: this.nowIso(),
    };
  }

  async read(id: string): Promise<DashboardSpec> {
    return this.store.read(id);
  }

  async list(query: DashboardListQuery = {}): Promise<DashboardListResult> {
    return this.store.list(query);
  }

  private assertValid(dashboard: DashboardSpec): void {
    const validation = validateDashboardSpec(dashboard, { artifactsRoot: this.artifactsRoot });
    if (!validation.valid) {
      throw new Error(`invalid dashboard: ${validation.errors.join("; ")}`);
    }
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

function normalizeDashboardDatasets(datasets: DashboardDataset[]): DashboardDataset[] {
  return datasets.map((dataset) => {
    const hasSql = Boolean(dataset.sql);
    return {
      ...dataset,
      kind: dataset.kind ?? (hasSql ? "sql" : "artifact"),
      previewRows: dataset.previewRows ?? dataset.provenance?.preview?.rows ?? 0,
      columns: dataset.columns ?? [],
      refresh: dataset.refresh ?? {
        mode: "manual",
        ...(dataset.provenance?.queryId ? { queryId: dataset.provenance.queryId } : {}),
      },
      safety: dataset.safety ?? {
        readOnlyChecked: Boolean(dataset.provenance?.ruleCheck?.passed ?? !hasSql),
        maxRows: dataset.rowCount ?? dataset.provenance?.preview?.rowCount ?? 1000,
        upstreamPermissions: "current-user",
      },
    };
  });
}

function normalizeDashboardPages(pages: DashboardPage[]): DashboardPage[] {
  return pages.map((page, pageIndex) => ({
    ...page,
    id: page.id || `page-${pageIndex + 1}`,
    title: page.title || `Page ${pageIndex + 1}`,
    order: page.order ?? pageIndex + 1,
    layout: page.layout ?? { columns: 12, rowHeight: 80, responsive: true },
    widgets: page.widgets.map(normalizeDashboardWidget),
  }));
}

function normalizeDashboardWidget(widget: DashboardWidget, index: number): DashboardWidget {
  const record = widget as unknown as Record<string, unknown>;
  const type = widget.type ?? (widget.chart || record.kind === "chart" ? "chart" : "text");
  return {
    ...widget,
    id: widget.id || `widget-${index + 1}`,
    type,
    title: widget.title || `Widget ${index + 1}`,
    layout: widget.layout ?? { x: 0, y: index * 4, w: 6, h: 4 },
    ...(type === "chart" ? { chart: widget.chart ?? { kind: "bar" } } : {}),
  };
}
