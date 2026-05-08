import type { ChartQualityReview, ChartSpec } from "../charts/types";
import type { ArtifactRef, DataCaveat, PrincipalRef, SqlProvenance } from "../reports/types";

export interface DashboardColumn {
  name: string;
  type?: string;
  businessName?: string;
  semanticRole?: "dimension" | "measure" | "time" | "id" | "geo" | "unknown";
}

export interface DashboardDatasetSafety {
  readOnlyChecked: boolean;
  maxRows: number;
  upstreamPermissions: "current-user" | "publisher" | "unknown";
  piiClassification?: "none" | "possible" | "sensitive";
}

export interface DashboardRefreshPolicy {
  mode: "manual" | "scheduled" | "event";
  scheduleId?: string;
  lastRunAt?: string;
  queryId?: string;
}

export interface DashboardDataset {
  id: string;
  name: string;
  kind: "sql" | "artifact" | "semantic_metric" | "external_mcp";
  sql?: string;
  rows?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  preview?: Array<Record<string, unknown>>;
  sourceArtifact?: ArtifactRef;
  resultArtifact?: ArtifactRef;
  previewRows: number;
  rowCount?: number;
  columns: DashboardColumn[];
  refresh: DashboardRefreshPolicy;
  safety: DashboardDatasetSafety;
  provenance?: SqlProvenance;
}

export interface DashboardPage {
  id: string;
  title: string;
  order: number;
  layout: {
    columns: number;
    rowHeight: number;
    responsive: boolean;
  };
  widgets: DashboardWidget[];
}

export interface DashboardWidget {
  id: string;
  type: "chart" | "table" | "metric" | "text" | "image" | "insight" | "forecast" | "anomaly" | "ask";
  title: string;
  datasetId?: string;
  layout: { x: number; y: number; w: number; h: number };
  chart?: ChartSpec;
  text?: string;
  caveats?: DataCaveat[];
  interactions?: string[];
  quality?: ChartQualityReview;
}

export interface DashboardFilter {
  id: string;
  title: string;
  datasetId: string;
  field: string;
  type: "single_select" | "multi_select" | "date_range" | "number_range" | "text";
  defaultValue?: unknown;
}

export interface DashboardParameter {
  id: string;
  name: string;
  type: "string" | "number" | "date" | "date_range" | "enum";
  defaultValue?: unknown;
  allowedValues?: unknown[];
}

export interface DashboardInteraction {
  id: string;
  type: "cross_filter" | "drill_through" | "open_link" | "ask_followup";
  sourceWidgetId: string;
  targetWidgetIds?: string[];
  targetPageId?: string;
  fieldMappings: Array<{ sourceField: string; targetField: string }>;
}

export type DashboardRole = "owner" | "editor" | "viewer" | "publisher" | "admin";

export interface DashboardPermission {
  principal: PrincipalRef;
  role: DashboardRole;
  grantedBy: PrincipalRef;
  grantedAt: string;
}

export interface DashboardSchedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  datasets: string[];
  credentialMode: "current-user" | "publisher" | "service";
  enabled: boolean;
}

export interface DashboardSubscription {
  id: string;
  principal: PrincipalRef;
  channel: "email" | "wechat" | "slack" | "webhook" | "api";
  scheduleId: string;
  format: "summary" | "html" | "pdf" | "pptx" | "json";
  enabled: boolean;
}

export interface DashboardProvenance {
  source: "report_upgrade" | "llm" | "manual";
  sourceReportId?: string;
  question?: string;
  sessionId?: string;
  traceId?: string;
  model?: string;
  provider?: string;
}

export interface DashboardLifecycle {
  version: number;
  publishedAt?: string;
  publishedBy?: PrincipalRef;
  archivedAt?: string;
  archivedBy?: PrincipalRef;
}

export interface DashboardSpec {
  version: 1;
  id: string;
  title: string;
  description?: string;
  owner: PrincipalRef;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "published" | "archived";
  sourceReportId?: string;
  datasets: DashboardDataset[];
  pages: DashboardPage[];
  filters: DashboardFilter[];
  parameters: DashboardParameter[];
  interactions: DashboardInteraction[];
  permissions: DashboardPermission[];
  schedules: DashboardSchedule[];
  subscriptions: DashboardSubscription[];
  provenance: DashboardProvenance;
  lifecycle: DashboardLifecycle;
}

export interface DashboardAuditEvent {
  id: string;
  dashboardId: string;
  actor: PrincipalRef;
  action:
    | "create"
    | "update"
    | "read"
    | "render"
    | "publish"
    | "share"
    | "refresh"
    | "export"
    | "ask"
    | "archive";
  at: string;
  queryId?: string;
  artifactPath?: string;
  model?: string;
  details?: Record<string, unknown>;
}

export interface DashboardVersion {
  version: number;
  artifact: ArtifactRef;
  createdAt: string;
}

export interface DashboardListQuery {
  ownerId?: string;
  workspaceId?: string;
  status?: DashboardSpec["status"];
  limit?: number;
}

export interface DashboardListResult {
  dashboards: DashboardSpec[];
}

export interface DashboardStore {
  create(spec: DashboardSpec): Promise<DashboardSpec>;
  update(spec: DashboardSpec): Promise<DashboardSpec>;
  read(id: string): Promise<DashboardSpec>;
  list(query?: DashboardListQuery): Promise<DashboardListResult>;
  writeVersion(spec: DashboardSpec): Promise<DashboardVersion>;
  appendAudit(id: string, event: DashboardAuditEvent): Promise<void>;
}
