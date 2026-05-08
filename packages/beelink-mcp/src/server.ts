import { loadConfig } from "./config";
import {
  formatCatalog,
  formatExploreForQuestion,
  formatObjectDescription,
  formatSemanticSearch,
  formatTableOrViewLineage,
  formatUsefulSystemTableNames,
  formatInitSemanticLayer,
  formatMetadataSearch,
  formatMetadataSync,
  formatQueryPreview,
  formatSqlExportArtifact,
  formatSchema,
  formatSqlGuidance,
  formatSqlRepair,
  formatSqlRuleCheck,
} from "./formatter";
import { exploreForQuestion } from "./exploreForQuestion";
import { MetadataStore } from "./metadataStore";
import { syncMetadataIndex } from "./metadataSync";
import { BeelinkPlatformClient } from "./platformClient";
import { initSemanticLayerDraft } from "./semanticDraft";
import { assertReadOnlySql } from "./sqlGuard";
import { prepareSqlReference } from "./sqlReference";
import { repairSqlAttempt } from "./sqlRepair";
import { buildSqlGuidance, checkSqlAgainstRules } from "./sqlRules";
import type { BeelinkConfig, ToolCallResult, ToolDescriptor } from "./types";

const TOOLS: ToolDescriptor[] = [
  {
    name: "ListCatalogEntries",
    description: "List catalog entries under an optional path prefix.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional catalog path, for example @x or space.folder." },
        limit: { type: "number", description: "Maximum entries to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "GetSchemaOfTable",
    description: "Return the schema for a table or view.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Catalog path of the table or view." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "GetDescriptionOfTableOrSchema",
    description:
      "Return local metadata description for a table, view, schema, or catalog path, including business names, descriptions, samples, and permission caveats.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Catalog path of the table, view, schema, or folder." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "GetTableOrViewLineage",
    description:
      "Return normalized upstream/downstream lineage for a table or view when lineage metadata is available; otherwise return a clear caveat.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Catalog path of the table or view." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "PrepareSqlReference",
    description: "Convert a catalog path into a SQL-safe reference by quoting special path segments.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Catalog path, for example @x.chatbi_food_sales." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "SyncMetadataIndex",
    description:
      "Pull catalog and table schema metadata into the local project-level beelink metadata index.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional root catalog paths to sync. Omit to start from catalog root.",
        },
        maxDepth: { type: "number", description: "How many child levels to traverse. Defaults to 2." },
        limitPerNode: { type: "number", description: "Maximum children fetched for each catalog node." },
        pruneStale: {
          type: "boolean",
          description: "Remove cached catalog objects under the synced roots that were not seen in this sync. Defaults to true for root sync.",
        },
        refreshSemantic: {
          type: "boolean",
          description: "Regenerate semantic-layer.json and glossary.md from current metadata. Defaults to true.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "InitSemanticLayer",
    description:
      "Create draft semantic-layer.json and glossary.md from local metadata hints. Existing files are not overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum table profiles to inspect." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "SearchMetadataIndex",
    description:
      "Search the local beelink metadata index for candidate tables and columns before generating SQL.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Business term, table name, or column keyword." },
        limit: { type: "number", description: "Maximum objects and columns to return." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "RunSemanticSearch",
    description:
      "Use natural language to browse semantic layer, glossary, local metadata, and optional upstream catalog candidates. This does not execute SQL.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language term or data question." },
        limit: { type: "number", description: "Maximum semantic and metadata candidates to return." },
        probeIfEmpty: {
          type: "boolean",
          description: "When true, probe upstream catalog if local semantic/metadata context is empty.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "ExploreForQuestion",
    description:
      "Build SQL-planning context for a natural-language data question from semantic layer, local metadata, and optional upstream probe.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural-language data question." },
        limit: { type: "number", description: "Maximum semantic and metadata candidates to return." },
        probeIfEmpty: {
          type: "boolean",
          description: "When true, probe upstream catalog if local semantic/metadata context is empty.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "GetUsefulSystemTableNames",
    description:
      "List useful INFORMATION_SCHEMA and sys tables for metadata, jobs, permissions, lineage-adjacent discovery, and operational diagnostics.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "BuildSqlGuidance",
    description:
      "Build SQL-writing guidance from semantic layer, local metadata, and SQL rules. This does not generate or execute SQL.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural-language data question." },
        limit: { type: "number", description: "Maximum semantic and metadata candidates to return." },
        probeIfEmpty: {
          type: "boolean",
          description: "When true, probe upstream catalog if local semantic/metadata context is empty.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "CheckSqlAgainstRules",
    description:
      "Check generated SQL for obvious safety, quoting, preview, and aggregation issues. This does not execute SQL.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Generated SQL to check before execution." },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    name: "RepairSqlAttempt",
    description:
      "Classify a failed SQL attempt, suggest repair actions, optionally quote special references, and optionally supplement metadata context. This does not execute SQL.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "The failed SQL statement." },
        error: { type: "string", description: "The upstream SQL error message." },
        question: { type: "string", description: "Optional original user question for supplemental exploration." },
        limit: { type: "number", description: "Maximum semantic and metadata candidates to return." },
        probeIfNeeded: {
          type: "boolean",
          description: "When true, run supplemental exploration for metadata/permission/unknown failures.",
        },
      },
      required: ["sql", "error"],
      additionalProperties: false,
    },
  },
  {
    name: "RunSqlQuery",
    description: "Execute one read-only SQL statement and return a small preview for review.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Read-only SQL statement." },
        previewRows: { type: "number", description: "Preview row count. Defaults to BEELINK_PREVIEW_ROWS." },
        timeoutMs: { type: "number", description: "Query wait timeout in milliseconds." },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    name: "ExportSqlArtifact",
    description:
      "Execute one read-only SQL statement, page through results up to a hard row cap, and save a JSON result artifact for reports.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Read-only SQL statement." },
        maxRows: { type: "number", description: "Hard export row cap. Defaults to BEELINK_EXPORT_MAX_ROWS." },
        pageRows: { type: "number", description: "Rows fetched per upstream results page." },
        previewRows: { type: "number", description: "Preview row count included in the tool response." },
        timeoutMs: { type: "number", description: "Query wait timeout in milliseconds." },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
];

