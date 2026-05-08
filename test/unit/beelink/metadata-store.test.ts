import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataStore } from "../../../packages/beelink-mcp/src/metadataStore";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("beelink MetadataStore", () => {
  it("stores catalog objects and searches table columns", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-metadata-"));
    tempDirs.push(dir);
    const store = new MetadataStore(path.join(dir, "metadata.db"));

    store.upsertCatalogObjects([
      { name: "food_daily", path: "@x.food_daily", type: "table" },
      { name: "orders", path: "@x.orders", type: "table" },
    ]);
    store.replaceColumns("@x.food_daily", [
      { name: "food_name", type: "VARCHAR" },
      { name: "quantity", type: "BIGINT", nullable: false },
    ]);

    const result = store.search("food", 10);
    store.close();

    expect(result.objects.map((entry) => entry.path)).toContain("@x.food_daily");
    expect(result.columns.map((column) => column.columnName)).toContain("food_name");
  });

  it("stores inferred business names and samples for physical columns", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-metadata-"));
    tempDirs.push(dir);
    const store = new MetadataStore(path.join(dir, "metadata.db"));

    store.upsertCatalogObjects([{ name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.replaceColumns("@x.food_daily", [
      { name: "A", type: "UNKNOWN" },
      { name: "E", type: "UNKNOWN" },
    ]);
    store.updateColumnHints("@x.food_daily", [
      { name: "A", type: "UNKNOWN", businessName: "Customer_id", sampleValues: ["JXJY167254JK"] },
      { name: "E", type: "UNKNOWN", businessName: "items", sampleValues: ["Pizza:Water"] },
    ]);

    const result = store.search("items", 10);
    store.close();

    expect(result.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectPath: "@x.food_daily",
          columnName: "E",
          businessName: "items",
          sampleValues: ["Pizza:Water"],
        }),
      ])
    );
  });

  it("preserves inferred hints when schema is refreshed later", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-metadata-"));
    tempDirs.push(dir);
    const store = new MetadataStore(path.join(dir, "metadata.db"));

    store.upsertCatalogObjects([{ name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.replaceColumns("@x.food_daily", [{ name: "E", type: "UNKNOWN" }]);
    store.updateColumnHints("@x.food_daily", [
      { name: "E", type: "UNKNOWN", businessName: "items", sampleValues: ["Pizza:Water"] },
    ]);
    store.replaceColumns("@x.food_daily", [{ name: "E", type: "UNKNOWN" }]);

    const result = store.search("items", 10);
    store.close();

    expect(result.columns).toEqual([
      expect.objectContaining({
        columnName: "E",
        businessName: "items",
        sampleValues: ["Pizza:Water"],
      }),
    ]);
  });

  it("stores collaboration metadata and lineage edges", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-metadata-"));
    tempDirs.push(dir);
    const store = new MetadataStore(path.join(dir, "metadata.db"));

    store.upsertCatalogObjects([{ id: "dataset-1", name: "food_daily", path: "@x.food_daily", type: "table" }]);
    store.updateObjectCollaboration("@x.food_daily", {
      tags: ["gold", "food"],
      tagsVersion: "tag-v1",
      wikiText: "Daily food sales table.",
      wikiVersion: "wiki-v1",
    });
    store.replaceLineage("@x.food_daily", {
      path: "@x.food_daily",
      objectId: "dataset-1",
      sources: [{ id: "raw-1", path: "@x.raw_food", type: "table" }],
      parents: [],
      children: [{ id: "view-1", path: "@x.food_daily_view", type: "view" }],
      caveats: [],
    });

    const profile = store.getObjectProfile("@x.food_daily");
    const lineage = store.getLineage("@x.food_daily");
    store.close();

    expect(profile).toEqual(
      expect.objectContaining({
        id: "dataset-1",
        tags: ["gold", "food"],
        tagsVersion: "tag-v1",
        wikiText: "Daily food sales table.",
        wikiVersion: "wiki-v1",
      })
    );
    expect(lineage.sources).toEqual([expect.objectContaining({ id: "raw-1", path: "@x.raw_food" })]);
    expect(lineage.children).toEqual([expect.objectContaining({ id: "view-1", path: "@x.food_daily_view" })]);
    expect(lineage.caveats).toEqual([]);
  });
});
