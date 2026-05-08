import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BeelinkConfig,
  CatalogCollaboration,
  CatalogEntry,
  QueryPreview,
  SqlExportArtifact,
  TableColumn,
  TableLineage,
} from "./types";

interface CatalogObject {
  id?: string;
  tag?: string;
  createdAt?: string;
  path?: string[];
  name?: string;
  type?: string;
  containerType?: string;
  children?: CatalogObject[];
  fields?: Array<Record<string, unknown>>;
}

interface JobStatusResponse {
  id?: string;
  jobState?: string;
  rowCount?: number;
  errorMessage?: string;
}

interface JobResultsResponse {
  rowCount?: number;
  columns?: Array<Record<string, unknown>>;
  rows?: unknown[];
}

const SUCCESS_STATES = new Set(["COMPLETED", "COMPLETED_WITH_WARNINGS"]);
const FAILURE_STATES = new Set(["FAILED", "CANCELED", "CANCELLATION_REQUESTED"]);

export class BeelinkPlatformClient {
  private sessionToken: string | null = null;
  private authStyle: "bearer" | "legacy" = "bearer";

  constructor(
    private readonly config: BeelinkConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async listCatalogEntries(input: { path?: string; limit?: number }): Promise<CatalogEntry[]> {
    if (!input.path?.trim()) {
      const payload = await this.fetchJson("/api/v3/catalog");
      const objects = Array.isArray(payload.data)
        ? (payload.data as CatalogObject[])
        : Array.isArray(payload)
          ? (payload as CatalogObject[])
          : [];
      return normalizeCatalogEntries(objects, input.limit);
    }

    const object = await this.resolveCatalogObject(input.path.trim());
    return normalizeCatalogEntries(Array.isArray(object.children) ? object.children : [], input.limit);
  }

  async searchCatalog(input: { query: string; limit?: number }): Promise<CatalogEntry[]> {
    const query = input.query.trim();
    if (!query) return [];

    try {
      const payload = await this.fetchJson(`/api/v3/catalog/search?query=${encodeURIComponent(query)}`);
      const objects = Array.isArray(payload.data)
        ? (payload.data as CatalogObject[])
        : Array.isArray(payload.results)
          ? (payload.results as CatalogObject[])
          : [];
      const entries = normalizeCatalogEntries(objects, input.limit);
      if (entries.length > 0) return entries;
    } catch {
      // Fall back to root filtering for versions without catalog search.
    }

    const rootEntries = await this.listCatalogEntries({ limit: Math.max(input.limit ?? 20, 50) });
    const lowered = query.toLowerCase();
    return rootEntries
      .filter((entry) => entry.name.toLowerCase().includes(lowered) || entry.path.toLowerCase().includes(lowered))
      .slice(0, input.limit ?? 20);
  }

  async getSchemaOfTable(path: string): Promise<{ path: string; columns: TableColumn[] }> {
    const object = await this.resolveCatalogObject(path);
    return {
      path: normalizePath(object) ?? path,
      columns: (object.fields ?? []).map(normalizeColumn),
    };
  }

  async getCatalogEntry(path: string): Promise<CatalogEntry> {
    return normalizeCatalogEntry(await this.resolveCatalogObject(path));
  }

  async getCollaboration(path: string): Promise<CatalogCollaboration> {
    const object = await this.resolveCatalogObject(path);
    if (!object.id) throw new Error(`catalog object id not returned for ${path}`);
    const [tags, wiki] = await Promise.all([
      this.fetchJson(`/api/v3/catalog/${encodeURIComponent(object.id)}/collaboration/tag`).catch(() => ({})),
      this.fetchJson(`/api/v3/catalog/${encodeURIComponent(object.id)}/collaboration/wiki`).catch(() => ({})),
    ]);
    return {
      ...normalizeTags(tags),
      ...normalizeWiki(wiki),
    };
  }

  async getTableOrViewLineage(path: string): Promise<TableLineage> {
    const object = await this.resolveCatalogObject(path);
    const normalized = normalizeCatalogEntry(object);
    if (!normalized.id) throw new Error(`catalog object id not returned for ${path}`);
    const payload = await this.fetchJson(`/api/v3/catalog/${encodeURIComponent(normalized.id)}/graph`);
    return normalizeLineagePayload(payload, normalized);
  }

  async runSqlQuery(input: { sql: string; previewRows: number; timeoutMs: number }): Promise<QueryPreview> {
    const queryId = await this.submitSql(input.sql);
    const status = await this.waitForQuery(queryId, input.timeoutMs);
    const results = await this.fetchQueryResults(queryId, 0, input.previewRows);
    const rows = normalizeRows(results.rows);
    const columns = normalizeResultColumns(results.columns, rows);
    const rowCount = typeof results.rowCount === "number" ? results.rowCount : status.rowCount;
    return {
      queryId,
      columns,
      rows,
      ...(typeof rowCount === "number" ? { rowCount } : {}),
      truncated: typeof rowCount === "number" ? rowCount > rows.length : rows.length >= input.previewRows,
    };
  }

  async exportSqlArtifact(input: {
    sql: string;
    previewRows: number;
    maxRows: number;
    pageRows: number;
    timeoutMs: number;
    artifactsRoot: string;
  }): Promise<SqlExportArtifact> {
    const queryId = await this.submitSql(input.sql);
    const status = await this.waitForQuery(queryId, input.timeoutMs);
    const rows: Array<Record<string, unknown>> = [];
    let columns: Array<{ name: string; type: string }> = [];
    let rowCount = status.rowCount;
    let offset = 0;
    const pageRows = Math.max(1, input.pageRows);
    const maxRows = Math.max(1, input.maxRows);

    while (rows.length < maxRows) {
      const limit = Math.min(pageRows, maxRows - rows.length);
      const results = await this.fetchQueryResults(queryId, offset, limit);
      const page = normalizeRows(results.rows);
      if (columns.length === 0) columns = normalizeResultColumns(results.columns, page);
      if (typeof results.rowCount === "number") rowCount = results.rowCount;
      rows.push(...page);
      offset += page.length;
      if (page.length < limit) break;
      if (typeof rowCount === "number" && rows.length >= rowCount) break;
    }

    if (columns.length === 0) columns = inferColumns(rows);
    const truncated = typeof rowCount === "number" ? rows.length < rowCount : rows.length >= maxRows;
    const artifactDir = path.join(input.artifactsRoot, "beelink-mcp");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `${queryId}.json`);
    const createdAt = new Date().toISOString();
    const body = JSON.stringify(
      {
        kind: "beelink-sql-result",
        createdAt,
        queryId,
        sql: input.sql,
        columns,
        rows,
        exportedRows: rows.length,
        ...(typeof rowCount === "number" ? { rowCount } : {}),
        truncated,
      },
      null,
      2
    );
    await writeFile(artifactPath, body, "utf8");

    return {
      queryId,
      sql: input.sql,
      columns,
      rows,
      previewRows: rows.slice(0, input.previewRows),
      exportedRows: rows.length,
      ...(typeof rowCount === "number" ? { rowCount } : {}),
      truncated,
      artifact: {
        path: artifactPath,
        kind: "json",
        bytes: Buffer.byteLength(body, "utf8"),
        createdAt,
      },
    };
  }

