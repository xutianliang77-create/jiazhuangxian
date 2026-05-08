import type { BeelinkPlatformClient } from "./platformClient";
import { prepareSqlReference } from "./sqlReference";
import type { TableColumn } from "./types";

const HEADER_PATTERN = /^[A-Za-z_][A-Za-z0-9_ -]{1,60}$/;

export async function inferHeaderHints(
  client: BeelinkPlatformClient,
  objectPath: string,
  columns: TableColumn[],
  options: { timeoutMs: number }
): Promise<TableColumn[]> {
  if (columns.length === 0) return columns;
  const sql = `select * from ${prepareSqlReference(objectPath)} limit 6`;
  const preview = await client.runSqlQuery({ sql, previewRows: 6, timeoutMs: options.timeoutMs });
  const first = preview.rows[0];
  if (!first || !looksLikeHeaderRow(first, columns)) return columns;
  const sampleRows = preview.rows.slice(1);
  return columns.map((column) => {
    const rawHeader = first[column.name];
    const businessName = typeof rawHeader === "string" ? normalizeHeader(rawHeader) : undefined;
    const sampleValues = sampleRows
      .map((row) => row[column.name])
      .filter((value): value is string | number | boolean => ["string", "number", "boolean"].includes(typeof value))
      .map((value) => String(value))
      .filter((value) => value.length > 0)
      .slice(0, 5);
    return {
      ...column,
      ...(businessName ? { businessName, headerConfidence: 0.9 } : {}),
      ...(sampleValues.length > 0 ? { sampleValues } : {}),
    };
  });
}

function looksLikeHeaderRow(row: Record<string, unknown>, columns: TableColumn[]): boolean {
  if (columns.length === 0) return false;
  const values = columns.map((column) => row[column.name]);
  const stringValues = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (stringValues.length < Math.max(2, Math.ceil(columns.length * 0.6))) return false;
  const headerish = stringValues.filter((value) => HEADER_PATTERN.test(normalizeHeader(value)));
  return headerish.length >= Math.max(2, Math.ceil(stringValues.length * 0.6));
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}
