import { countChunks, openRagDb, type OpenRagDbOptions } from "../rag/store";
import { searchKeyword } from "../rag/searcher";
import { ensureGraphSchema, countCalls, countImports, countSymbols } from "../graph/store";
import {
  dependenciesOf,
  dependentsOf,
  findSymbolsByName,
  listSymbolsInFile,
  whatCalls,
  whoCalls,
  type CallerRow,
  type ImportRow,
  type SymbolRow,
} from "../graph/queries";
import { searchBeelinkKnowledge, type BeelinkKnowledgePaths } from "./beelink";
import type { KnowledgeHit, KnowledgeSearchOptions, KnowledgeSearchResult } from "./types";

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const MAX_EXCERPT_CHARS = 520;
const MAX_GRAPH_CANDIDATES = 50;
const KNOWLEDGE_SOURCES = ["rag", "graph", "beelink"] as const;
type SearchableKnowledgeSource = typeof KNOWLEDGE_SOURCES[number];

export interface KnowledgeSearchServiceOptions {
  ragDb?: OpenRagDbOptions;
  beelinkPaths?: BeelinkKnowledgePaths;
}

export function searchKnowledge(
  workspace: string,
  query: string,
  options: KnowledgeSearchOptions = {},
  serviceOptions: KnowledgeSearchServiceOptions = {}
): KnowledgeSearchResult {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return emptyResult("query is empty");
  }

  const topK = clampTopK(options.topK);
  const mode = options.mode ?? "auto";
  const enabledSources = resolveEnabledSources(mode, options.sources);
  const handle = openRagDb(workspace, serviceOptions.ragDb ?? {});
  try {
    ensureGraphSchema(handle.db);
    const ragAvailable = countChunks(handle.db) > 0;
    const graphAvailable = countSymbols(handle.db) > 0 || countImports(handle.db) > 0 || countCalls(handle.db) > 0;

    const rerankSignals = extractRerankSignals(normalizedQuery);
    const ragHits = !enabledSources.includes("rag") || !ragAvailable
      ? []
      : searchKeyword(handle.db, normalizedQuery, { topK }).map((hit): KnowledgeHit => ({
          id: `rag:${hit.chunkId}`,
          source: "rag",
          title: `${hit.relPath}:${hit.lineStart}-${hit.lineEnd}`,
          excerpt: clipExcerpt(hit.content),
          filePath: hit.relPath,
          lineStart: hit.lineStart,
          lineEnd: hit.lineEnd,
          score: hit.score,
          provenance: {
            chunkId: hit.chunkId,
            hits: hit.hits,
            retrieval: "bm25",
          },
        })).map((hit) => rerankHit(hit, rerankSignals));

    const graphHits = !enabledSources.includes("graph") || !graphAvailable
      ? []
      : searchGraph(handle.db, normalizedQuery, graphCandidateLimit(topK)).map((hit) => rerankHit(hit, rerankSignals));

    const beelink = enabledSources.includes("beelink")
      ? searchBeelinkKnowledge(workspace, normalizedQuery, graphCandidateLimit(topK), serviceOptions.beelinkPaths)
      : { available: false, hits: [] };
    const beelinkHits = beelink.hits.map((hit) => rerankHit(hit, rerankSignals));

    const hits = mergeHits({
      buckets: { rag: ragHits, graph: graphHits, beelink: beelinkHits },
      topK,
      balanced: mode === "auto" && enabledSources.length > 1,
    });

    return {
      hits,
      text: formatKnowledgeHits(hits, {
        ragAvailable,
        graphAvailable,
        beelinkAvailable: beelink.available,
        ragHits: ragHits.length,
        graphHits: graphHits.length,
        beelinkHits: beelinkHits.length,
        enabledSources,
      }),
      diagnostics: {
        ragAvailable,
        graphAvailable,
        beelinkAvailable: beelink.available,
        ragHits: ragHits.length,
        graphHits: graphHits.length,
        beelinkHits: beelinkHits.length,
        enabledSources,
      },
    };
  } finally {
    handle.close();
  }
}

function graphCandidateLimit(topK: number): number {
  return Math.min(MAX_GRAPH_CANDIDATES, Math.max(20, topK * 8));
}

