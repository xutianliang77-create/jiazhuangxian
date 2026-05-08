import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataStore } from "../../../packages/beelink-mcp/src/metadataStore";
import { formatSqlGuidance } from "../../../packages/beelink-mcp/src/formatter";
import { buildSqlGuidance, checkSqlAgainstRules } from "../../../packages/beelink-mcp/src/sqlRules";
import type { BeelinkConfig, CatalogEntry, QueryPreview, TableColumn } from "../../../packages/beelink-mcp/src/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("beelink SQL rules", () => {
  it("builds guidance from semantic layer and local metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-guidance-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    await writeFile(
      config.semanticLayerPath,
      JSON.stringify({
        metrics: [
          {
            name: "最畅销商品",
            aliases: ["销量最高"],
            table: "@x.food_daily",
            dimensions: ["food_name"],
            measures: [{ name: "销量", expression: "SUM(quantity)" }],
          },
        ],
      }),
      "utf8"
    );
    const store = new MetadataStore(config.metadataDbPath);
    store.upsertCatalogObjects([{ name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.replaceColumns("@x.food_daily", [
      { name: "food_name", type: "VARCHAR" },
      { name: "quantity", type: "BIGINT" },
    ]);
    store.close();

    const result = await buildSqlGuidance(new FakeClient(), config, {
      question: "分析食物表里面什么东西销量最高",
      probeIfEmpty: true,
    });

    expect(result.exploration.semantic.metrics.map((metric) => metric.name)).toEqual(["最畅销商品"]);
    expect(result.exploration.metadata.objects.map((object) => object.path)).toContain("@x.food_daily");
    expect(result.rules.some((rule) => rule.includes("Quote special catalog path"))).toBe(true);

    const formatted = formatSqlGuidance(result);
    expect(formatted).toContain("Recommended core tool path");
    expect(formatted).toContain('@x.food_daily -> "@x".food_daily');
    expect(formatted).toContain("@x.food_daily.food_name");
    expect(formatted).toContain("If RunSqlQuery fails, call RepairSqlAttempt");
  });

  it("reports obvious SQL warnings and errors", () => {
    const result = checkSqlAgainstRules({
      sql: "select food_name, sum(quantity) from @x.food_daily order by sum(quantity) desc",
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('@x.food_daily should be quoted as "@x".food_daily');
    expect(result.warnings).toContain("No LIMIT found; add a preview LIMIT before running exploratory queries.");
    expect(result.warnings).toContain(
      "Aggregation query appears to select non-aggregated dimensions without GROUP BY."
    );
  });

  it("blocks non-read-only SQL", () => {
    const result = checkSqlAgainstRules({ sql: "delete from foo" });

    expect(result.errors.join("\n")).toContain("only read-only SQL is allowed");
  });
});

class FakeClient {
  async searchCatalog(): Promise<CatalogEntry[]> {
    throw new Error("should not probe upstream when local metadata exists");
  }

  async getSchemaOfTable(): Promise<{ path: string; columns: TableColumn[] }> {
    throw new Error("should not fetch schema when local metadata exists");
  }

  async listCatalogEntries(): Promise<CatalogEntry[]> {
    return [];
  }

  async runSqlQuery(): Promise<QueryPreview> {
    throw new Error("not implemented");
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
