import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairSqlAttempt } from "../../../packages/beelink-mcp/src/sqlRepair";
import type { BeelinkConfig, CatalogEntry, QueryPreview, TableColumn } from "../../../packages/beelink-mcp/src/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("beelink SQL repair", () => {
  it("classifies lexical @ path errors and suggests a quoted SQL candidate", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-repair-"));
    tempDirs.push(dir);
    const result = await repairSqlAttempt(new FakeClient(), testConfig(dir), {
      sql: "select * from @x.food_daily",
      error: 'Lexical error at line 1, column 15. Encountered: "@"',
    });

    expect(result.category).toBe("sql_reference");
    expect(result.repairedSql).toBe('select * from "@x".food_daily');
    expect(result.suggestedActions.join("\n")).toContain("PrepareSqlReference");
  });

  it("supplements metadata context for object-not-found failures when question is provided", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-repair-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    await writeFile(
      config.semanticLayerPath,
      JSON.stringify({
        entities: [{ name: "食物", aliases: ["食品"], candidateTables: ["@x.food_daily"] }],
      }),
      "utf8"
    );
    const result = await repairSqlAttempt(new FakeClient(), config, {
      sql: 'select * from "@x".missing_food',
      error: "Object 'missing_food' not found",
      question: "告诉我食物的名字",
    });

    expect(result.category).toBe("metadata_missing");
    expect(result.exploration?.metadata.objects.map((object) => object.path)).toContain("@x.food_daily");
  });

  it("classifies unsafe SQL without probing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-repair-"));
    tempDirs.push(dir);
    const result = await repairSqlAttempt(new FakeClient(), testConfig(dir), {
      sql: "delete from foo",
      error: "only read-only SQL is allowed",
      question: "delete data",
    });

    expect(result.category).toBe("safety");
    expect(result.exploration).toBeUndefined();
    expect(result.ruleCheck.errors.join("\n")).toContain("only read-only SQL is allowed");
  });
});

class FakeClient {
  async searchCatalog(): Promise<CatalogEntry[]> {
    return [{ name: "food_daily", path: "@x.food_daily", type: "table" }];
  }

  async getSchemaOfTable(): Promise<{ path: string; columns: TableColumn[] }> {
    return {
      path: "@x.food_daily",
      columns: [
        { name: "food_name", type: "VARCHAR" },
        { name: "quantity", type: "BIGINT" },
      ],
    };
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