  private async resolveCatalogObject(path: string): Promise<CatalogObject> {
    const segments = path.split(".").map((part) => part.trim()).filter(Boolean);
    if (segments.length === 0) throw new Error("path is required");
    const encoded = segments.map(encodeURIComponent).join("/");
    const payload = await this.fetchJson(`/api/v3/catalog/by-path/${encoded}`);
    if (!payload || typeof payload !== "object") throw new Error(`catalog object not found: ${path}`);
    return payload as CatalogObject;
  }

  private async submitSql(sql: string): Promise<string> {
    const payload = await this.fetchJson("/api/v3/sql", {
      method: "POST",
      body: JSON.stringify({ sql }),
    });
    const queryId = extractFirstString(payload, ["id", "jobId", "job_id"]);
    if (!queryId) throw new Error("query submission did not return a query id");
    return queryId;
  }

  private async waitForQuery(queryId: string, timeoutMs: number): Promise<JobStatusResponse> {
    const deadline = Date.now() + timeoutMs;
    let last: JobStatusResponse = {};
    while (Date.now() < deadline) {
      last = (await this.fetchJson(`/api/v3/job/${encodeURIComponent(queryId)}`)) as JobStatusResponse;
      const state = typeof last.jobState === "string" ? last.jobState : "";
      if (SUCCESS_STATES.has(state)) return last;
      if (FAILURE_STATES.has(state)) {
        throw new Error(last.errorMessage ? `query failed: ${last.errorMessage}` : `query failed: ${state}`);
      }
      await sleep(300);
    }
    throw new Error("query timed out while waiting for completion");
  }

