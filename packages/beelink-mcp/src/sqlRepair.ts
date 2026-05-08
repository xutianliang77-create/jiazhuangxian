import { exploreForQuestion } from "./exploreForQuestion";
import { prepareSqlReference } from "./sqlReference";
import { checkSqlAgainstRules } from "./sqlRules";
import type { BeelinkConfig, CatalogEntry, SqlRepairResult } from "./types";

interface RepairClient {
  searchCatalog(input: { query: string; limit?: number }): Promise<CatalogEntry[]>;
  getSchemaOfTable(path: string): Promise<{
    path: string;
    columns: Array<{ name: string; type: string; nullable?: boolean; description?: string }>;
  }>;
}

const SPECIAL_PATH_PATTERN = /(^|[\s,(])(@[A-Za-z0-9_]+(?:\.[A-Za-z0-9_()$-]+)+)/g;

export async function repairSqlAttempt(
  client: RepairClient,
  config: BeelinkConfig,
  input: {
    sql: string;
    error: string;
    question?: string;
    limit?: number;
    probeIfNeeded?: boolean;
  }
): Promise<SqlRepairResult> {
  const sql = input.sql.trim();
  const error = input.error.trim();
  const category = classifyError(error);
  const ruleCheck = checkSqlAgainstRules({ sql });
  const repairedSql = repairSpecialReferences(sql);
  const suggestedActions = suggestedActionsFor(category);
  const shouldProbe = input.probeIfNeeded !== false && categoryNeedsProbe(category) && input.question?.trim();

  if (!shouldProbe) {
    return {
      category,
      sql,
      error,
      ...(repairedSql !== sql ? { repairedSql } : {}),
      ruleCheck,
      suggestedActions,
    };
  }

  const exploration = await exploreForQuestion(client, config, {
    question: input.question as string,
    limit: input.limit,
    probeIfEmpty: true,
  });

  return {
    category,
    sql,
    error,
    ...(repairedSql !== sql ? { repairedSql } : {}),
    ruleCheck,
    suggestedActions,
    exploration,
  };
}

function classifyError(error: string): SqlRepairResult["category"] {
  const lowered = error.toLowerCase();
  if (
    lowered.includes("lexical error") ||
    lowered.includes("encountered: \"@\"") ||
    lowered.includes("encountered \"@\"") ||
    lowered.includes("after : \"\"")
  ) {
    return "sql_reference";
  }
  if (
    lowered.includes("object '") ||
    lowered.includes(" not found") ||
    lowered.includes("does not exist") ||
    lowered.includes("unknown column") ||
    (lowered.includes("column") && lowered.includes("not found"))
  ) {
    return "metadata_missing";
  }
  if (
    lowered.includes("group by") ||
    lowered.includes("not being grouped") ||
    lowered.includes("aggregate") ||
    (lowered.includes("expression") && lowered.includes("group"))
  ) {
    return "aggregation";
  }
  if (
    lowered.includes("permission") ||
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden") ||
    lowered.includes("illegalaccessexception") ||
    lowered.includes("access denied")
  ) {
    return "permission";
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) return "timeout";
  if (
    lowered.includes("only read-only") ||
    lowered.includes("unsafe sql") ||
    lowered.includes("multiple sql statements")
  ) {
    return "safety";
  }
  if (
    lowered.includes("syntax") ||
    lowered.includes("parse") ||
    lowered.includes("parser") ||
    lowered.includes("encountered")
  ) {
    return "syntax";
  }
  return "unknown";
}

function categoryNeedsProbe(category: SqlRepairResult["category"]): boolean {
  return category === "metadata_missing" || category === "permission" || category === "unknown";
}

function suggestedActionsFor(category: SqlRepairResult["category"]): string[] {
  switch (category) {
    case "sql_reference":
      return [
        "Use PrepareSqlReference for catalog paths with @, spaces, parentheses, or reserved words.",
        "Run CheckSqlAgainstRules again after replacing unsafe references.",
      ];
    case "metadata_missing":
      return [
        "Run ExploreForQuestion or SearchMetadataIndex to refresh candidate tables and columns.",
        "Use GetSchemaOfTable on the selected candidate before rewriting SQL.",
      ];
    case "aggregation":
      return [
        "Check every selected non-aggregated dimension and add it to GROUP BY.",
        "Keep ORDER BY expressions aligned with aggregate measures.",
      ];
    case "permission":
      return [
        "Record the permission boundary and explain it to the user.",
        "Search metadata for an accessible table or ask for an account with sufficient privileges.",
      ];
    case "timeout":
      return [
        "Add narrower filters, a LIMIT, or aggregate before previewing.",
        "Avoid full-table exploratory scans.",
      ];
    case "syntax":
      return [
        "Simplify the SQL and re-check quoting, commas, aliases, and reserved words.",
        "Run CheckSqlAgainstRules before retrying.",
      ];
    case "safety":
      return [
        "Rewrite as a read-only SELECT/WITH/SHOW/DESCRIBE/EXPLAIN statement.",
        "Remove multiple statements and unsafe keywords.",
      ];
    case "unknown":
      return [
        "Run ExploreForQuestion to collect fresh semantic and metadata context.",
        "Inspect the upstream error and rewrite the SQL conservatively.",
      ];
  }
}

function repairSpecialReferences(sql: string): string {
  return sql.replace(SPECIAL_PATH_PATTERN, (full, prefix: string, path: string, offset: number, source: string) => {
    const start = offset + prefix.length;
    const previous = start > 0 ? source[start - 1] : "";
    if (previous === '"' || previous === "`") return full;
    return `${prefix}${prepareSqlReference(path)}`;
  });
}
