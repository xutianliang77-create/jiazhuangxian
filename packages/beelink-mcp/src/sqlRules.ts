import { exploreForQuestion } from "./exploreForQuestion";
import { assertReadOnlySql } from "./sqlGuard";
import { prepareSqlReference } from "./sqlReference";
import type { BeelinkConfig, CatalogEntry, SqlGuidanceResult, SqlRuleCheckResult } from "./types";

interface GuidanceClient {
  searchCatalog(input: { query: string; limit?: number }): Promise<CatalogEntry[]>;
  getSchemaOfTable(path: string): Promise<{
    path: string;
    columns: Array<{ name: string; type: string; nullable?: boolean; description?: string }>;
  }>;
}

const SQL_RULES = [
  "Use read-only SQL only: SELECT/WITH/SHOW/DESCRIBE/EXPLAIN.",
  "Do not use multiple SQL statements.",
  "Quote special catalog path segments such as @x as \"@x\".",
  "Use only known tables and columns unless you inspect schema first.",
  "Add LIMIT for preview queries unless the query is an aggregate returning a small result.",
  "When using aggregation, include non-aggregated dimensions in GROUP BY.",
  "If a business term is ambiguous, inspect metadata instead of inventing columns.",
];

const SPECIAL_PATH_PATTERN = /(^|[\s,(])(@[A-Za-z0-9_]+(?:\.[A-Za-z0-9_()$-]+)+)/g;
const AGG_PATTERN = /\b(sum|count|avg|min|max)\s*\(/i;
const LIMIT_PATTERN = /\blimit\s+\d+\b/i;
const GROUP_BY_PATTERN = /\bgroup\s+by\b/i;
const PREVIEW_QUERY_PATTERN = /^(select|with)\b/i;

export async function buildSqlGuidance(
  client: GuidanceClient,
  config: BeelinkConfig,
  input: { question: string; limit?: number; probeIfEmpty?: boolean }
): Promise<SqlGuidanceResult> {
  const exploration = await exploreForQuestion(client, config, {
    question: input.question,
    limit: input.limit,
    probeIfEmpty: input.probeIfEmpty,
  });
  return {
    question: input.question,
    exploration,
    rules: SQL_RULES,
  };
}

export function checkSqlAgainstRules(input: { sql: string }): SqlRuleCheckResult {
  const sql = input.sql.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestedFixes: string[] = [];

  try {
    assertReadOnlySql(sql);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const specialPaths = findSpecialPaths(sql);
  for (const path of specialPaths) {
    warnings.push(`${path} should be quoted as ${prepareSqlReference(path)}`);
    suggestedFixes.push(`Replace ${path} with ${prepareSqlReference(path)}`);
  }

  if (PREVIEW_QUERY_PATTERN.test(sql) && !LIMIT_PATTERN.test(sql) && !isSmallAggregate(sql)) {
    warnings.push("No LIMIT found; add a preview LIMIT before running exploratory queries.");
    suggestedFixes.push("Add LIMIT 5 for preview.");
  }

  if (AGG_PATTERN.test(sql) && likelyHasSelectedDimension(sql) && !GROUP_BY_PATTERN.test(sql)) {
    warnings.push("Aggregation query appears to select non-aggregated dimensions without GROUP BY.");
    suggestedFixes.push("Add GROUP BY for every non-aggregated selected dimension.");
  }

  return { sql, errors, warnings: dedupe(warnings), suggestedFixes: dedupe(suggestedFixes) };
}

function findSpecialPaths(sql: string): string[] {
  const out: string[] = [];
  for (const match of sql.matchAll(SPECIAL_PATH_PATTERN)) {
    const path = match[2];
    const start = match.index === undefined ? -1 : match.index + match[1].length;
    if (!path || start <= 0) {
      if (path) out.push(path);
      continue;
    }
    const previous = sql[start - 1];
    if (previous !== '"' && previous !== "`") out.push(path);
  }
  return dedupe(out);
}

function isSmallAggregate(sql: string): boolean {
  return AGG_PATTERN.test(sql) && !likelyHasSelectedDimension(sql) && !/\bgroup\s+by\b/i.test(sql);
}

function likelyHasSelectedDimension(sql: string): boolean {
  const match = /^\s*select\s+([\s\S]+?)\s+from\s+/i.exec(sql);
  if (!match) return false;
  const selectList = match[1] ?? "";
  const items = selectList.split(",").map((item) => item.trim()).filter(Boolean);
  return items.some((item) => !AGG_PATTERN.test(item) && item !== "*");
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
