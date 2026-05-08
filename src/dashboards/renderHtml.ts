import { renderEChartsRuntimeScript, type EChartsRuntimeOptions } from "../charts/htmlRuntime";
import type { ChartSpec } from "../charts/types";
import type { DashboardDataset } from "./types";
import type { DashboardSpec, DashboardWidget } from "./types";

export interface RenderDashboardHtmlOptions {
  echarts?: EChartsRuntimeOptions;
}

export function renderDashboardHtml(dashboard: DashboardSpec, options: RenderDashboardHtmlOptions = {}): string {
  const chartRenderings = buildChartRenderings(dashboard);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(dashboard.title)}</title>`,
    "<style>",
    "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#eef4f1;color:#172026}",
    "header{padding:28px 36px;background:#14342b;color:#fff}",
    ".page{padding:28px 36px}",
    ".grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}",
    ".widget{background:#fff;border:1px solid #d8e2dc;border-radius:16px;padding:16px;min-height:120px;box-shadow:0 10px 30px rgba(20,52,43,.08)}",
    ".chart{height:320px;margin-top:12px;border-radius:12px;border:1px solid #e5e7eb;background:#fff}",
    ".muted{color:#64748b}",
    "pre{white-space:pre-wrap;background:#111827;color:#f9fafb;padding:12px;border-radius:10px;overflow:auto}",
    "</style>",
    renderEChartsRuntimeScript(options.echarts),
    "</head>",
    "<body>",
    `<header><h1>${escapeHtml(dashboard.title)}</h1><p>${escapeHtml(dashboard.description ?? "")}</p></header>`,
    renderProvenance(dashboard),
    renderDatasets(dashboard),
    dashboard.pages.map((page) => `<section class="page"><h2>${escapeHtml(page.title)}</h2><div class="grid">${page.widgets.map((widget) => renderWidget(widget, chartRenderings)).join("")}</div></section>`).join("\n"),
    renderChartScript(chartRenderings),
    "</body></html>",
  ].join("\n");
}

function renderProvenance(dashboard: DashboardSpec): string {
  return [
    '<section class="page">',
    "<h2>Provenance</h2>",
    `<p class="muted">source=${escapeHtml(dashboard.provenance.source)} · provider=${escapeHtml(dashboard.provenance.provider ?? "unknown")} · model=${escapeHtml(dashboard.provenance.model ?? "unknown")}</p>`,
    dashboard.provenance.sourceReportId
      ? `<p class="muted">sourceReportId=${escapeHtml(dashboard.provenance.sourceReportId)}</p>`
      : "",
    "</section>",
  ].join("");
}

function renderDatasets(dashboard: DashboardSpec): string {
  return [
    '<section class="page">',
    "<h2>Datasets</h2>",
    dashboard.datasets
      .map((dataset) => {
        const preview = dataset.provenance?.preview;
        const artifacts = [
          dataset.provenance?.artifacts?.preview ?? dataset.sourceArtifact,
          dataset.provenance?.artifacts?.result ?? dataset.resultArtifact,
        ]
          .filter(Boolean)
          .map((ref) => `<a href="${escapeHtmlAttr(ref!.path)}">${escapeHtml(ref!.kind)}</a>`)
          .join(" · ");
        return [
          '<article class="widget">',
          `<h3>${escapeHtml(dataset.name)}</h3>`,
          `<p class="muted">kind=${escapeHtml(dataset.kind)} · queryId=${escapeHtml(dataset.provenance?.queryId ?? dataset.refresh.queryId ?? "unknown")}</p>`,
          `<p class="muted">previewRows=${preview?.rows ?? dataset.previewRows}, rowCount=${escapeHtml(String(preview?.rowCount ?? dataset.rowCount ?? "unknown"))}, truncated=${escapeHtml(String(preview?.truncated ?? "unknown"))}</p>`,
          `<p class="muted">model=${escapeHtml(dataset.provenance?.generatedBy?.provider ?? dashboard.provenance.provider ?? "unknown")} / ${escapeHtml(dataset.provenance?.generatedBy?.model ?? dashboard.provenance.model ?? "unknown")}</p>`,
          `<p class="muted">artifacts=${artifacts || "none"}</p>`,
          dataset.sql ? `<pre>${escapeHtml(dataset.provenance?.sql ?? dataset.sql)}</pre>` : "",
          "</article>",
        ].join("");
      })
      .join(""),
    "</section>",
  ].join("");
}

interface ChartRendering {
  widgetId: string;
  chartId: string;
  option: Record<string, unknown> | null;
  note?: string;
}

function renderWidget(widget: DashboardWidget, renderings: ChartRendering[]): string {
  const style = `grid-column:span ${Math.max(1, Math.min(12, widget.layout.w))}`;
  const rendering = renderings.find((item) => item.widgetId === widget.id);
  return `<article class="widget" style="${style}"><h3>${escapeHtml(widget.title)}</h3>${renderWidgetBody(widget, rendering)}</article>`;
}

function renderWidgetBody(widget: DashboardWidget, rendering?: ChartRendering): string {
  if (widget.type === "text" || widget.type === "insight") {
    return `<p>${escapeHtml(widget.text ?? "")}</p>`;
  }
  if (widget.type === "metric") {
    return `<p class="muted">Metric widget · dataset=${escapeHtml(widget.datasetId ?? "none")}</p>`;
  }
  if (widget.type === "chart") {
    return [
      `<p class="muted">Chart · ${escapeHtml(widget.chart?.kind ?? "unknown")} · dataset=${escapeHtml(widget.datasetId ?? "none")}</p>`,
      rendering?.note ? `<p class="muted">${escapeHtml(rendering.note)}</p>` : "",
      rendering?.option ? `<div class="chart" id="${escapeHtmlAttr(rendering.chartId)}"></div>` : "",
      `<pre>${escapeHtml(JSON.stringify(widget.chart ?? {}, null, 2))}</pre>`,
    ].join("");
  }
  if (widget.type === "table") {
    return `<p class="muted">Table widget · dataset=${escapeHtml(widget.datasetId ?? "none")}</p>`;
  }
  return `<p class="muted">${escapeHtml(widget.type)} widget placeholder</p>`;
}

function buildChartRenderings(dashboard: DashboardSpec): ChartRendering[] {
  return dashboard.pages.flatMap((page) =>
    page.widgets
      .filter((widget) => widget.type === "chart")
      .map((widget) => {
        const dataset = dashboard.datasets.find((item) => item.id === widget.datasetId);
        const rows = dataset ? dashboardDatasetRows(dataset) : [];
        const chartId = `dashboard-chart-${safeDomId(widget.id)}`;
        if (!dataset || rows.length === 0) {
          return { widgetId: widget.id, chartId, option: null, note: "无可渲染预览数据" };
        }
        const option = widget.chart ? chartOption(widget.chart, rows) : null;
        return {
          widgetId: widget.id,
          chartId,
          option,
          note: option ? undefined : "字段不足，无法渲染图表",
        };
      })
  );
}

function dashboardDatasetRows(dataset: DashboardDataset): Array<Record<string, unknown>> {
  for (const value of [dataset.rows, dataset.data, dataset.preview]) {
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function chartOption(spec: ChartSpec, rows: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const x = spec.x;
  const yFields = yList(spec);
  if (!x || yFields.length === 0) return null;
  const title = spec.title ? { text: spec.title } : undefined;
  if (spec.kind === "pie" || spec.kind === "funnel") {
    const y = yFields[0]!;
    return cleanOption({
      title,
      tooltip: { trigger: "item" },
      series: [
        {
          type: spec.kind === "funnel" ? "funnel" : "pie",
          data: rows.map((row) => ({ name: String(row[x] ?? ""), value: numericValue(row[y]) })),
        },
      ],
    });
  }
  const chartType = spec.kind === "line" || spec.kind === "area" ? "line" : "bar";
  return cleanOption({
    title,
    tooltip: { trigger: "axis" },
    legend: yFields.length > 1 ? {} : undefined,
    xAxis: { type: "category", data: rows.map((row) => row[x]) },
    yAxis: { type: "value" },
    series: yFields.map((field) => ({
      name: field,
      type: chartType,
      data: rows.map((row) => numericValue(row[field])),
      ...(spec.kind === "area" ? { areaStyle: {} } : {}),
    })),
  });
}

function renderChartScript(renderings: ChartRendering[]): string {
  const items = renderings.filter((item): item is ChartRendering & { option: Record<string, unknown> } =>
    Boolean(item.option)
  );
  if (items.length === 0) return "";
  const json = JSON.stringify(items.map((item) => ({ id: item.chartId, option: item.option }))).replaceAll(
    "<",
    "\\u003c"
  );
  return [
    "<script>",
    `(function(){var charts=${json};if(!window.echarts){return;}charts.forEach(function(item){var el=document.getElementById(item.id);if(!el)return;window.echarts.init(el).setOption(item.option);});})();`,
    "</script>",
  ].join("\n");
}

function yList(spec: ChartSpec): string[] {
  if (Array.isArray(spec.y)) return spec.y;
  return spec.y ? [spec.y] : [];
}

function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function cleanOption(option: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(option).filter(([, value]) => value !== undefined));
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "chart";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
