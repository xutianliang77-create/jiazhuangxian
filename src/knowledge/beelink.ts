import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { MetadataStore } from "../../packages/beelink-mcp/src/metadataStore";
import { searchSemanticLayer } from "../../packages/beelink-mcp/src/semanticLayer";
import type { KnowledgeHit } from "./types";

export interface BeelinkKnowledgePaths {
  metadataDbPath: string;
  semanticLayerPath: string;
  glossaryPath: string;
}

export interface BeelinkKnowledgeResult {
  available: boolean;
  hits: KnowledgeHit[];
}

export function defaultBeelinkKnowledgePaths(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir()
): BeelinkKnowledgePaths {
  const projectDir = defaultBeelinkProjectDir(workspace, homeDir);
  return {
    metadataDbPath: env.BEELINK_METADATA_DB?.trim() || path.join(projectDir, "metadata.db"),
    semanticLayerPath: env.BEELINK_SEMANTIC_LAYER?.trim() || path.join(projectDir, "semantic-layer.json"),
    glossaryPath: env.BEELINK_GLOSSARY?.trim() || path.join(projectDir, "glossary.md"),
  };
}

export function searchBeelinkKnowledge(
  workspace: string,
  query: string,
  limit: number,
  paths: BeelinkKnowledgePaths = defaultBeelinkKnowledgePaths(workspace)
): BeelinkKnowledgeResult {
  const hits: KnowledgeHit[] = [];
  const hasSemanticLayer = existsSync(paths.semanticLayerPath);
  const hasGlossary = existsSync(paths.glossaryPath);
  const hasMetadata = existsSync(paths.metadataDbPath);

  if (hasSemanticLayer || hasGlossary) {
    const semantic = searchSemanticLayer(paths, query, limit);
    for (const metric of semantic.metrics) {
      hits.push({
        id: `beelink:metric:${metric.name}`,
        source: "beelink",
        title: `metric ${metric.name}`,
        excerpt: [
          metric.table ? `table=${metric.table}` : "",
          metric.aliases?.length ? `aliases=${metric.aliases.join(", ")}` : "",
          metric.dimensions?.length ? `dimensions=${metric.dimensions.join(", ")}` : "",
          metric.measures?.length ? `measures=${metric.measures.map((m) => `${m.name}:${m.expression}`).join(", ")}` : "",
        ].filter(Boolean).join(" · "),
        score: 96,
        provenance: { kind: "semantic_metric", semanticLayerPath: paths.semanticLayerPath, table: metric.table },
      });
    }
    for (const entity of semantic.entities) {
      hits.push({
        id: `beelink:entity:${entity.name}`,
        source: "beelink",
        title: `entity ${entity.name}`,
        excerpt: [
          entity.aliases?.length ? `aliases=${entity.aliases.join(", ")}` : "",
          entity.candidateTables?.length ? `candidateTables=${entity.candidateTables.join(", ")}` : "",
        ].filter(Boolean).join(" · "),
        score: 92,
        provenance: { kind: "semantic_entity", semanticLayerPath: paths.semanticLayerPath },
      });
    }
    if (semantic.glossaryExcerpt && glossaryMatchesQuery(semantic.glossaryExcerpt, query)) {
      hits.push({
        id: "beelink:glossary",
        source: "beelink",
        title: "glossary excerpt",
        excerpt: semantic.glossaryExcerpt.replace(/\s+/g, " ").trim().slice(0, 520),
        score: 82,
        provenance: { kind: "glossary", glossaryPath: paths.glossaryPath },
      });
    }
  }

  if (hasMetadata) {
    const store = new MetadataStore(paths.metadataDbPath);
    try {
      const result = searchMetadataByTerms(store, query, limit);
      for (const object of result.objects.values()) {
        hits.push({
          id: `beelink:object:${object.path}`,
          source: "beelink",
          title: `${object.type} ${object.path}`,
          excerpt: [object.name, object.tag ? `tag=${object.tag}` : ""].filter(Boolean).join(" · "),
          score: 80,
          provenance: { kind: "metadata_object", metadataDbPath: paths.metadataDbPath, objectPath: object.path },
        });
      }
      for (const column of result.columns.values()) {
        hits.push({
          id: `beelink:column:${column.objectPath}:${column.columnName}`,
          source: "beelink",
          title: `${column.objectPath}.${column.columnName}`,
          excerpt: [
            `type=${column.dataType}`,
            column.businessName ? `business=${column.businessName}` : "",
            column.description ? `description=${column.description}` : "",
            column.sampleValues?.length ? `samples=${column.sampleValues.join(", ")}` : "",
          ].filter(Boolean).join(" · "),
          score: 78,
          provenance: {
            kind: "metadata_column",
            metadataDbPath: paths.metadataDbPath,
            objectPath: column.objectPath,
            columnName: column.columnName,
          },
        });
      }
    } finally {
      store.close();
    }
  }

  return {
    available: hasSemanticLayer || hasGlossary || hasMetadata,
    hits: hits.slice(0, limit),
  };
}

function searchMetadataByTerms(store: MetadataStore, query: string, limit: number): {
  objects: Map<string, ReturnType<MetadataStore["search"]>["objects"][number]>;
  columns: Map<string, ReturnType<MetadataStore["search"]>["columns"][number]>;
} {
  const objects = new Map<string, ReturnType<MetadataStore["search"]>["objects"][number]>();
  const columns = new Map<string, ReturnType<MetadataStore["search"]>["columns"][number]>();
  const terms = [query.trim(), ...queryTerms(query)].filter((term) => term.length > 0);
  for (const term of terms) {
    const result = store.search(term, limit);
    for (const object of result.objects) {
      if (!objects.has(object.path)) objects.set(object.path, object);
    }
    for (const column of result.columns) {
      const key = `${column.objectPath}:${column.columnName}`;
      if (!columns.has(key)) columns.set(key, column);
    }
    if (objects.size + columns.size >= limit) break;
  }
  return { objects, columns };
}

function defaultBeelinkProjectDir(workspace: string, homeDir: string): string {
  const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 16);
  return path.join(homeDir, ".codeclaw", "projects", hash, "beelink");
}

function glossaryMatchesQuery(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  for (const term of queryTerms(query)) {
    if (lowerText.includes(term.toLowerCase())) return true;
  }
  return false;
}

function queryTerms(query: string): string[] {
  const ascii = query.match(/[A-Za-z0-9_]{2,}/g) ?? [];
  const cjk = query.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...new Set([...ascii, ...cjk])];
}