function resolveEnabledSources(
  mode: KnowledgeSearchOptions["mode"],
  sources: KnowledgeSearchOptions["sources"]
): SearchableKnowledgeSource[] {
  if (mode === "rag") return ["rag"];
  if (mode === "graph") return ["graph"];
  if (mode === "beelink") return ["beelink"];
  const unique = [...new Set((sources ?? KNOWLEDGE_SOURCES).filter((source): source is SearchableKnowledgeSource =>
    source === "rag" || source === "graph" || source === "beelink"
  ))];
  return unique.length > 0 ? unique : [...KNOWLEDGE_SOURCES];
}

function mergeHits(args: {
  buckets: Record<SearchableKnowledgeSource, KnowledgeHit[]>;
  topK: number;
  balanced: boolean;
}): KnowledgeHit[] {
  const buckets = Object.entries(args.buckets).map(([source, hits]) => ({
    source: source as SearchableKnowledgeSource,
    hits: sortHits(hits),
  }));
  const nonEmpty = buckets.filter((bucket) => bucket.hits.length > 0);
  if (!args.balanced || nonEmpty.length <= 1 || args.topK < 2) {
    return sortHits(nonEmpty.flatMap((bucket) => bucket.hits)).slice(0, args.topK);
  }

  const merged: KnowledgeHit[] = [];
  const rankedBuckets = nonEmpty.sort((a, b) =>
    (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0) || a.source.localeCompare(b.source)
  );
  for (const bucket of rankedBuckets) {
    if (merged.length >= args.topK) break;
    merged.push(bucket.hits.shift()!);
  }
  return dedupeHits([...merged, ...sortHits(rankedBuckets.flatMap((bucket) => bucket.hits))]).slice(0, args.topK);
}

function sortHits(hits: KnowledgeHit[]): KnowledgeHit[] {
  return [...hits].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function dedupeHits(hits: KnowledgeHit[]): KnowledgeHit[] {
  const seen = new Set<string>();
  const deduped: KnowledgeHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    deduped.push(hit);
  }
  return deduped;
}

interface RerankSignals {
  paths: string[];
  basenames: string[];
  identifiers: string[];
}

function extractRerankSignals(query: string): RerankSignals {
  const paths = [...new Set([...query.matchAll(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md)/g)].map((match) => match[0]))];
  const basenames = [...new Set(paths.map((item) => item.split("/").pop()).filter((item): item is string => Boolean(item)))];
  const pathTokens = new Set(paths.flatMap((item) =>
    item.split(/[^A-Za-z0-9_$]+/).flatMap((part) => {
      const stem = part.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md)$/i, "");
      return stem && stem !== part ? [part, stem] : [part];
    })
  ).map((item) => item.toLowerCase()).filter(Boolean));
  const codeIdentifiers = [...query.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()).filter(Boolean);
  const wordIdentifiers = query.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
  const ignored = new Set([
    "the", "and", "for", "from", "with", "what", "where", "which", "who",
    "call", "calls", "caller", "callers", "callee", "callees", "symbol", "function", "class",
    "import", "imports", "dependency", "dependencies", "dependents",
  ]);
  const identifiers = [...new Set([...codeIdentifiers, ...wordIdentifiers]
    .filter((item) => {
      const lower = item.toLowerCase();
      return !ignored.has(lower) && !pathTokens.has(lower) && !paths.includes(item);
    }))];
  return { paths, basenames, identifiers };
}

function rerankHit(hit: KnowledgeHit, signals: RerankSignals): KnowledgeHit {
  const reasons: string[] = [];
  let boost = 0;
  const filePath = hit.filePath ?? "";
  for (const candidate of signals.paths) {
    if (filePath === candidate) {
      boost += 30;
      reasons.push(`path:${candidate}`);
    } else if (filePath.endsWith(`/${candidate}`)) {
      boost += 24;
      reasons.push(`path-suffix:${candidate}`);
    }
  }
  for (const basename of signals.basenames) {
    if (filePath.split("/").pop() === basename) {
      boost += 12;
      reasons.push(`basename:${basename}`);
    }
  }
  const searchable = `${hit.title}\n${hit.excerpt}`.toLowerCase();
  for (const identifier of signals.identifiers) {
    if (containsIdentifier(searchable, identifier.toLowerCase())) {
      boost += 8;
      reasons.push(`identifier:${identifier}`);
    }
  }
  if (boost === 0) return hit;
  return {
    ...hit,
    score: hit.score + boost,
    provenance: {
      ...hit.provenance,
      baseScore: hit.score,
      rerankBoost: boost,
      rerankReasons: reasons,
    },
  };
}

