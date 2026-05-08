import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { searchKnowledge } from "../../../src/knowledge/search";
import { indexWorkspace } from "../../../src/rag/indexer";
import { openRagDb } from "../../../src/rag/store";
import { buildGraph } from "../../../src/graph/builder";
import { ensureGraphSchema } from "../../../src/graph/store";
import { MetadataStore } from "../../../packages/beelink-mcp/src/metadataStore";
import type { BeelinkKnowledgePaths } from "../../../src/knowledge/beelink";

let root: string;
let workspace: string;
let dbPath: string;

beforeEach(() => {
  root = path.join(os.tmpdir(), `knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = path.join(root, "ws");
  dbPath = path.join(root, "db", "rag.db");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.dirname(dbPath), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function withDb<T>(fn: (db: import("better-sqlite3").Database) => T): T {
  const handle = openRagDb(workspace, { path: dbPath });
  try {
    ensureGraphSchema(handle.db);
    return fn(handle.db);
  } finally {
    handle.close();
  }
}

function seed(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(workspace, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function beelinkPaths(): BeelinkKnowledgePaths {
  const dir = path.join(root, "beelink");
  mkdirSync(dir, { recursive: true });
  return {
    metadataDbPath: path.join(dir, "metadata.db"),
    semanticLayerPath: path.join(dir, "semantic-layer.json"),
    glossaryPath: path.join(dir, "glossary.md"),
  };
}

describe("searchKnowledge", () => {
  it("空索引返回明确提示，不自动展开上下文", () => {
    const result = searchKnowledge(workspace, "session memory", {}, { ragDb: { path: dbPath } });
    expect(result.hits).toEqual([]);
    expect(result.text).toContain("index is empty");
    expect(result.diagnostics.ragAvailable).toBe(false);
    expect(result.diagnostics.graphAvailable).toBe(false);
  });

  it("RAG 命中转成统一 KnowledgeHit，保留文件和 chunk provenance", () => {
    seed({
      "src/memory.ts": "export function sessionMemoryRecall() { return 'memory digest'; }\n",
      "src/other.ts": "export const unrelated = true;\n",
    });
    withDb((db) => indexWorkspace(db, workspace));

    const result = searchKnowledge(workspace, "sessionMemoryRecall memory digest", { mode: "rag", topK: 3 }, { ragDb: { path: dbPath } });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].source).toBe("rag");
    expect(result.hits[0].filePath).toBe("src/memory.ts");
    expect(result.hits[0].provenance.retrieval).toBe("bm25");
    expect(result.hits[0].provenance.chunkId).toBeTruthy();
    expect(result.text).toContain("src/memory.ts");
    expect(result.text).toContain("provenance");
  });

  it("Graph callers 查询转成统一 KnowledgeHit", () => {
    seed({
      "src/util.ts": "export function computeTotal() { return 1; }\n",
      "src/a.ts": "import { computeTotal } from './util';\nexport function a() { return computeTotal(); }\n",
      "src/b.ts": "import { computeTotal } from './util';\nexport function b() { return computeTotal(); }\n",
    });
    withDb((db) => buildGraph(db, workspace));

    const result = searchKnowledge(workspace, "谁调用 computeTotal", { mode: "graph", topK: 5 }, { ragDb: { path: dbPath } });

    expect(result.hits).toHaveLength(2);
    expect(result.hits.every((hit) => hit.source === "graph")).toBe(true);
    expect(result.hits.map((hit) => hit.filePath).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.hits[0].provenance.graphQuery).toBe("callers");
    expect(result.hits[0].provenance.rerankBoost).toBeGreaterThan(0);
    expect(result.hits[0].provenance.rerankReasons).toContain("identifier:computeTotal");
    expect(result.text).toContain("computeTotal");
  });

  it("精确文件路径命中会轻量提权并记录 rerank provenance", () => {
    seed({
      "src/target.ts": "export function targetSymbol() { return 1; }\n",
      "src/other.ts": "export function otherSymbol() { return 2; }\n",
    });
    withDb((db) => buildGraph(db, workspace));

    const result = searchKnowledge(workspace, "src/target.ts", { mode: "graph", topK: 5 }, { ragDb: { path: dbPath } });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].filePath).toBe("src/target.ts");
    expect(result.hits[0].provenance.rerankBoost).toBeGreaterThan(0);
    expect(result.hits[0].provenance.rerankReasons).toContain("path:src/target.ts");
    expect(result.hits[0].provenance.rerankReasons).not.toContain("identifier:src");
  });

  it("文件加符号查询会扩大 Graph 候选窗口，让后置符号也能被 rerank 到前面", () => {
    seed({
      "src/many.ts": [
        "export const alphaOne = 1;",
        "export const alphaTwo = 2;",
        "export const alphaThree = 3;",
        "export const alphaFour = 4;",
        "export const alphaFive = 5;",
        "export function lateTargetSymbol() { return 6; }",
      ].join("\n"),
    });
    withDb((db) => buildGraph(db, workspace));

    const result = searchKnowledge(workspace, "src/many.ts lateTargetSymbol", { mode: "graph", topK: 1 }, { ragDb: { path: dbPath } });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].title).toContain("lateTargetSymbol");
    expect(result.hits[0].provenance.rerankReasons).toContain("identifier:lateTargetSymbol");
  });

  it("auto 模式合并 RAG 与 Graph，并按 score 截断 topK", () => {
    seed({
      "src/util.ts": "export function computeTotal() { return 1; }\n",
      "src/a.ts": "import { computeTotal } from './util';\nexport function a() { return computeTotal(); }\n",
      "docs/note.md": "computeTotal is part of billing knowledge.\n",
    });
    withDb((db) => {
      indexWorkspace(db, workspace);
      buildGraph(db, workspace);
    });

    const result = searchKnowledge(workspace, "computeTotal", { topK: 2 }, { ragDb: { path: dbPath } });

    expect(result.hits).toHaveLength(2);
    expect(result.hits.some((hit) => hit.source === "rag")).toBe(true);
    expect(result.hits.some((hit) => hit.source === "graph")).toBe(true);
    expect(result.diagnostics.ragHits).toBeGreaterThan(0);
    expect(result.diagnostics.graphHits).toBeGreaterThan(0);
  });

  it("sources 过滤可以在 auto 模式只返回指定来源", () => {
    seed({
      "src/util.ts": "export function computeTotal() { return 1; }\n",
      "src/a.ts": "import { computeTotal } from './util';\nexport function a() { return computeTotal(); }\n",
      "docs/note.md": "computeTotal is part of billing knowledge.\n",
    });
    withDb((db) => {
      indexWorkspace(db, workspace);
      buildGraph(db, workspace);
    });

    const ragOnly = searchKnowledge(workspace, "computeTotal", {
      topK: 5,
      sources: ["rag"],
    }, { ragDb: { path: dbPath } });

    expect(ragOnly.hits.length).toBeGreaterThan(0);
    expect(ragOnly.hits.every((hit) => hit.source === "rag")).toBe(true);
    expect(ragOnly.diagnostics.enabledSources).toEqual(["rag"]);
    expect(ragOnly.text).toContain("sources=rag");
  });

  it("auto 模式优先保留跨源证据，避免 Graph 命中淹没 RAG", () => {
    seed({
      "src/util.ts": "export function computeTotal() { return 1; }\n",
      "src/a.ts": "import { computeTotal } from './util';\nexport function a() { return computeTotal(); }\n",
      "src/b.ts": "import { computeTotal } from './util';\nexport function b() { return computeTotal(); }\n",
      "src/c.ts": "import { computeTotal } from './util';\nexport function c() { return computeTotal(); }\n",
      "docs/note.md": "computeTotal is part of billing knowledge.\n",
    });
    withDb((db) => {
      indexWorkspace(db, workspace);
      buildGraph(db, workspace);
    });

    const result = searchKnowledge(workspace, "谁调用 computeTotal", { topK: 2 }, { ragDb: { path: dbPath } });

    expect(result.hits).toHaveLength(2);
    expect(result.hits.some((hit) => hit.source === "graph")).toBe(true);
    expect(result.hits.some((hit) => hit.source === "rag")).toBe(true);
  });

  it("beelink 模式读取本地 semantic-layer 和 glossary，不执行 SQL", () => {
    const paths = beelinkPaths();
    writeFileSync(paths.semanticLayerPath, JSON.stringify({
      metrics: [{
        name: "总销售额",
        aliases: ["销售金额"],
        table: "@xu.sample_sales_daily",
        dimensions: ["category"],
        measures: [{ name: "sales_amount", expression: "SUM(sales_amount)" }],
      }],
      entities: [{
        name: "商品",
        aliases: ["食物"],
        candidateTables: ["@xu.sample_sales_daily"],
      }],
    }));
    writeFileSync(paths.glossaryPath, "## @xu.sample_sales_daily\n- sales_amount 表示销售金额。\n");

    const result = searchKnowledge(workspace, "销售金额", { mode: "beelink", topK: 5 }, {
      ragDb: { path: dbPath },
      beelinkPaths: paths,
    });

    expect(result.diagnostics.enabledSources).toEqual(["beelink"]);
    expect(result.diagnostics.beelinkAvailable).toBe(true);
    expect(result.hits.some((hit) => hit.source === "beelink" && hit.provenance.kind === "semantic_metric")).toBe(true);
    expect(result.hits.some((hit) => hit.provenance.kind === "glossary")).toBe(true);
    expect(result.text).toContain("beelink=");
  });

  it("beelink 模式读取本地 metadata.db 表字段证据", () => {
    const paths = beelinkPaths();
    const store = new MetadataStore(paths.metadataDbPath);
    try {
      store.upsertCatalogObjects([{
        name: "sample_sales_daily",
        path: "@xu.sample_sales_daily",
        type: "table",
      }]);
      store.replaceColumns("@xu.sample_sales_daily", [{
        name: "sales_amount",
        type: "DOUBLE",
        businessName: "销售金额",
        sampleValues: ["128.50", "99.00"],
      }]);
    } finally {
      store.close();
    }

    const result = searchKnowledge(workspace, "sales_amount 销售金额 sample_sales_daily", { mode: "beelink", topK: 5 }, {
      ragDb: { path: dbPath },
      beelinkPaths: paths,
    });

    expect(result.diagnostics.beelinkAvailable).toBe(true);
    expect(result.hits.some((hit) => hit.provenance.kind === "metadata_column")).toBe(true);
    expect(result.text).toContain("@xu.sample_sales_daily.sales_amount");
  });
});
