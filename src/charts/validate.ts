import type { ChartColumn, ChartRenderInput, ChartSpec } from "./types";

export interface ChartValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const NUMERIC_TYPE_RE = /(int|decimal|double|float|number|numeric|real|bigint|smallint|tinyint)/i;
const TIME_TYPE_RE = /(date|time|timestamp)/i;

export function validateChartRenderInput(input: ChartRenderInput): ChartValidationResult {
  return validateChartSpec(input.spec, input.columns);
}

export function validateChartSpec(spec: ChartSpec, columns: ChartColumn[]): ChartValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const columnMap = new Map(columns.map((column) => [column.name, column]));

  if (spec.limit !== undefined && (!Number.isFinite(spec.limit) || spec.limit <= 0)) {
    errors.push("chart limit must be a positive number");
  }
  if (spec.limit !== undefined && spec.limit > 1000) {
    warnings.push("chart limit is high; consider aggregating or limiting rows before rendering");
  }

  switch (spec.kind) {
    case "bar":
    case "line":
    case "area":
    case "combo":
      requireField("x", spec.x, columnMap, errors);
      requireMeasure("y", firstY(spec), columnMap, errors);
      for (const y of allY(spec)) requireMeasure("y", y, columnMap, errors);
      if ((spec.kind === "line" || spec.kind === "area") && spec.x && !isTimeLike(columnMap.get(spec.x))) {
        warnings.push("line/area charts usually work best with a time-like or ordered x field");
      }
      break;
    case "pie":
    case "funnel":
      requireField("x", spec.x, columnMap, errors);
      requireMeasure("y", firstY(spec), columnMap, errors);
      if (allY(spec).length > 1) errors.push(`${spec.kind} chart supports exactly one measure field`);
      break;
    case "scatter": {
      const yFields = allY(spec);
      requireMeasure("x", spec.x, columnMap, errors);
      if (yFields.length === 0) errors.push("scatter chart requires at least one y measure field");
      for (const y of yFields.slice(0, 2)) requireMeasure("y", y, columnMap, errors);
      break;
    }
    case "heatmap":
      requireField("x", spec.x, columnMap, errors);
      requireField("series", spec.series, columnMap, errors);
      requireMeasure("y", firstY(spec), columnMap, errors);
      break;
    case "gauge":
      requireMeasure("y", firstY(spec), columnMap, errors);
      break;
    case "histogram":
    case "box":
      requireMeasure("x", spec.x, columnMap, errors);
      break;
    case "map":
      requireField("x", spec.x, columnMap, errors);
      requireMeasure("y", firstY(spec), columnMap, errors);
      warnings.push("map rendering is not supported in the first dashboard slice; use table fallback");
      break;
    case "pivot":
      warnings.push("pivot rendering falls back to table in the first dashboard slice");
      break;
    default:
      errors.push(`unsupported chart kind: ${(spec as { kind?: string }).kind ?? "unknown"}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function allY(spec: ChartSpec): string[] {
  if (Array.isArray(spec.y)) return spec.y;
  return spec.y ? [spec.y] : [];
}

function firstY(spec: ChartSpec): string | undefined {
  return allY(spec)[0];
}

function requireField(label: string, field: string | undefined, columns: Map<string, ChartColumn>, errors: string[]): void {
  if (!field) {
    errors.push(`${label} field is required`);
    return;
  }
  if (!columns.has(field)) errors.push(`${label} field does not exist: ${field}`);
}

function requireMeasure(label: string, field: string | undefined, columns: Map<string, ChartColumn>, errors: string[]): void {
  requireField(label, field, columns, errors);
  if (!field) return;
  const column = columns.get(field);
  if (column && !isMeasureLike(column)) errors.push(`${label} field must be numeric: ${field}`);
}

function isMeasureLike(column: ChartColumn | undefined): boolean {
  if (!column) return false;
  if (column.semanticRole === "measure") return true;
  return Boolean(column.type && NUMERIC_TYPE_RE.test(column.type));
}

function isTimeLike(column: ChartColumn | undefined): boolean {
  if (!column) return false;
  if (column.semanticRole === "time") return true;
  return Boolean(column.type && TIME_TYPE_RE.test(column.type));
}