  private async fetchQueryResults(queryId: string, offset: number, limit: number): Promise<JobResultsResponse> {
    return (await this.fetchJson(
      `/api/v3/job/${encodeURIComponent(queryId)}/results?offset=${offset}&limit=${limit}`
    )) as JobResultsResponse;
  }

  private async fetchJson(path: string, init: RequestInit = {}, retry = true): Promise<Record<string, unknown>> {
    const token = await this.getSessionToken();
    const response = await this.fetchImpl(url(this.config.baseUrl, path), {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: this.authStyle === "bearer" ? `Bearer ${token}` : `_dremio${token}`,
        ...(init.headers ?? {}),
      },
    });

    if (response.status === 401 && retry) {
      if (this.authStyle === "bearer") {
        this.authStyle = "legacy";
      } else {
        this.sessionToken = null;
      }
      return this.fetchJson(path, init, false);
    }
    if (response.status === 404) throw new Error(`upstream path not found: ${path}`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`upstream request failed (${response.status}): ${body || response.statusText}`);
    }
    return safeJson(response);
  }

  private async getSessionToken(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;
    const response = await this.fetchImpl(url(this.config.baseUrl, "/apiv2/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userName: this.config.username,
        password: this.config.password,
      }),
    });
    if (!response.ok) throw new Error(`login failed (${response.status})`);
    const payload = await safeJson(response);
    const token = extractFirstString(payload, ["token"]);
    if (!token) throw new Error("login did not return a session token");
    this.sessionToken = token;
    return token;
  }
}

