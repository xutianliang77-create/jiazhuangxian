import type {
  CatalogEntry,
  ExploreForQuestionResult,
  MetadataObjectProfile,
  MetadataSearchResult,
  MetadataSyncResult,
  InitSemanticLayerResult,
  QueryPreview,
  SemanticEntity,
  SemanticMetric,
  SqlExportArtifact,
  SqlGuidanceResult,
  SqlRepairResult,
  SqlRuleCheckResult,
  TableLineage,
  TableColumn,
} from "./types";
import { prepareSqlReference } from "./sqlReference";

export function formatCatalog(entries: CatalogEntry[]): string {
  if (entries.length === 0) return "No catalog entries found.";
  return entries.map((entry) => `- ${entry.path} [${entry.type}]`).join("\n");
}

export function formatSchema(path: string, columns: TableColumn[]): string {
  if (columns.length === 0) return `Schema for ${path}: no columns returned.`;
  return [
    `Schema for ${path}`,
    "",
    "| column | type | nullable |",
    "| --- | --- | --- |",
    ...columns.map((c) => `| ${escapeCell(c.name)} | ${escapeCell(c.type)} | ${c.nullable ?? ""} |`),
  ].join("\n");
}

export function formatObjectDescription(profile: MetadataObjectProfile): string {
  const lines = [
    "Object description",
    `path: ${profile.path}`,
    `name: ${profile.name}`,
    `type: ${profile.type}`,
    `permission-status: ${profile.permissionStatus ?? "unknown"}`,
  ];
  if (profile.id) lines.push(`id: ${profile.id}`);
  if (profile.tag) lines.push(`object-tag: ${profile.tag}`);
  if (profile.createdAt) lines.push(`created-at: ${profile.createdAt}`);
  if (profile.tags?.length) lines.push(`labels: ${profile.tags.join(", ")}`);
  if (profile.tagsVersion) lines.push(`labels-version: ${profile.tagsVersion}`);
  if (profile.wikiText) {
    lines.push("", "Wiki / description:", profile.wikiText.slice(0, 1600));
    if (profile.wikiVersion) lines.push(`wiki-version: ${profile.wikiVersion}`);
  }

  if (profile.columns.length === 0) {
    lines.push("", "Columns: none returned or not synced.");
  } else {
    lines.push(
      "",
      "Columns:",
      "| column | business | type | nullable | description | samples |",
      "| --- | --- | --- | --- | --- | --- |",
      ...profile.columns.map(
        (column) =>
          `| ${escapeCell(column.columnName)} | ${escapeCell(column.businessName ?? "")} | ${escapeCell(
            column.dataType
          )} | ${column.nullable ?? ""} | ${escapeCell(column.description ?? "")} | ${escapeCell(
            (column.sampleValues ?? []).join(", ")
          )} |`
      )
    );
  }

  lines.push(
    "",
    "Notes:",
    "- This description is built from the local metadata index and synced schema fields.",
    "- If business descriptions or tags are empty, sync metadata first or curate semantic-layer.json/glossary.md."
  );
  return lines.join("\n");
}

export function formatTableOrViewLineage(lineage: TableLineage): string {
  const lines = [
    "Table/view lineage",
    `path: ${lineage.path}`,
    ...(lineage.objectId ? [`object-id: ${lineage.objectId}`] : []),
    ...(lineage.fetchedAt ? [`fetched-at: ${new Date(lineage.fetchedAt).toISOString()}`] : []),
    "",
    "Upstream:",
    ...formatLineageNodes([...lineage.sources, ...lineage.parents]),
    "",
    "Downstream:",
    ...formatLineageNodes(lineage.children),
  ];
  if (lineage.caveats.length > 0) {
    lines.push("", "Caveats:", ...lineage.caveats.map((caveat) => `- ${caveat}`));
  }
  lines.push(
    "",
    "Notes:",
    "- Do not infer joins or lineage from similarly named columns unless the user asks for hypothesis-based analysis.",
    "- If lineage is empty, sync metadata again or check whether the upstream platform exposes lineage for this object."
  );
  return lines.join("\n");
}

