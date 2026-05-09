import type { ChartKind, ChartSpec } from "../charts/types";
import type { ReportChart, ReportColumn, ReportDataset } from "./types";

const CHART_KINDS = new Set<ChartKind>([
  "bar",
  "line",
  "area",
  "pie",
  "scatter",
  "combo",
  "heatmap",
  "histogram",
  "box",
  "funnel",
  "gauge",
  "map",
  "pivot",
]);

export function reportDatasetRows(dataset: ReportDataset): Array<Record<string, unknown>> {
  const record = dataset as unknown as Record<string, unknown>;
  for (const key of ["rows", "data", "preview"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

export function reportDatasetPreviewRows(dataset: ReportDataset): number {
  const provenanceRows = dataset.provenance?.preview?.rows;
  if (typeof provenanceRows === "number") return provenanceRows;
  if (typeof dataset.previewRows === "number") return dataset.previewRows;
  const record = dataset as unknown as { previewRowCount?: unknown };
  if (typeof record.previewRowCount === "number") return record.previewRowCount;
  return reportDatasetRows(dataset).length;
}

export function reportDatasetColumns(dataset: ReportDataset): ReportColumn[] {
  if (Array.isArray(dataset.columns) && dataset.columns.length > 0) return dataset.columns;
  const first = reportDatasetRows(dataset)[0];
  if (!first) return [];
  return Object.keys(first).map((name) => ({
    name,
    type: inferColumnType(reportDatasetRows(dataset).map((row) => row[name])),
  }));
}

export function reportChartKind(chart: ReportChart): ChartKind {
  const record = chart as unknown as { kind?: unknown; type?: unknown };
  return normalizeChartKind(chart.chart?.kind ?? record.kind ?? record.type);
}

export function reportChartSpec(chart: ReportChart, dataset?: ReportDataset): ChartSpec {
  const rows = dataset ? reportDatasetRows(dataset) : [];
  const columns = dataset ? reportDatasetColumns(dataset).map((column) => column.name) : [];
  const base: Partial<ChartSpec> = {
    ...(chart.chart ?? {}),
    kind: reportChartKind(chart),
  };
  if (!base.x) base.x = inferDimension(rows, columns);
  if (!base.y) base.y = inferMeasure(rows, columns, base.x);
  return base as ChartSpec;
}

export function normalizeChartKind(value: unknown): ChartKind {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replaceAll("_", "-");
    if (CHART_KINDS.has(normalized as ChartKind)) return normalized as ChartKind;
    if (normalized === "column" || normalized === "bar-chart") return "bar";
    if (normalized === "donut" || normalized === "doughnut") return "pie";
  }
  return "bar";
}

function inferDimension(rows: Array<Record<string, unknown>>, columns: string[]): string | undefined {
  for (const column of columns) {
    if (!isMostlyNumeric(rows.map((row) => row[column]))) return column;
  }
  return columns[0];
}

function inferMeasure(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  dimension: string | undefined
): string | undefined {
  for (const column of columns) {
    if (column === dimension) continue;
    if (isMostlyNumeric(rows.map((row) => row[column]))) return column;
  }
  return columns.find((column) => column !== dimension);
}

function inferColumnType(values: unknown[]): string | undefined {
  if (isMostlyNumeric(values)) return "number";
  return undefined;
}

function isMostlyNumeric(values: unknown[]): boolean {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (present.length === 0) return false;
  const numeric = present.filter((value) => Number.isFinite(typeof value === "number" ? value : Number(value)));
  return numeric.length / present.length >= 0.8;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
