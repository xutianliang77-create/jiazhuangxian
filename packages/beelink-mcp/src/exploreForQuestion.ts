import { MetadataStore } from "./metadataStore";
import { collectSemanticTerms, searchSemanticLayer } from "./semanticLayer";
import type { BeelinkConfig, CatalogEntry, ExploreForQuestionResult, MetadataSearchResult } from "./types";

interface ExploreClient {
  searchCatalog(input: { query: string; limit?: number }): Promise<CatalogEntry[]>;
  getSchemaOfTable(path: string): Promise<{
    path: string;
    columns: Array<{ name: string; type: string; nullable?: boolean; description?: string }>;
  }>;
}

export async function exploreForQuestion(
  client: ExploreClient,
  config: BeelinkConfig,
  input: { question: string; limit?: number; probeIfEmpty?: boolean }
): Promise<ExploreForQuestionResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const knownTablePaths = readKnownTablePaths(config.metadataDbPath);
  const semantic = searchSemanticLayer(config, input.question, limit, knownTablePaths);
  const terms = [input.question, ...collectSemanticTerms(semantic)];
  const metadata = searchMetadataTerms(config.metadataDbPath, terms, limit);

  if (!input.probeIfEmpty || metadata.objects.length > 0 || metadata.columns.length > 0) {
    return { question: input.question, semantic, metadata };
  }

  const entries = await client.searchCatalog({ query: input.question, limit });
  if (entries.length > 0) {
    const store = new MetadataStore(config.metadataDbPath);
    try {
      store.upsertCatalogObjects(entries);
      for (const entry of entries) {
        if (entry.type !== "table" && entry.type !== "view") continue;
        try {
          const schema = await client.getSchemaOfTable(entry.path);
          store.replaceColumns(schema.path, schema.columns);
        } catch {
          // Probe should help when possible, not turn partial metadata access into a hard failure.
        }
      }
    } finally {
      store.close();
    }
  }

  return {
    question: input.question,
    semantic,
    metadata: searchMetadataTerms(config.metadataDbPath, [...terms, ...entries.map((entry) => entry.path)], limit),
    upstreamProbe: { attempted: true, entries },
  };
}

function readKnownTablePaths(dbPath: string): Set<string> | undefined {
  const store = new MetadataStore(dbPath);
  try {
    const paths = store.listTableProfiles(10_000).map((profile) => profile.path);
    return paths.length > 0 ? new Set(paths) : undefined;
  } finally {
    store.close();
  }
}

function searchMetadataTerms(dbPath: string, terms: string[], limit: number): MetadataSearchResult {
  const store = new MetadataStore(dbPath);
  try {
    const objects = new Map<string, CatalogEntry>();
    const columns = new Map<string, MetadataSearchResult["columns"][number]>();
    for (const term of terms) {
      if (!term.trim()) continue;
      const result = store.search(term, limit);
      for (const object of result.objects) objects.set(object.path, object);
      for (const column of result.columns) columns.set(`${column.objectPath}.${column.columnName}`, column);
      if (objects.size >= limit && columns.size >= limit) break;
    }
    return {
      dbPath,
      objects: Array.from(objects.values()).slice(0, limit),
      columns: Array.from(columns.values()).slice(0, limit),
    };
  } finally {
    store.close();
  }
}
