import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  BeelinkConfig,
  InitSemanticLayerResult,
  MetadataTableProfile,
  SemanticEntity,
  SemanticMetric,
} from "./types";

export function initSemanticLayerDraft(
  config: Pick<BeelinkConfig, "metadataDbPath" | "semanticLayerPath" | "glossaryPath">,
  profiles: MetadataTableProfile[],
  options: { overwrite?: boolean } = {}
): InitSemanticLayerResult {
  const draft = buildSemanticDraft(profiles);
  mkdirSync(path.dirname(config.semanticLayerPath), { recursive: true });
  mkdirSync(path.dirname(config.glossaryPath), { recursive: true });

  const semanticLayerCreated = !existsSync(config.semanticLayerPath);
  const semanticLayerUpdated = semanticLayerCreated || options.overwrite === true;
  if (semanticLayerUpdated) {
    writeFileSync(config.semanticLayerPath, JSON.stringify(draft.semanticLayer, null, 2) + "\n", "utf8");
  }

  const glossaryCreated = !existsSync(config.glossaryPath);
  const glossaryUpdated = glossaryCreated || options.overwrite === true;
  if (glossaryUpdated) {
    writeFileSync(config.glossaryPath, draft.glossary, "utf8");
  }

  return {
    semanticLayerPath: config.semanticLayerPath,
    glossaryPath: config.glossaryPath,
    semanticLayerCreated,
    glossaryCreated,
    semanticLayerUpdated,
    glossaryUpdated,
    tableCount: profiles.length,
    metricCount: draft.semanticLayer.metrics.length,
    entityCount: draft.semanticLayer.entities.length,
  };
}

function buildSemanticDraft(profiles: MetadataTableProfile[]): {
  semanticLayer: { metrics: SemanticMetric[]; entities: SemanticEntity[] };
  glossary: string;
} {
  const metrics: SemanticMetric[] = [];
  const entities: SemanticEntity[] = [];
  const glossaryLines = [
    "# Beelink Semantic Glossary",
    "",
    "> Draft generated from metadata hints. Please review business definitions before relying on them.",
    "",
  ];

  for (const table of profiles) {
    const tableLabel = table.path;
    const item = findColumn(table, ["items", "item", "product", "food", "name"]);
    const quantity = findColumn(table, ["quantity", "qty", "sold_units", "units_sold", "sales_volume", "volume", "销量", "数量"]);
    const amount = findColumn(table, ["amount", "sales", "revenue", "price", "total"]);
    const order = findColumn(table, ["order_id", "order", "transaction"]);
    const rating = findColumn(table, ["ratings", "rating", "score"]);

    if (item) {
      entities.push({
        name: "食物",
        aliases: ["菜品", "食品", "商品", "food", "items"],
        candidateTables: [table.path],
      });
      metrics.push({
        name: "最畅销商品",
        aliases: ["卖得最好", "销量最高", "最受欢迎", "top selling"],
        table: table.path,
        dimensions: [item.columnName],
        measures: quantity
          ? [{ name: "销量", expression: `SUM(${quantity.columnName})` }]
          : [{ name: "出现次数", expression: `COUNT(*)` }],
        defaultOrderBy: quantity ? `SUM(${quantity.columnName}) DESC` : "COUNT(*) DESC",
      });
    }

    if (item && amount) {
      metrics.push({
        name: "销售额最高商品",
        aliases: ["金额最高", "收入最高", "销售额最高"],
        table: table.path,
        dimensions: [item.columnName],
        measures: [{ name: "销售额", expression: `SUM(${amount.columnName})` }],
        defaultOrderBy: `SUM(${amount.columnName}) DESC`,
      });
    }

    glossaryLines.push(`## ${tableLabel}`, "");
    glossaryLines.push(`- Table path: \`${table.path}\``);
    if (item) {
      glossaryLines.push(
        `- “食物/菜品/商品/items” likely maps to physical column \`${item.columnName}\` (${item.businessName ?? "unknown"}).`
      );
    }
    if (amount) {
      glossaryLines.push(
        `- “销售额/金额/收入” likely maps to physical column \`${amount.columnName}\` (${amount.businessName ?? "unknown"}).`
      );
    }
    if (quantity) {
      glossaryLines.push(
        `- “销量/数量/售出件数” likely maps to physical column \`${quantity.columnName}\` (${quantity.businessName ?? "unknown"}).`
      );
    } else if (item) {
      glossaryLines.push("- No explicit quantity column was detected; count-based sales metrics are only a fallback assumption.");
    }
    if (order) {
      glossaryLines.push(
        `- “订单” likely maps to physical column \`${order.columnName}\` (${order.businessName ?? "unknown"}).`
      );
    }
    if (rating) {
      glossaryLines.push(
        `- “评分/评价分” likely maps to physical column \`${rating.columnName}\` (${rating.businessName ?? "unknown"}).`
      );
    }
    if (table.columns.some((column) => column.businessName)) {
      glossaryLines.push("- Inferred header mapping:");
      for (const column of table.columns.filter((c) => c.businessName)) {
        glossaryLines.push(`  - \`${column.columnName}\` -> \`${column.businessName}\``);
      }
    }
    glossaryLines.push("");
  }

  return {
    semanticLayer: { metrics: dedupeMetrics(metrics), entities: dedupeEntities(entities) },
    glossary: glossaryLines.join("\n"),
  };
}

function findColumn(
  table: MetadataTableProfile,
  names: string[]
): MetadataTableProfile["columns"][number] | undefined {
  return table.columns.find((column) => {
    const haystack = `${column.columnName} ${column.businessName ?? ""}`.toLowerCase();
    return names.some((name) => haystack.includes(name.toLowerCase()));
  });
}

function dedupeMetrics(metrics: SemanticMetric[]): SemanticMetric[] {
  const seen = new Set<string>();
  return metrics.filter((metric) => {
    const key = `${metric.name}:${metric.table ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEntities(entities: SemanticEntity[]): SemanticEntity[] {
  const map = new Map<string, SemanticEntity>();
  for (const entity of entities) {
    const existing = map.get(entity.name);
    if (!existing) {
      map.set(entity.name, entity);
      continue;
    }
    existing.candidateTables = Array.from(new Set([...(existing.candidateTables ?? []), ...(entity.candidateTables ?? [])]));
  }
  return Array.from(map.values());
}