export function formatQueryPreview(preview: QueryPreview): string {
  const lines = [
    `Query preview rows: ${preview.rows.length}`,
    `Truncated: ${preview.truncated ? "yes" : "no"}`,
    ...(typeof preview.rowCount === "number" ? [`Row count: ${preview.rowCount}`] : []),
    `Query id: ${preview.queryId}`,
  ];
  if (preview.rows.length === 0) return lines.join("\n");
  const columns = preview.columns.length > 0 ? preview.columns.map((c) => c.name) : Object.keys(preview.rows[0] ?? {});
  lines.push("", `| ${columns.map(escapeCell).join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of preview.rows) {
    lines.push(`| ${columns.map((name) => escapeCell(stringifyCell(row[name]))).join(" | ")} |`);
  }
  return lines.join("\n");
}

export function formatSqlExportArtifact(result: SqlExportArtifact): string {
  const lines = [
    "SQL export complete",
    `Query id: ${result.queryId}`,
    `Exported rows: ${result.exportedRows}`,
    ...(typeof result.rowCount === "number" ? [`Row count: ${result.rowCount}`] : []),
    `Truncated: ${result.truncated ? "yes" : "no"}`,
    `Artifact: ${result.artifact.path}`,
    `Artifact bytes: ${result.artifact.bytes}`,
    "",
    "Report usage:",
    "- Use this artifact as dataset.resultArtifact and provenance.artifacts.result in CreateReportArtifact.",
    "- Inline dataset rows should be a small preview only; the JSON artifact is the bounded source of truth.",
  ];
  if (result.previewRows.length === 0) return lines.join("\n");
  const columns = result.columns.length > 0 ? result.columns.map((c) => c.name) : Object.keys(result.previewRows[0] ?? {});
  lines.push("", `Preview rows: ${result.previewRows.length}`, `| ${columns.map(escapeCell).join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of result.previewRows) {
    lines.push(`| ${columns.map((name) => escapeCell(stringifyCell(row[name]))).join(" | ")} |`);
  }
  return lines.join("\n");
}

export function formatMetadataSync(result: MetadataSyncResult): string {
  return [
    "Metadata sync complete",
    `db: ${result.dbPath}`,
    `scanned-objects: ${result.scannedObjects}`,
    `synced-objects: ${result.syncedObjects}`,
    ...(typeof result.prunedObjects === "number" ? [`pruned-objects: ${result.prunedObjects}`] : []),
    `synced-columns: ${result.syncedColumns}`,
    ...(typeof result.syncedDescriptions === "number" ? [`synced-descriptions: ${result.syncedDescriptions}`] : []),
    ...(typeof result.syncedLineageEdges === "number" ? [`synced-lineage-edges: ${result.syncedLineageEdges}`] : []),
    `inferred-headers: ${result.inferredHeaders}`,
    ...(result.semanticDraft
      ? [
          `semantic-layer-created: ${result.semanticDraft.semanticLayerCreated ? "yes" : "no"}`,
          `glossary-created: ${result.semanticDraft.glossaryCreated ? "yes" : "no"}`,
          `semantic-layer-updated: ${result.semanticDraft.semanticLayerUpdated ? "yes" : "no"}`,
          `glossary-updated: ${result.semanticDraft.glossaryUpdated ? "yes" : "no"}`,
          `semantic-layer: ${result.semanticDraft.semanticLayerPath}`,
          `glossary: ${result.semanticDraft.glossaryPath}`,
        ]
      : []),
  ].join("\n");
}

export function formatInitSemanticLayer(result: InitSemanticLayerResult): string {
  return [
    "Semantic layer draft",
    `semantic-layer: ${result.semanticLayerPath}`,
    `glossary: ${result.glossaryPath}`,
    `semantic-layer-created: ${result.semanticLayerCreated ? "yes" : "no"}`,
    `glossary-created: ${result.glossaryCreated ? "yes" : "no"}`,
    `semantic-layer-updated: ${result.semanticLayerUpdated ? "yes" : "no"}`,
    `glossary-updated: ${result.glossaryUpdated ? "yes" : "no"}`,
    `tables: ${result.tableCount}`,
    `metrics: ${result.metricCount}`,
    `entities: ${result.entityCount}`,
  ].join("\n");
}

export function formatMetadataSearch(result: MetadataSearchResult): string {
  const lines = [`Metadata index: ${result.dbPath}`];
  lines.push("", "Objects:");
  if (result.objects.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...result.objects.map((entry) => `- ${entry.path} [${entry.type}]`));
  }

  lines.push("", "Columns:");
  if (result.columns.length === 0) {
    lines.push("- none");
  } else {
    lines.push(
      "| table | column | business | type | samples | nullable |",
      "| --- | --- | --- | --- | --- | --- |",
      ...result.columns.map(
        (column) =>
          `| ${escapeCell(column.objectPath)} | ${escapeCell(column.columnName)} | ${escapeCell(
            column.businessName ?? ""
          )} | ${escapeCell(column.dataType)} | ${escapeCell((column.sampleValues ?? []).join(", "))} | ${
            column.nullable ?? ""
          } |`
      )
    );
  }
  return lines.join("\n");
}

