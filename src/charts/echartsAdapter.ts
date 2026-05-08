import { validateChartRenderInput } from "./validate";
import type { ChartRenderInput, ChartSpec } from "./types";

export interface EChartsRenderResult {
  option: Record<string, unknown>;
  warnings: string[];
}

export function toEChartsOption(input: ChartRenderInput): EChartsRenderResult {
  const validation = validateChartRenderInput(input);
  if (!validation.valid) {
    throw new Error(`invalid chart spec: ${validation.errors.join("; ")}`);
  }

  const rows = limitRows(input.rows, input.spec.limit);
  const warnings = [...validation.warnings];

  switch (input.spec.kind) {
    case "bar":
      return { option: axisOption(input.spec, rows, "bar"), warnings };
    case "line":
      return { option: axisOption(input.spec, rows, "line"), warnings };
    case "area":
      return { option: axisOption(input.spec, rows, "line", { area: true }), warnings };
    case "combo":
      return { option: comboOption(input.spec, rows), warnings };
    case "pie":
    case "funnel":
      return { option: pieLikeOption(input.spec, rows), warnings };
    case "scatter":
      return { option: scatterOption(input.spec, rows), warnings };
    case "gauge":
      return { option: gaugeOption(input.spec, rows), warnings };
    case "heatmap":
    case "histogram":
    case "box":
    case "map":
    case "pivot":
      return {
        option: tableFallbackOption(input.spec, rows),
        warnings: [...warnings, `${input.spec.kind} uses table fallback in the first dashboard slice`],
      };
  }
}

function baseOption(spec: ChartSpec): Record<string, unknown> {
  return {
    title: spec.title ? { text: spec.title } : undefined,
    tooltip: spec.options?.showTooltip === false ? undefined : { trigger: "axis" },
    legend: spec.options?.showLegend === false ? undefined : {},
  };
}

function axisOption(
  spec: ChartSpec,
  rows: Array<Record<string, unknown>>,
  kind: "bar" | "line",
  opts: { area?: boolean } = {}
): Record<string, unknown> {
  const x = spec.x!;
  const yFields = yList(spec);
  const categories = rows.map((row) => row[x]);
  const series = yFields.map((field) => ({
    name: field,
    type: kind,
    data: rows.map((row) => numericValue(row[field])),
    ...(opts.area ? { areaStyle: {} } : {}),
    ...(spec.options?.stacked ? { stack: "total" } : {}),
  }));
  const xAxis = { type: "category", data: categories };
  const yAxis = { type: "value" };
  return cleanOption({
    ...baseOption(spec),
    ...(spec.options?.horizontal ? { xAxis: yAxis, yAxis: xAxis } : { xAxis, yAxis }),
    series,
    ...(spec.options?.showDataZoom ? { dataZoom: [{ type: "inside" }, { type: "slider" }] } : {}),
  });
}

function comboOption(spec: ChartSpec, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const x = spec.x!;
  const yFields = yList(spec);
  return cleanOption({
    ...baseOption(spec),
    xAxis: { type: "category", data: rows.map((row) => row[x]) },
    yAxis: { type: "value" },
    series: yFields.map((field, index) => ({
      name: field,
      type: index === yFields.length - 1 ? "line" : "bar",
      data: rows.map((row) => numericValue(row[field])),
    })),
  });
}

function pieLikeOption(spec: ChartSpec, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const x = spec.x!;
  const y = yList(spec)[0]!;
  return cleanOption({
    ...baseOption(spec),
    tooltip: spec.options?.showTooltip === false ? undefined : { trigger: "item" },
    series: [
      {
        name: y,
        type: spec.kind === "funnel" ? "funnel" : "pie",
        data: rows.map((row) => ({ name: String(row[x] ?? ""), value: numericValue(row[y]) })),
      },
    ],
  });
}

function scatterOption(spec: ChartSpec, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const x = spec.x!;
  const y = yList(spec)[0]!;
  return cleanOption({
    ...baseOption(spec),
    xAxis: { type: "value" },
    yAxis: { type: "value" },
    series: [
      {
        name: y,
        type: "scatter",
        data: rows.map((row) => [numericValue(row[x]), numericValue(row[y])]),
      },
    ],
  });
}

function gaugeOption(spec: ChartSpec, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const y = yList(spec)[0]!;
  return cleanOption({
    ...baseOption(spec),
    tooltip: spec.options?.showTooltip === false ? undefined : { trigger: "item" },
    series: [
      {
        name: y,
        type: "gauge",
        data: [{ name: y, value: numericValue(rows[0]?.[y]) }],
      },
    ],
  });
}

function tableFallbackOption(spec: ChartSpec, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return cleanOption({
    title: spec.title ? { text: spec.title } : undefined,
    dataset: { source: rows },
  });
}

function yList(spec: ChartSpec): string[] {
  if (Array.isArray(spec.y)) return spec.y;
  return spec.y ? [spec.y] : [];
}

function limitRows(rows: Array<Record<string, unknown>>, limit: number | undefined): Array<Record<string, unknown>> {
  return rows.slice(0, limit ?? rows.length);
}

function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function cleanOption(option: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(option).filter(([, value]) => value !== undefined));
}
