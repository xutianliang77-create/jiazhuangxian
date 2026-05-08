import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BeelinkMcpServer } from "../../../packages/beelink-mcp/src/server";
import { MetadataStore } from "../../../packages/beelink-mcp/src/metadataStore";
import type {
  BeelinkConfig,
  CatalogEntry,
  QueryPreview,
  SqlExportArtifact,
  TableColumn,
} from "../../../packages/beelink-mcp/src/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("beelink MCP server tool surface", () => {
  it("exposes cloud-aligned metadata tools", () => {
    const server = new BeelinkMcpServer(testConfig("/tmp/beelink-server-tools"), new FakeClient() as never);

    const names = server.listTools().map((tool) => tool.name);

    expect(names).toContain("ExportSqlArtifact");
    expect(names).toContain("RunSemanticSearch");
    expect(names).toContain("GetUsefulSystemTableNames");
    expect(names).toContain("GetDescriptionOfTableOrSchema");
    expect(names).toContain("GetTableOrViewLineage");
  });

  it("returns useful system table guidance without calling upstream", async () => {
    const server = new BeelinkMcpServer(testConfig("/tmp/beelink-server-tools"), new FakeClient() as never);

    const result = await server.callTool("GetUsefulSystemTableNames", {});
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("INFORMATION_SCHEMA.TABLES");
    expect(text).toContain("sys.jobs");
    expect(text).toContain("permission");
  });

  it("runs semantic search against semantic files and local metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-server-tools-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    await writeFile(
      config.semanticLayerPath,
      JSON.stringify({
        entities: [{ name: "食物", aliases: ["食品"], candidateTables: ["@x.food_daily"] }],
      }),
      "utf8"
    );
    await writeFile(config.glossaryPath, "食物表用于分析每日菜品销量。", "utf8");
    const store = new MetadataStore(config.metadataDbPath);
    store.upsertCatalogObjects([{ name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.replaceColumns("@x.food_daily", [{ name: "E", type: "VARCHAR", businessName: "items" }]);
    store.close();

    const server = new BeelinkMcpServer(config, new FakeClient() as never);
    const result = await server.callTool("RunSemanticSearch", { query: "食物销量", limit: 10 });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Semantic search");
    expect(text).toContain("食物");
    expect(text).toContain("@x.food_daily");
    expect(text).toContain("items");
  });

  it("returns local object descriptions with business column hints", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-server-tools-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    const store = new MetadataStore(config.metadataDbPath);
    store.upsertCatalogObjects([{ name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.replaceColumns("@x.food_daily", [
      { name: "E", type: "VARCHAR", businessName: "items", sampleValues: ["Bread", "Steak"] },
    ]);
    store.close();

    const server = new BeelinkMcpServer(config, new FakeClient() as never);
    const result = await server.callTool("GetDescriptionOfTableOrSchema", { path: "@x.food_daily" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Object description");
    expect(text).toContain("@x.food_daily");
    expect(text).toContain("items");
    expect(text).toContain("Bread");
  });

  it("refreshes object labels and wiki before returning descriptions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-server-tools-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    const store = new MetadataStore(config.metadataDbPath);
    store.upsertCatalogObjects([{ id: "dataset-1", name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.replaceColumns("@x.food_daily", [{ name: "E", type: "VARCHAR", businessName: "items" }]);
    store.close();

    const server = new BeelinkMcpServer(config, new RichMetadataClient() as never);
    const result = await server.callTool("GetDescriptionOfTableOrSchema", { path: "@x.food_daily" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("labels: gold, food");
    expect(text).toContain("Daily food sales table.");
  });

  it("returns cached lineage edges after live lineage refresh", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-server-tools-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    const store = new MetadataStore(config.metadataDbPath);
    store.upsertCatalogObjects([{ id: "dataset-1", name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.close();

    const server = new BeelinkMcpServer(config, new RichMetadataClient() as never);
    const result = await server.callTool("GetTableOrViewLineage", { path: "@x.food_daily" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("@x.raw_food");
    expect(text).toContain("@x.food_daily_view");
    expect(text).not.toContain("No lineage edges are recorded");
  });

  it("returns an explicit lineage caveat instead of inventing edges", async () => {
    const server = new BeelinkMcpServer(testConfig("/tmp/beelink-server-tools"), new FakeClient() as never);

    const result = await server.callTool("GetTableOrViewLineage", { path: "@x.food_daily" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Table/view lineage");
    expect(text).toContain("none recorded");
    expect(text).toContain("Do not infer");
  });

  it("exports SQL result artifacts for report datasets", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-server-tools-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    const server = new BeelinkMcpServer(config, new ExportClient(config) as never);

    const result = await server.callTool("ExportSqlArtifact", {
      sql: "select item_name, quantity from sales",
      maxRows: 10,
      previewRows: 1,
    });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("SQL export complete");
    expect(text).toContain("Exported rows: 2");
    expect(text).toContain("dataset.resultArtifact");
    const artifactText = await readFile(path.join(config.artifactsRoot, "beelink-mcp", "query-export-1.json"), "utf8");
    expect(JSON.parse(artifactText)).toMatchObject({
      queryId: "query-export-1",
      exportedRows: 2,
      truncated: false,
    });
  });
});

class FakeClient {
  async searchCatalog(): Promise<CatalogEntry[]> {
    throw new Error("unexpected upstream call");
  }

  async getSchemaOfTable(): Promise<{ path: string; columns: TableColumn[] }> {
    throw new Error("unexpected schema call");
  }

  async listCatalogEntries(): Promise<CatalogEntry[]> {
    return [];
  }

  async runSqlQuery(): Promise<QueryPreview> {
    throw new Error("not implemented");
  }

  async exportSqlArtifact(): Promise<SqlExportArtifact> {
    throw new Error("not implemented");
  }
}

class ExportClient extends FakeClient {
  constructor(private readonly config: BeelinkConfig) {
    super();
  }

  async exportSqlArtifact(): Promise<SqlExportArtifact> {
    const artifactPath = path.join(this.config.artifactsRoot, "beelink-mcp", "query-export-1.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify({ queryId: "query-export-1", exportedRows: 2, truncated: false }),
      "utf8"
    );
    return {
      queryId: "query-export-1",
      sql: "select item_name, quantity from sales",
      columns: [
        { name: "item_name", type: "VARCHAR" },
        { name: "quantity", type: "BIGINT" },
      ],
      rows: [
        { item_name: "Bread", quantity: 10 },
        { item_name: "Noodles", quantity: 8 },
      ],
      previewRows: [{ item_name: "Bread", quantity: 10 }],
      exportedRows: 2,
      rowCount: 2,
      truncated: false,
      artifact: {
        path: artifactPath,
        kind: "json",
        bytes: 64,
        createdAt: "2026-05-03T00:00:00.000Z",
      },
    };
  }
}

class RichMetadataClient extends FakeClient {
  async getCatalogEntry(): Promise<CatalogEntry> {
    return { id: "dataset-1", name: "food_daily", path: "@x.food_daily", type: "table" };
  }

  async getCollaboration(): Promise<{ tags: string[]; tagsVersion: string; wikiText: string; wikiVersion: string }> {
    return {
      tags: ["gold", "food"],
      tagsVersion: "tag-v1",
      wikiText: "Daily food sales table.",
      wikiVersion: "wiki-v1",
    };
  }

  async getTableOrViewLineage(): Promise<{
    path: string;
    objectId: string;
    sources: CatalogEntry[];
    parents: CatalogEntry[];
    children: CatalogEntry[];
    caveats: string[];
  }> {
    return {
      path: "@x.food_daily",
      objectId: "dataset-1",
      sources: [{ id: "raw-1", name: "raw_food", path: "@x.raw_food", type: "table" }],
      parents: [],
      children: [{ id: "view-1", name: "food_daily_view", path: "@x.food_daily_view", type: "view" }],
      caveats: [],
    };
  }
}

function testConfig(dir: string): BeelinkConfig {
  return {
    baseUrl: "http://localhost:9047",
    username: "x",
    password: "x",
    timeoutMs: 1000,
    previewRows: 5,
    maxPreviewRows: 50,
    artifactsRoot: path.join(dir, "artifacts"),
    exportMaxRows: 5000,
    exportPageRows: 500,
    metadataDbPath: path.join(dir, "metadata.db"),
    semanticLayerPath: path.join(dir, "semantic-layer.json"),
    glossaryPath: path.join(dir, "glossary.md"),
  };
}