export class BeelinkMcpServer {
  private readonly config: BeelinkConfig;
  private readonly client: BeelinkPlatformClient;

  constructor(config: BeelinkConfig = loadConfig(), client = new BeelinkPlatformClient(config)) {
    this.config = config;
    this.client = client;
  }

  listTools(): ToolDescriptor[] {
    return TOOLS;
  }

  async callTool(name: string, args: unknown): Promise<ToolCallResult> {
    try {
      const input = asRecord(args);
      switch (name) {
        case "ListCatalogEntries": {
          const entries = await this.client.listCatalogEntries({
            path: optionalString(input.path),
            limit: optionalPositiveInt(input.limit),
          });
          return text(formatCatalog(entries));
        }
        case "GetSchemaOfTable": {
          const path = requiredString(input.path, "path");
          const schema = await this.client.getSchemaOfTable(path);
          return text(formatSchema(schema.path, schema.columns));
        }
        case "GetDescriptionOfTableOrSchema": {
          const path = requiredString(input.path, "path");
          const store = new MetadataStore(this.config.metadataDbPath);
          try {
            await this.refreshObjectMetadata(path, store);
            const profile = store.getObjectProfile(path);
            if (profile) return text(formatObjectDescription(profile));
          } finally {
            store.close();
          }
          const schema = await this.client.getSchemaOfTable(path);
          return text(
            formatObjectDescription({
              path: schema.path,
              name: schema.path.split(".").at(-1) ?? schema.path,
              type: "unknown",
              permissionStatus: "live-upstream",
              columns: schema.columns.map((column) => ({
                columnName: column.name,
                dataType: column.type,
                ...(column.nullable === undefined ? {} : { nullable: column.nullable }),
                ...(column.description ? { description: column.description } : {}),
                ...(column.businessName ? { businessName: column.businessName } : {}),
                ...(column.sampleValues ? { sampleValues: column.sampleValues } : {}),
                ...(column.headerConfidence === undefined ? {} : { headerConfidence: column.headerConfidence }),
              })),
            })
          );
        }
        case "GetTableOrViewLineage": {
          const path = requiredString(input.path, "path");
          const store = new MetadataStore(this.config.metadataDbPath);
          try {
            let liveLineageError: string | undefined;
            try {
              const lineage = await this.client.getTableOrViewLineage(path);
              store.upsertCatalogObjects([{ name: path.split(".").at(-1) ?? path, path, type: "unknown", id: lineage.objectId }]);
              store.replaceLineage(path, lineage);
            } catch (err) {
              // Return cached lineage/caveat when the upstream lineage endpoint is unavailable or permission-gated.
              liveLineageError = err instanceof Error ? err.message : String(err);
            }
            const lineage = store.getLineage(path);
            if (liveLineageError && lineage.sources.length + lineage.parents.length + lineage.children.length === 0) {
              lineage.caveats.push(`Live lineage refresh failed or is permission-gated: ${liveLineageError}`);
            }
            return text(formatTableOrViewLineage(lineage));
          } finally {
            store.close();
          }
        }
        case "PrepareSqlReference": {
          const path = requiredString(input.path, "path");
          return text(prepareSqlReference(path));
        }
        case "SyncMetadataIndex": {
          const result = await syncMetadataIndex(this.client, this.config, {
            paths: optionalStringArray(input.paths),
            maxDepth: optionalPositiveInt(input.maxDepth),
            limitPerNode: optionalPositiveInt(input.limitPerNode),
            pruneStale: optionalBoolean(input.pruneStale),
            refreshSemantic: optionalBoolean(input.refreshSemantic),
          });
          return text(formatMetadataSync(result));
        }
        case "InitSemanticLayer": {
          const store = new MetadataStore(this.config.metadataDbPath);
          try {
            const result = initSemanticLayerDraft(this.config, store.listTableProfiles(optionalPositiveInt(input.limit) ?? 50));
            return text(formatInitSemanticLayer(result));
          } finally {
            store.close();
          }
        }
        case "SearchMetadataIndex": {
          const query = requiredString(input.query, "query");
          const limit = optionalPositiveInt(input.limit) ?? 20;
          const store = new MetadataStore(this.config.metadataDbPath);
          try {
            return text(formatMetadataSearch(store.search(query, Math.min(limit, 100))));
          } finally {
            store.close();
          }
        }
        case "RunSemanticSearch": {
          const query = requiredString(input.query, "query");
          const result = await exploreForQuestion(this.client, this.config, {
            question: query,
            limit: optionalPositiveInt(input.limit),
            probeIfEmpty: optionalBoolean(input.probeIfEmpty) ?? true,
          });
          return text(formatSemanticSearch(result));
        }
        case "ExploreForQuestion": {
          const question = requiredString(input.question, "question");
          const result = await exploreForQuestion(this.client, this.config, {
            question,
            limit: optionalPositiveInt(input.limit),
            probeIfEmpty: optionalBoolean(input.probeIfEmpty) ?? true,
          });
          return text(formatExploreForQuestion(result));
        }
        case "GetUsefulSystemTableNames": {
          return text(formatUsefulSystemTableNames());
        }
        case "BuildSqlGuidance": {
          const question = requiredString(input.question, "question");
          const result = await buildSqlGuidance(this.client, this.config, {
            question,
            limit: optionalPositiveInt(input.limit),
            probeIfEmpty: optionalBoolean(input.probeIfEmpty) ?? true,
          });
          return text(formatSqlGuidance(result));
        }
        case "CheckSqlAgainstRules": {
          const sql = requiredString(input.sql, "sql");
          return text(formatSqlRuleCheck(checkSqlAgainstRules({ sql })));
        }
        case "RepairSqlAttempt": {
          const sql = requiredString(input.sql, "sql");
          const error = requiredString(input.error, "error");
          const result = await repairSqlAttempt(this.client, this.config, {
            sql,
            error,
            question: optionalString(input.question),
            limit: optionalPositiveInt(input.limit),
            probeIfNeeded: optionalBoolean(input.probeIfNeeded) ?? true,
          });
          return text(formatSqlRepair(result));
        }
        case "RunSqlQuery": {
          const sql = assertReadOnlySql(requiredString(input.sql, "sql"));
          const previewRows = Math.min(
            optionalPositiveInt(input.previewRows) ?? this.config.previewRows,
            this.config.maxPreviewRows
          );
          const timeoutMs = optionalPositiveInt(input.timeoutMs) ?? this.config.timeoutMs;
          const preview = await this.client.runSqlQuery({ sql, previewRows, timeoutMs });
          return text(formatQueryPreview(preview));
        }
        case "ExportSqlArtifact": {
          const sql = assertReadOnlySql(requiredString(input.sql, "sql"));
          const previewRows = Math.min(
            optionalPositiveInt(input.previewRows) ?? this.config.previewRows,
            this.config.maxPreviewRows
          );
          const maxRows = Math.min(optionalPositiveInt(input.maxRows) ?? this.config.exportMaxRows, this.config.exportMaxRows);
          const pageRows = Math.min(optionalPositiveInt(input.pageRows) ?? this.config.exportPageRows, this.config.exportMaxRows);
          const timeoutMs = optionalPositiveInt(input.timeoutMs) ?? this.config.timeoutMs;
          const exported = await this.client.exportSqlArtifact({
            sql,
            previewRows,
            maxRows,
            pageRows,
            timeoutMs,
            artifactsRoot: this.config.artifactsRoot,
          });
          return text(formatSqlExportArtifact(exported));
        }
        default:
          return text(`unknown tool: ${name}`, true);
      }
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }

  private async refreshObjectMetadata(path: string, store: MetadataStore): Promise<void> {
    try {
      const entry = await this.client.getCatalogEntry(path);
      store.upsertCatalogObjects([entry]);
    } catch {
      // A direct schema fallback can still describe accessible tables even when catalog metadata is limited.
    }
    try {
      const collaboration = await this.client.getCollaboration(path);
      store.updateObjectCollaboration(path, collaboration);
    } catch {
      // Labels/wiki are optional and permission-dependent.
    }
  }
}

function text(value: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return out.length > 0 ? out : undefined;
}
