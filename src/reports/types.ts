import type { ChartQualityReview, ChartSpec } from "../charts/types";

export interface PrincipalRef {
  type: "user" | "service" | "team";
  id: string;
  displayName?: string;
}

export interface ArtifactRef {
  path: string;
  kind: "json" | "markdown" | "html" | "png" | "pdf" | "pptx" | "text";
  bytes?: number;
  sha256?: string;
  createdAt: string;
}

export interface SqlProvenance {
  sql: string;
  queryId?: string;
  mcpServer?: string;
  toolName?: string;
  generatedBy?: {
    provider?: string;
    model?: string;
  };
  ruleCheck?: {
    passed: boolean;
    errors: string[];
    warnings: string[];
  };
  preview?: {
    rows: number;
    rowCount?: number;
    truncated: boolean;
  };
  artifacts?: {
    preview?: ArtifactRef;
    result?: ArtifactRef;
  };
}

export interface DataCaveat {
  code:
    | "metadata_incomplete"
    | "permission_limited"
    | "stale_artifact"
    | "preview_truncated"
    | "semantic_uncertain"
    | "chart_inferred";
  message: string;
}

export interface ReportColumn {
  name: string;
  type?: string;
  businessName?: string;
}

export interface ReportDataset {
  id: string;
  name: string;
  sql?: string;
  queryId?: string;
  previewRows: number;
  rowCount?: number;
  columns: ReportColumn[];
  previewArtifact?: ArtifactRef;
  resultArtifact?: ArtifactRef;
  provenance?: SqlProvenance;
}

export interface ReportChart {
  id: string;
  title: string;
  datasetId: string;
  chart: ChartSpec;
  chartArgsArtifact?: ArtifactRef;
  imageArtifact?: ArtifactRef;
  htmlArtifact?: ArtifactRef;
  quality?: ChartQualityReview;
}

export interface ReportSection {
  id: string;
  title: string;
  markdown: string;
  datasetIds?: string[];
  chartIds?: string[];
}

export interface ReportInsight {
  id: string;
  title?: string;
  markdown: string;
  datasetIds?: string[];
  chartIds?: string[];
}

export interface ReportExport {
  id: string;
  format: "markdown" | "html" | "pdf" | "pptx" | "json";
  artifact: ArtifactRef;
}

export interface ReportProvenance {
  source: "llm" | "tool" | "manual";
  question: string;
  sessionId?: string;
  traceId?: string;
  model?: string;
  provider?: string;
  toolCalls?: Array<{
    name: string;
    inputSummary?: string;
    outputArtifact?: ArtifactRef;
  }>;
}

export interface ReportUpgradeState {
  dashboardId?: string;
  upgradedAt?: string;
  upgradedBy?: PrincipalRef;
}

export interface ReportArtifact {
  version: 1;
  id: string;
  title: string;
  question: string;
  owner: PrincipalRef;
  workspaceId: string;
  sessionId?: string;
  traceId?: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "reviewed" | "shared" | "archived";
  datasets: ReportDataset[];
  charts: ReportChart[];
  sections: ReportSection[];
  insights: ReportInsight[];
  caveats: DataCaveat[];
  exports: ReportExport[];
  provenance: ReportProvenance;
  upgrade?: ReportUpgradeState;
}

export interface ReportAuditEvent {
  id: string;
  reportId: string;
  actor: PrincipalRef;
  action: "create" | "update" | "read" | "render" | "export" | "upgrade" | "archive";
  at: string;
  details?: Record<string, unknown>;
}

export interface ReportListQuery {
  ownerId?: string;
  workspaceId?: string;
  status?: ReportArtifact["status"];
  limit?: number;
}

export interface ReportListResult {
  reports: ReportArtifact[];
}

export interface ReportStore {
  create(report: ReportArtifact): Promise<ReportArtifact>;
  update(report: ReportArtifact): Promise<ReportArtifact>;
  read(id: string): Promise<ReportArtifact>;
  list(query?: ReportListQuery): Promise<ReportListResult>;
  writeExport(id: string, exportRef: ArtifactRef): Promise<void>;
  appendAudit(id: string, event: ReportAuditEvent): Promise<void>;
}
