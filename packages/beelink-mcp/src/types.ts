export interface BeelinkConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  previewRows: number;
  maxPreviewRows: number;
  artifactsRoot: string;
  exportMaxRows: number;
  exportPageRows: number;
  metadataDbPath: string;
  semanticLayerPath: string;
  glossaryPath: string;
}

export interface CatalogEntry {
  id?: string;
  name: string;
  path: string;
  type: "source" | "space" | "folder" | "schema" | "table" | "view" | "unknown";
  tag?: string;
  createdAt?: string;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string;
  businessName?: string;
  sampleValues?: string[];
  headerConfidence?: number;
}

export interface QueryPreview {
  queryId: string;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
  truncated: boolean;
}

export interface SqlArtifactRef {
  path: string;
  kind: "json";
  bytes: number;
  createdAt: string;
}

export interface SqlExportArtifact {
  queryId: string;
  sql: string;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  previewRows: Array<Record<string, unknown>>;
  exportedRows: number;
  rowCount?: number;
  truncated: boolean;
  artifact: SqlArtifactRef;
}

export interface MetadataSyncResult {
  dbPath: string;
  scannedObjects: number;
  syncedObjects: number;
  prunedObjects?: number;
  syncedColumns: number;
  syncedDescriptions?: number;
  syncedLineageEdges?: number;
  inferredHeaders: number;
  semanticDraft?: InitSemanticLayerResult;
}

export interface MetadataSearchResult {
  dbPath: string;
  objects: CatalogEntry[];
  columns: Array<{
    objectPath: string;
    columnName: string;
    dataType: string;
    nullable?: boolean;
    description?: string;
    businessName?: string;
    sampleValues?: string[];
    headerConfidence?: number;
  }>;
}

export interface MetadataTableProfile {
  path: string;
  name: string;
  type: CatalogEntry["type"];
  columns: Array<{
    columnName: string;
    dataType: string;
    businessName?: string;
    sampleValues?: string[];
  }>;
}

export interface MetadataObjectProfile {
  id?: string;
  path: string;
  name: string;
  type: CatalogEntry["type"];
  tag?: string;
  createdAt?: string;
  permissionStatus?: string;
  tags?: string[];
  tagsVersion?: string;
  wikiText?: string;
  wikiVersion?: string;
  columns: Array<{
    columnName: string;
    dataType: string;
    nullable?: boolean;
    description?: string;
    businessName?: string;
    sampleValues?: string[];
    headerConfidence?: number;
  }>;
}

export interface CatalogCollaboration {
  tags?: string[];
  tagsVersion?: string;
  wikiText?: string;
  wikiVersion?: string;
}

export interface LineageNode {
  id?: string;
  path: string;
  type: CatalogEntry["type"];
  tag?: string;
  createdAt?: string;
}

export interface TableLineage {
  path: string;
  objectId?: string;
  fetchedAt?: number;
  sources: LineageNode[];
  parents: LineageNode[];
  children: LineageNode[];
  caveats: string[];
}

export interface InitSemanticLayerResult {
  semanticLayerPath: string;
  glossaryPath: string;
  semanticLayerCreated: boolean;
  glossaryCreated: boolean;
  semanticLayerUpdated?: boolean;
  glossaryUpdated?: boolean;
  tableCount: number;
  metricCount: number;
  entityCount: number;
}

export interface SemanticMetric {
  name: string;
  aliases?: string[];
  table?: string;
  dimensions?: string[];
  measures?: Array<{ name: string; expression: string }>;
  defaultOrderBy?: string;
}

export interface SemanticEntity {
  name: string;
  aliases?: string[];
  candidateTables?: string[];
}

export interface SemanticSearchResult {
  semanticLayerPath: string;
  glossaryPath: string;
  metrics: SemanticMetric[];
  entities: SemanticEntity[];
  glossaryExcerpt?: string;
}

export interface ExploreForQuestionResult {
  question: string;
  semantic: SemanticSearchResult;
  metadata: MetadataSearchResult;
  upstreamProbe?: {
    attempted: boolean;
    entries: CatalogEntry[];
  };
}

export interface SqlGuidanceResult {
  question: string;
  exploration: ExploreForQuestionResult;
  rules: string[];
}

export interface SqlRuleCheckResult {
  sql: string;
  errors: string[];
  warnings: string[];
  suggestedFixes: string[];
}

export interface SqlRepairResult {
  category:
    | "sql_reference"
    | "metadata_missing"
    | "aggregation"
    | "permission"
    | "timeout"
    | "syntax"
    | "safety"
    | "unknown";
  sql: string;
  error: string;
  repairedSql?: string;
  ruleCheck: SqlRuleCheckResult;
  suggestedActions: string[];
  exploration?: ExploreForQuestionResult;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
