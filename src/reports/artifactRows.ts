import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { reportDatasetColumns, reportDatasetRows } from "./compat";
import type { ArtifactRef, ReportArtifact, ReportColumn, ReportDataset } from "./types";

export interface HydrateReportRowsOptions {
  artifactsRoot: string;
  maxRows?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export async function hydrateReportArtifactRows(
  report: ReportArtifact,
  options: HydrateReportRowsOptions
): Promise<ReportArtifact> {
  const datasets = await Promise.all(
    report.datasets.map((dataset) => hydrateDatasetRows(dataset, options))
  );
  return { ...report, datasets };
}

export async function hydrateDatasetRows(
  dataset: ReportDataset,
  options: HydrateReportRowsOptions
): Promise<ReportDataset> {
  const inlineRows = reportDatasetRows(dataset);
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
  if (inlineRows.length >= maxRows) return dataset;

  const artifact = dataset.provenance?.artifacts?.result ?? dataset.resultArtifact;
  if (!artifact) return dataset;

  const loaded = await readRowsArtifact(artifact, options);
  if (!loaded || loaded.rows.length === 0) return dataset;

  const rows = loaded.rows.slice(0, maxRows);
  const columns = reportDatasetColumns(dataset).length > 0
    ? reportDatasetColumns(dataset)
    : loaded.columns;
  return {
    ...dataset,
    columns,
    rowCount: dataset.rowCount ?? loaded.rowCount,
    previewRows: dataset.previewRows || Math.min(rows.length, maxRows),
    ...({ rows } as Record<string, unknown>),
  };
}

async function readRowsArtifact(
  artifact: ArtifactRef,
  options: HydrateReportRowsOptions
): Promise<{ rows: Array<Record<string, unknown>>; columns: ReportColumn[]; rowCount?: number } | null> {
  const artifactPath = safeArtifactPath(artifact.path, options.artifactsRoot);
  if (!artifactPath) return null;

  try {
    const info = await stat(artifactPath);
    if (info.size > (options.maxBytes ?? DEFAULT_MAX_BYTES)) return null;
    const parsed = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
    const rows = extractRows(parsed);
    if (rows.length === 0) return null;
    return {
      rows,
      columns: extractColumns(parsed, rows),
      rowCount: extractRowCount(parsed) ?? rows.length,
    };
  } catch {
    return null;
  }
}

function safeArtifactPath(value: string, artifactsRoot: string): string | null {
  const root = path.resolve(artifactsRoot);
  const target = path.resolve(value);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function extractRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  const record = isRecord(value) ? value : {};
  for (const key of ["rows", "data", "preview"]) {
    const rows = record[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
  const results = isRecord(record.results) ? record.results : {};
  return Array.isArray(results.rows) ? results.rows.filter(isRecord) : [];
}

function extractColumns(value: unknown, rows: Array<Record<string, unknown>>): ReportColumn[] {
  const record = isRecord(value) ? value : {};
  const columns = Array.isArray(record.columns) ? record.columns.filter(isRecord) : [];
  if (columns.length > 0) {
    return columns
      .map((column) => ({
        name: typeof column.name === "string" ? column.name : "",
        ...(typeof column.type === "string" ? { type: column.type } : {}),
      }))
      .filter((column) => column.name);
  }
  return Object.keys(rows[0] ?? {}).map((name) => ({ name }));
}

function extractRowCount(value: unknown): number | undefined {
  const record = isRecord(value) ? value : {};
  const summary = isRecord(record.summary) ? record.summary : {};
  for (const candidate of [record.rowCount, record.exportedRows, summary.rowCount, summary.exportedRows]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