export function formatExploreForQuestion(result: ExploreForQuestionResult): string {
  const lines = [
    `Question: ${result.question}`,
    `Metadata index: ${result.metadata.dbPath}`,
    `Semantic layer: ${result.semantic.semanticLayerPath}`,
    `Glossary: ${result.semantic.glossaryPath}`,
  ];

  lines.push("", "Semantic metrics:");
  lines.push(
    result.semantic.metrics.length === 0
      ? "- none"
      : result.semantic.metrics.map(formatMetric).join("\n")
  );

  lines.push("", "Semantic entities:");
  lines.push(
    result.semantic.entities.length === 0
      ? "- none"
      : result.semantic.entities.map(formatEntity).join("\n")
  );

  if (result.semantic.glossaryExcerpt) {
    lines.push("", "Glossary excerpt:", result.semantic.glossaryExcerpt);
  }

  lines.push("", formatMetadataSearch(result.metadata));

  if (result.upstreamProbe) {
    lines.push(
      "",
      "Upstream probe:",
      `attempted: ${result.upstreamProbe.attempted ? "yes" : "no"}`,
      result.upstreamProbe.entries.length === 0
        ? "entries: none"
        : ["entries:", ...result.upstreamProbe.entries.map((entry) => `- ${entry.path} [${entry.type}]`)].join("\n")
    );
  }

  lines.push(
    "",
    "Next step: use the semantic matches and metadata candidates to draft read-only SQL, then call PrepareSqlReference and RunSqlQuery."
  );
  return lines.join("\n");
}

export function formatSemanticSearch(result: ExploreForQuestionResult): string {
  const lines = [
    "Semantic search",
    `question: ${result.question}`,
    `metadata-index: ${result.metadata.dbPath}`,
    `semantic-layer: ${result.semantic.semanticLayerPath}`,
    `glossary: ${result.semantic.glossaryPath}`,
  ];

  lines.push("", "Matched metrics:");
  lines.push(
    result.semantic.metrics.length === 0
      ? "- none"
      : result.semantic.metrics.map(formatMetric).join("\n")
  );

  lines.push("", "Matched entities:");
  lines.push(
    result.semantic.entities.length === 0
      ? "- none"
      : result.semantic.entities.map(formatEntity).join("\n")
  );

  if (result.semantic.glossaryExcerpt) {
    lines.push("", "Glossary excerpt:", result.semantic.glossaryExcerpt);
  }

  lines.push("", "Candidate objects:");
  lines.push(
    result.metadata.objects.length === 0
      ? "- none"
      : result.metadata.objects.map((entry) => `- ${entry.path} [${entry.type}]`).join("\n")
  );

  lines.push("", "Candidate columns:");
  if (result.metadata.columns.length === 0) {
    lines.push("- none");
  } else {
    lines.push(
      "| table | column | business | type | samples |",
      "| --- | --- | --- | --- | --- |",
      ...result.metadata.columns.map(
        (column) =>
          `| ${escapeCell(column.objectPath)} | ${escapeCell(column.columnName)} | ${escapeCell(
            column.businessName ?? ""
          )} | ${escapeCell(column.dataType)} | ${escapeCell((column.sampleValues ?? []).join(", "))} |`
      )
    );
  }

  if (result.upstreamProbe) {
    lines.push(
      "",
      "Upstream probe:",
      `attempted: ${result.upstreamProbe.attempted ? "yes" : "no"}`,
      result.upstreamProbe.entries.length === 0
        ? "entries: none"
        : ["entries:", ...result.upstreamProbe.entries.map((entry) => `- ${entry.path} [${entry.type}]`)].join("\n")
    );
  }

  lines.push("", "Next step: call GetSchemaOfTable for the selected object, then draft read-only SQL if needed.");
  return lines.join("\n");
}

