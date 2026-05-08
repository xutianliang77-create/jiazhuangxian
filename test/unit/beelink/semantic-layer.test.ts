import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchSemanticLayer } from "../../../packages/beelink-mcp/src/semanticLayer";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("beelink semantic layer", () => {
  it("matches metrics and entities by Chinese aliases", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-semantic-"));
    tempDirs.push(dir);
    const semanticLayerPath = path.join(dir, "semantic-layer.json");
    const glossaryPath = path.join(dir, "glossary.md");
    await writeFile(
      semanticLayerPath,
      JSON.stringify({
        metrics: [
          {
            name: "最畅销商品",
            aliases: ["卖得最好", "销量最高"],
            table: "@x.food_daily",
            dimensions: ["food_name"],
            measures: [{ name: "销量", expression: "SUM(quantity)" }],
          },
        ],
        entities: [{ name: "食物", aliases: ["菜品"], candidateTables: ["@x.food_daily"] }],
      }),
      "utf8"
    );
    await writeFile(glossaryPath, "食物表用于分析每日菜品销量。", "utf8");

    const result = searchSemanticLayer(
      { semanticLayerPath, glossaryPath },
      "分析食物表里面什么东西销量最高",
      10
    );

    expect(result.metrics.map((metric) => metric.name)).toEqual(["最畅销商品"]);
    expect(result.entities.map((entity) => entity.name)).toEqual(["食物"]);
    expect(result.glossaryExcerpt).toContain("食物表");
  });
});
