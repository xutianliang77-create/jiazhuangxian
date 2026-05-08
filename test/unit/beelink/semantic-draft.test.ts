import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataStore } from "../../../packages/beelink-mcp/src/metadataStore";
import { initSemanticLayerDraft } from "../../../packages/beelink-mcp/src/semanticDraft";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("beelink semantic draft", () => {
  it("creates semantic-layer.json and glossary.md from metadata hints", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-draft-"));
    tempDirs.push(dir);
    const metadataDbPath = path.join(dir, "metadata.db");
    const semanticLayerPath = path.join(dir, "semantic-layer.json");
    const glossaryPath = path.join(dir, "glossary.md");
    const store = new MetadataStore(metadataDbPath);
    store.upsertCatalogObjects([{ name: "chatbi_food_sales", path: "@x.chatbi_food_sales", type: "table" }]);
    store.replaceColumns("@x.chatbi_food_sales", [
      { name: "item_name", type: "VARCHAR", businessName: "item_name" },
      { name: "quantity", type: "INTEGER", businessName: "quantity" },
      { name: "sales_amount", type: "DECIMAL", businessName: "sales_amount" },
    ]);

    const result = initSemanticLayerDraft(
      { metadataDbPath, semanticLayerPath, glossaryPath },
      store.listTableProfiles()
    );
    store.close();

    const semantic = JSON.parse(await readFile(semanticLayerPath, "utf8")) as {
      metrics: Array<{ name: string; table: string; dimensions?: string[]; measures?: Array<{ name: string; expression: string }> }>;
      entities: Array<{ name: string; candidateTables?: string[] }>;
    };
    const glossary = await readFile(glossaryPath, "utf8");

    expect(result.semanticLayerCreated).toBe(true);
    expect(result.glossaryCreated).toBe(true);
    expect(semantic.metrics.map((metric) => metric.name)).toContain("最畅销商品");
    expect(semantic.metrics.map((metric) => metric.name)).toContain("销售额最高商品");
    expect(semantic.metrics.find((metric) => metric.name === "最畅销商品")?.measures).toEqual([
      { name: "销量", expression: "SUM(quantity)" },
    ]);
    expect(semantic.entities).toEqual([
      expect.objectContaining({ name: "食物", candidateTables: ["@x.chatbi_food_sales"] }),
    ]);
    expect(glossary).toContain("`item_name` -> `item_name`");
    expect(glossary).toContain("`quantity` -> `quantity`");
    expect(glossary).toContain("`sales_amount` -> `sales_amount`");
  });

  it("does not overwrite existing semantic files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-draft-"));
    tempDirs.push(dir);
    const metadataDbPath = path.join(dir, "metadata.db");
    const semanticLayerPath = path.join(dir, "semantic-layer.json");
    const glossaryPath = path.join(dir, "glossary.md");
    await writeFile(semanticLayerPath, "{\"metrics\":[]}\n", "utf8");
    await writeFile(glossaryPath, "manual glossary\n", "utf8");
    const store = new MetadataStore(metadataDbPath);

    const result = initSemanticLayerDraft(
      { metadataDbPath, semanticLayerPath, glossaryPath },
      store.listTableProfiles()
    );
    store.close();

    expect(result.semanticLayerCreated).toBe(false);
    expect(result.glossaryCreated).toBe(false);
    expect(await readFile(semanticLayerPath, "utf8")).toBe("{\"metrics\":[]}\n");
    expect(await readFile(glossaryPath, "utf8")).toBe("manual glossary\n");
  });

  it("overwrites existing semantic files when requested", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-draft-"));
    tempDirs.push(dir);
    const metadataDbPath = path.join(dir, "metadata.db");
    const semanticLayerPath = path.join(dir, "semantic-layer.json");
    const glossaryPath = path.join(dir, "glossary.md");
    await writeFile(semanticLayerPath, "{\"metrics\":[]}\n", "utf8");
    await writeFile(glossaryPath, "old @x glossary\n", "utf8");
    const store = new MetadataStore(metadataDbPath);
    store.upsertCatalogObjects([{ name: "sample_sales_daily", path: "@xu.sample_sales_daily", type: "table" }]);
    store.replaceColumns("@xu.sample_sales_daily", [
      { name: "D", type: "VARCHAR", businessName: "product" },
      { name: "E", type: "INTEGER", businessName: "quantity" },
      { name: "F", type: "DECIMAL", businessName: "revenue" },
    ]);

    const result = initSemanticLayerDraft(
      { metadataDbPath, semanticLayerPath, glossaryPath },
      store.listTableProfiles(),
      { overwrite: true }
    );
    store.close();

    expect(result.semanticLayerCreated).toBe(false);
    expect(result.glossaryCreated).toBe(false);
    expect(result.semanticLayerUpdated).toBe(true);
    expect(result.glossaryUpdated).toBe(true);
    expect(await readFile(glossaryPath, "utf8")).toContain("@xu.sample_sales_daily");
    expect(await readFile(glossaryPath, "utf8")).not.toContain("old @x glossary");
  });
});