export function formatUsefulSystemTableNames(): string {
  return [
    "Useful system tables",
    "",
    "INFORMATION_SCHEMA:",
    "- INFORMATION_SCHEMA.CATALOGS - catalogs visible to the current user.",
    "- INFORMATION_SCHEMA.SCHEMATA - schemas/spaces visible to the current user.",
    "- INFORMATION_SCHEMA.TABLES - tables and views visible to the current user.",
    "- INFORMATION_SCHEMA.COLUMNS - column names and types for visible tables.",
    "- INFORMATION_SCHEMA.VIEWS - view metadata when available.",
    "",
    "sys:",
    "- sys.jobs or sys.jobs_recent - recent query/job history and active users when permitted.",
    "- sys.nodes - cluster node metadata when permitted.",
    "- sys.options - runtime/system options when permitted.",
    "- sys.reflections - acceleration/reflection metadata when permitted.",
    "- sys.materializations - materialization status when permitted.",
    "- sys.privileges - privileges; often requires elevated permissions.",
    "- sys.roles - roles; often requires elevated permissions.",
    "- sys.membership - user/role membership; often requires elevated permissions.",
    "- sys.version - engine version details.",
    "",
    "Notes:",
    "- Always add a LIMIT when previewing system tables.",
    "- If a sys table returns permission errors, fall back to INFORMATION_SCHEMA or summarize the permission caveat.",
  ].join("\n");
}

export function formatSqlGuidance(result: SqlGuidanceResult): string {
  const candidateReferences = collectCandidateReferences(result.exploration);
  const lines = [
    "SQL guidance",
    "",
    "Question:",
    result.question,
    "",
    "Recommended core tool path:",
    "1. RunSemanticSearch for candidate datasets and business terms.",
    "2. GetDescriptionOfTableOrSchema for the selected table/schema.",
    "3. BuildSqlGuidance before drafting SQL.",
    "4. CheckSqlAgainstRules before execution.",
    "5. RunSqlQuery with a bounded preview.",
    "",
    "Candidate SQL references:",
    ...(candidateReferences.length === 0
      ? ["- none; run RunSemanticSearch or GetDescriptionOfTableOrSchema first"]
      : candidateReferences.map(({ path, sqlReference }) => `- ${path} -> ${sqlReference}`)),
    "",
    "Candidate fields:",
    ...formatCandidateFields(result.exploration),
    "",
    "Context:",
    formatExploreForQuestion(result.exploration),
    "",
    "Rules:",
    ...result.rules.map((rule) => `- ${rule}`),
    "",
    "Execution guardrails:",
    "- Prefer the candidate SQL references above instead of raw catalog paths.",
    "- If the SQL mentions @-prefixed or special-character paths, call CheckSqlAgainstRules before RunSqlQuery.",
    "- If RunSqlQuery fails, call RepairSqlAttempt with the failed SQL, error, and original question.",
    "- If the SQL succeeds but the user says the answer is wrong, rerun RunSemanticSearch/BuildSqlGuidance to revisit business meaning and filters before retrying.",
  ];
  return lines.join("\n");
}