function containsIdentifier(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`, "i").test(text);
}

function searchGraph(db: import("better-sqlite3").Database, query: string, topK: number): KnowledgeHit[] {
  const intent = parseGraphIntent(query);
  const hits: KnowledgeHit[] = [];

  if (intent.kind === "callers") {
    hits.push(...whoCalls(db, intent.arg).slice(0, topK).map(callerHit));
  } else if (intent.kind === "callees") {
    hits.push(...whatCalls(db, intent.arg).slice(0, topK).map(calleeHit));
  } else if (intent.kind === "dependents") {
    hits.push(...dependentsOf(db, intent.arg).slice(0, topK).map(dependentHit));
  } else if (intent.kind === "dependencies") {
    hits.push(...dependenciesOf(db, intent.arg).slice(0, topK).map(dependencyHit));
  } else if (intent.kind === "symbol-file") {
    hits.push(...listSymbolsInFile(db, intent.arg).slice(0, topK).map(symbolHit));
  } else {
    hits.push(...findSymbolsByName(db, intent.arg).slice(0, topK).map(symbolHit));
  }

  return hits;
}

type GraphIntent =
  | { kind: "callers"; arg: string }
  | { kind: "callees"; arg: string }
  | { kind: "dependents"; arg: string }
  | { kind: "dependencies"; arg: string }
  | { kind: "symbol"; arg: string }
  | { kind: "symbol-file"; arg: string };

function parseGraphIntent(query: string): GraphIntent {
  const trimmed = query.trim();
  const pathLike = extractPathLike(trimmed);
  if (/谁调用|谁用|callers?|references?/i.test(trimmed)) {
    return { kind: "callers", arg: extractSymbolName(trimmed) };
  }
  if (/调用了什么|what calls|callees?/i.test(trimmed) && pathLike) {
    return { kind: "callees", arg: pathLike };
  }
  if (/谁依赖|被谁 import|dependents?/i.test(trimmed) && pathLike) {
    return { kind: "dependents", arg: pathLike };
  }
  if (/依赖什么|import 了什么|dependencies?/i.test(trimmed) && pathLike) {
    return { kind: "dependencies", arg: pathLike };
  }
  if (pathLike) {
    return { kind: "symbol-file", arg: pathLike };
  }
  return { kind: "symbol", arg: extractSymbolName(trimmed) };
}

function extractPathLike(text: string): string | null {
  const match = text.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md)/);
  return match?.[0] ?? null;
}

function extractSymbolName(text: string): string {
  const code = /`([^`]+)`/.exec(text)?.[1]?.trim();
  if (code) return code;
  const words = text.match(/[A-Za-z_$][A-Za-z0-9_$]{1,}/g) ?? [];
  const ignored = new Set(["callers", "caller", "references", "reference", "symbol", "function", "class", "who", "calls"]);
  return [...words].reverse().find((word) => !ignored.has(word.toLowerCase())) ?? text.trim();
}

function callerHit(row: CallerRow): KnowledgeHit {
  return {
    id: `graph:caller:${row.callerPath}:${row.callerLine}:${row.calleeName}`,
    source: "graph",
    title: `${row.callerPath}:${row.callerLine} calls ${row.calleeName}`,
    excerpt: `${row.callerPath}:${row.callerLine} -> ${row.calleePath ?? "unknown"}::${row.calleeName}`,
    filePath: row.callerPath,
    lineStart: row.callerLine,
    lineEnd: row.callerLine,
    score: 100,
    provenance: { graphQuery: "callers", calleeName: row.calleeName, calleePath: row.calleePath },
  };
}

function calleeHit(row: CallerRow): KnowledgeHit {
  return {
    id: `graph:callee:${row.callerPath}:${row.callerLine}:${row.calleeName}`,
    source: "graph",
    title: `${row.callerPath}:${row.callerLine} calls ${row.calleeName}`,
    excerpt: `${row.calleeName}${row.calleePath ? ` -> ${row.calleePath}` : ""}`,
    filePath: row.callerPath,
    lineStart: row.callerLine,
    lineEnd: row.callerLine,
    score: 90,
    provenance: { graphQuery: "callees", calleeName: row.calleeName, calleePath: row.calleePath },
  };
}

function dependentHit(row: ImportRow): KnowledgeHit {
  return {
    id: `graph:dependent:${row.srcPath}:${row.module}`,
    source: "graph",
    title: `${row.srcPath} imports ${row.module}`,
    excerpt: `${row.srcPath} imports ${row.module}${row.dstPath ? ` -> ${row.dstPath}` : ""}`,
    filePath: row.srcPath,
    score: 80,
    provenance: { graphQuery: "dependents", module: row.module, dstPath: row.dstPath },
  };
}

function dependencyHit(row: ImportRow): KnowledgeHit {
  return {
    id: `graph:dependency:${row.srcPath}:${row.module}`,
    source: "graph",
    title: `${row.srcPath} depends on ${row.module}`,
    excerpt: `${row.module}${row.dstPath ? ` -> ${row.dstPath}` : " (external)"}`,
    filePath: row.srcPath,
    score: 80,
    provenance: { graphQuery: "dependencies", module: row.module, dstPath: row.dstPath },
  };
}

function symbolHit(row: SymbolRow): KnowledgeHit {
  return {
    id: `graph:symbol:${row.symbolId}`,
    source: "graph",
    title: `${row.relPath}:${row.line} ${row.kind} ${row.name}`,
    excerpt: `${row.kind} ${row.name}${row.exported ? " (exported)" : ""}`,
    filePath: row.relPath,
    lineStart: row.line,
    lineEnd: row.line,
    score: 70,
    provenance: { graphQuery: "symbol", symbolId: row.symbolId, exported: row.exported },
  };
}

export function formatKnowledgeHits(
  hits: KnowledgeHit[],
  diagnostics?: KnowledgeSearchResult["diagnostics"]
): string {
  if (hits.length === 0) {
    const indexed = diagnostics && (diagnostics.ragAvailable || diagnostics.graphAvailable || diagnostics.beelinkAvailable);
    return indexed
      ? "[knowledge_search] no matches"
      : "[knowledge_search] index is empty. Run `/rag index` and/or `/graph build` first.";
  }
  const header = diagnostics
    ? `[knowledge_search] hits=${hits.length} sources=${diagnostics.enabledSources.join(",")} rag=${diagnostics.ragHits} graph=${diagnostics.graphHits} beelink=${diagnostics.beelinkHits}`
    : `[knowledge_search] hits=${hits.length}`;
  return [
    header,
    hits
    .map((hit, index) => {
      const loc = hit.filePath
        ? `${hit.filePath}${hit.lineStart ? `:${hit.lineStart}${hit.lineEnd && hit.lineEnd !== hit.lineStart ? `-${hit.lineEnd}` : ""}` : ""}`
        : "no-file";
      return [
        `[${index + 1}] ${hit.source} score=${hit.score.toFixed(3)} ${loc}`,
        `title: ${hit.title}`,
        `excerpt: ${hit.excerpt}`,
        `provenance: ${JSON.stringify(hit.provenance)}`,
      ].join("\n");
    })
    .join("\n\n"),
  ].join("\n\n");
}

function emptyResult(reason: string): KnowledgeSearchResult {
  return {
    hits: [],
    text: `[knowledge_search] ${reason}`,
    diagnostics: {
      ragAvailable: false,
      graphAvailable: false,
      beelinkAvailable: false,
      ragHits: 0,
      graphHits: 0,
      beelinkHits: 0,
      enabledSources: [...KNOWLEDGE_SOURCES],
    },
  };
}

function clampTopK(value: number | undefined): number {
  return Math.min(MAX_TOP_K, Math.max(1, value ?? DEFAULT_TOP_K));
}

function clipExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EXCERPT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_EXCERPT_CHARS - 3)}...`;
}