function url(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function normalizeCatalogEntries(objects: CatalogObject[], limit?: number): CatalogEntry[] {
  const entries = objects.map(normalizeCatalogEntry);
  return typeof limit === "number" && limit > 0 ? entries.slice(0, limit) : entries;
}

function normalizeCatalogEntry(object: CatalogObject): CatalogEntry {
  return {
    ...(object.id ? { id: object.id } : {}),
    name: object.name ?? normalizePath(object) ?? "unknown",
    path: normalizePath(object) ?? object.name ?? "unknown",
    type: normalizeType(object),
    ...(object.tag ? { tag: object.tag } : {}),
    ...(object.createdAt ? { createdAt: object.createdAt } : {}),
  };
}

function normalizeType(object: CatalogObject): CatalogEntry["type"] {
  const raw = (object.type ?? object.containerType ?? "unknown").toLowerCase();
  if (raw.includes("source")) return "source";
  if (raw.includes("space")) return "space";
  if (raw.includes("folder")) return "folder";
  if (raw.includes("schema")) return "schema";
  if (raw.includes("view") || raw.includes("virtual")) return "view";
  if (raw.includes("table") || raw.includes("dataset") || raw.includes("physical")) return "table";
  return "unknown";
}

function normalizePath(object: CatalogObject): string | null {
  return Array.isArray(object.path) && object.path.length > 0 ? object.path.join(".") : object.name ?? null;
}

function normalizeColumn(field: Record<string, unknown>): TableColumn {
  return {
    name: extractFirstString(field, ["name", "fieldName"]) ?? "column",
    type: extractFirstString(field, ["type", "fieldType"]) ?? "UNKNOWN",
    ...(typeof field.nullable === "boolean" ? { nullable: field.nullable } : {}),
    ...(typeof field.description === "string" ? { description: field.description } : {}),
  };
}

function normalizeTags(payload: Record<string, unknown>): CatalogCollaboration {
  const rawTags = Array.isArray(payload.tags)
    ? payload.tags
    : Array.isArray(payload.tag)
      ? payload.tag
      : [];
  const tags = rawTags.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const version = extractFirstString(payload, ["version", "tagVersion"]);
  return {
    ...(tags.length > 0 ? { tags } : {}),
    ...(version ? { tagsVersion: version } : {}),
  };
}

function normalizeWiki(payload: Record<string, unknown>): CatalogCollaboration {
  const text = extractFirstString(payload, ["text", "wiki", "description"]);
  const version = extractFirstString(payload, ["version", "wikiVersion"]);
  return {
    ...(text ? { wikiText: text } : {}),
    ...(version ? { wikiVersion: version } : {}),
  };
}

function normalizeLineagePayload(payload: Record<string, unknown>, object: CatalogEntry): TableLineage {
  const sources = normalizeLineageNodes(extractArray(payload, ["sources", "source", "sourceDatasets", "sourceTables"]));
  const parents = normalizeLineageNodes(extractArray(payload, ["parents", "parent", "parentsList", "upstream"]));
  const children = normalizeLineageNodes(extractArray(payload, ["children", "child", "childrenList", "downstream"]));
  const caveats =
    sources.length + parents.length + children.length > 0
      ? []
      : ["Lineage endpoint returned no upstream or downstream edges for this object."];
  return {
    path: object.path,
    ...(object.id ? { objectId: object.id } : {}),
    fetchedAt: Date.now(),
    sources,
    parents,
    children,
    caveats,
  };
}

function normalizeLineageNodes(values: unknown[]): CatalogEntry[] {
  return values
    .filter((value): value is CatalogObject => !!value && typeof value === "object" && !Array.isArray(value))
    .map(normalizeCatalogEntry)
    .filter((entry) => entry.path !== "unknown");
}

function extractArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function inferColumns(rows: Array<Record<string, unknown>>): Array<{ name: string; type: string }> {
  const first = rows[0];
  if (!first) return [];
  return Object.entries(first).map(([name, value]) => ({ name, type: inferType(value) }));
}

function normalizeRows(rows: unknown): Array<Record<string, unknown>> {
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    : [];
}

function normalizeResultColumns(
  columns: unknown,
  rows: Array<Record<string, unknown>>
): Array<{ name: string; type: string }> {
  return Array.isArray(columns)
    ? columns.map((column) => ({
        name: extractFirstString(column, ["name", "columnName"]) ?? "column",
        type: extractFirstString(column, ["type", "dataType"]) ?? "UNKNOWN",
      }))
    : inferColumns(rows);
}

function inferType(value: unknown): string {
  if (value === null || value === undefined) return "UNKNOWN";
  if (Array.isArray(value)) return "ARRAY";
  switch (typeof value) {
    case "number":
      return Number.isInteger(value) ? "BIGINT" : "DOUBLE";
    case "boolean":
      return "BOOLEAN";
    case "string":
      return "VARCHAR";
    case "object":
      return "STRUCT";
    default:
      return "UNKNOWN";
  }
}

function extractFirstString(record: unknown, keys: string[]): string | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  } catch (err) {
    throw new Error(`failed to parse upstream JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