export function formatSqlRuleCheck(result: SqlRuleCheckResult): string {
  const lines = ["SQL rule check", "", "Errors:"];
  lines.push(result.errors.length === 0 ? "- none" : result.errors.map((error) => `- ${error}`).join("\n"));
  lines.push("", "Warnings:");
  lines.push(result.warnings.length === 0 ? "- none" : result.warnings.map((warning) => `- ${warning}`).join("\n"));
  lines.push("", "Suggested fixes:");
  lines.push(
    result.suggestedFixes.length === 0
      ? "- none"
      : result.suggestedFixes.map((fix) => `- ${fix}`).join("\n")
  );
  return lines.join("\n");
}

export function formatSqlRepair(result: SqlRepairResult): string {
  const lines = [
    "SQL repair attempt",
    "",
    `category: ${result.category}`,
    `error: ${result.error}`,
  ];
  if (result.repairedSql) {
    lines.push("", "Repaired SQL candidate:", "```sql", result.repairedSql, "```");
  }
  lines.push("", formatSqlRuleCheck(result.ruleCheck));
  lines.push("", "Suggested actions:");
  lines.push(...result.suggestedActions.map((action) => `- ${action}`));
  if (result.exploration) {
    lines.push("", "Supplemental exploration:", formatExploreForQuestion(result.exploration));
  }
  return lines.join("\n");
}

function formatMetric(metric: SemanticMetric): string {
  const parts = [`- ${metric.name}`];
  if (metric.table) parts.push(`table=${metric.table}`);
  if (metric.dimensions?.length) parts.push(`dimensions=${metric.dimensions.join(", ")}`);
  if (metric.measures?.length) {
    parts.push(`measures=${metric.measures.map((m) => `${m.name}:${m.expression}`).join(", ")}`);
  }
  if (metric.defaultOrderBy) parts.push(`order=${metric.defaultOrderBy}`);
  return parts.join(" | ");
}

function formatEntity(entity: SemanticEntity): string {
  const parts = [`- ${entity.name}`];
  if (entity.candidateTables?.length) parts.push(`tables=${entity.candidateTables.join(", ")}`);
  return parts.join(" | ");
}

function formatLineageNodes(nodes: TableLineage["sources"]): string[] {
  if (nodes.length === 0) return ["- none recorded"];
  return nodes.map((node) => {
    const parts = [`- ${node.path}`, `[${node.type}]`];
    if (node.id) parts.push(`id=${node.id}`);
    if (node.tag) parts.push(`tag=${node.tag}`);
    return parts.join(" ");
  });
}

function collectCandidateReferences(result: ExploreForQuestionResult): Array<{ path: string; sqlReference: string }> {
  const paths = new Set<string>();
  for (const object of result.metadata.objects) {
    if (object.type === "table" || object.type === "view" || object.type === "unknown") paths.add(object.path);
  }
  for (const metric of result.semantic.metrics) {
    if (metric.table) paths.add(metric.table);
  }
  for (const entity of result.semantic.entities) {
    for (const table of entity.candidateTables ?? []) paths.add(table);
  }
  return Array.from(paths)
    .slice(0, 10)
    .map((path) => ({ path, sqlReference: safeSqlReference(path) }));
}

function formatCandidateFields(result: ExploreForQuestionResult): string[] {
  if (result.metadata.columns.length === 0) return ["- none; inspect schema before inventing columns"];
  return result.metadata.columns.slice(0, 20).map((column) => {
    const business = column.businessName ? ` business=${column.businessName}` : "";
    const samples = column.sampleValues?.length ? ` samples=${column.sampleValues.slice(0, 3).join(", ")}` : "";
    return `- ${column.objectPath}.${column.columnName}${business} type=${column.dataType}${samples}`;
  });
}

function safeSqlReference(path: string): string {
  try {
    return prepareSqlReference(path);
  } catch {
    return path;
  }
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
