import { renderEChartsRuntimeScript, type EChartsRuntimeOptions } from "../charts/htmlRuntime";
import type { ChartSpec } from "../charts/types";
import { reportChartKind, reportChartSpec, reportDatasetColumns, reportDatasetPreviewRows, reportDatasetRows } from "./compat";
import { renderReportMarkdown } from "./renderMarkdown";
import type { ReportArtifact, ReportChart, ReportDataset } from "./types";

export interface RenderReportHtmlOptions {
  echarts?: EChartsRuntimeOptions;
}

export function renderReportHtml(report: ReportArtifact, options: RenderReportHtmlOptions = {}): string {
  const markdown = renderReportMarkdown(report);
  const chartRenderings = buildChartRenderings(report);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(report.title)}</title>`,
    "<style>",
    "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:32px;line-height:1.6;color:#172026;background:#f7f3ea}",
    "main{max-width:1040px;margin:0 auto;background:#fff;padding:32px;border-radius:18px;box-shadow:0 16px 50px rgba(31,40,51,.10)}",
    "pre{white-space:pre-wrap;background:#111827;color:#f9fafb;padding:16px;border-radius:12px;overflow:auto}",
    ".card{border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin:16px 0;background:#fffaf0}",
    ".chart{height:340px;margin-top:12px;border-radius:12px;background:#fff;border:1px solid #f0e4c8}",
    "table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;text-align:left}th{background:#fff4d6}",
    ".muted{color:#6b7280}",
    "</style>",
    renderEChartsRuntimeScript(options.echarts),
    "</head>",
    "<body><main>",
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<p class="muted">${escapeHtml(report.question)}</p>`,
    `<section><h2>结论</h2>${renderInsightList(report)}</section>`,
    `<section><h2>图表</h2>${renderChartCards(report, chartRenderings)}</section>`,
    `<section><h2>数据</h2>${renderDatasetCards(report)}</section>`,
    `<section><h2>风险提示</h2>${renderCaveats(report)}</section>`,
    "<details><summary>Markdown 原文</summary>",
    `<pre>${escapeHtml(markdown)}</pre>`,
    "</details>",
    renderChartScript(chartRenderings),
    "</main></body></html>",
  ].join("\n");
}

function renderInsightList(report: ReportArtifact): string {
  if (report.insights.length === 0) return "<p>暂无结论。</p>";
  return `<ul>${report.insights.map((insight) => {
    const record = insight as typeof insight & { content?: string };
    const text = typeof insight === "string" ? insight : (record.markdown ?? record.content ?? "");
    return `<li>${escapeHtml(text)}</li>`;
  }).join("")}</ul>`;
}

interface ChartRendering {
  sourceChartId: string;
  chartId: string;
  option: Record<string, unknown> | null;
  note?: string;
}

function renderChartCards(report: ReportArtifact, renderings: ChartRendering[]): string {
  if (report.charts.length === 0) return "<p>暂无图表。</p>";
  const byChartId = new Map(renderings.map((item) => [item.sourceChartId, item]));
  return report.charts
    .map((chart) => {
      const rendering = byChartId.get(chart.id);
      const refs = [chart.imageArtifact, chart.htmlArtifact, chart.chartArgsArtifact]
        .filter(Boolean)
        .map((ref) => `<a href="${escapeHtmlAttr(ref!.path)}">${escapeHtml(ref!.kind)}</a>`)
        .join(" · ");
      return [
        '<article class="card">',
        `<h3>${escapeHtml(chart.title)}</h3>`,
        `<p>${escapeHtml(reportChartKind(chart))}</p>`,
        rendering?.note ? `<p class="muted">${escapeHtml(rendering.note)}</p>` : "",
        `<p>${refs || "暂无图表 artifact。"}</p>`,
        rendering?.option ? `<div class="chart" id="${escapeHtmlAttr(rendering.chartId)}"></div>` : "",
        "</article>",
      ].join("");
    })
    .join("");
}

function renderDatasetCards(report: ReportArtifact): string {
  return report.datasets
    .map((dataset) => {
      const provenance = dataset.provenance;
      const preview = provenance?.preview;
      const artifacts = [
        provenance?.artifacts?.preview ?? dataset.previewArtifact,
        provenance?.artifacts?.result ?? dataset.resultArtifact,
      ]
        .filter(Boolean)
        .map(renderArtifactLink)
        .join(" · ");
      return [
        '<article class="card">',
        `<h3>${escapeHtml(dataset.name)}</h3>`,
        `<p>queryId=${escapeHtml(provenance?.queryId ?? dataset.queryId ?? "unknown")}</p>`,
        `<p>previewRows=${preview?.rows ?? reportDatasetPreviewRows(dataset)}, rowCount=${escapeHtml(String(preview?.rowCount ?? dataset.rowCount ?? "unknown"))}, truncated=${escapeHtml(String(preview?.truncated ?? "unknown"))}</p>`,
        `<p>model=${escapeHtml(provenance?.generatedBy?.provider ?? report.provenance.provider ?? "unknown")} / ${escapeHtml(provenance?.generatedBy?.model ?? report.provenance.model ?? "unknown")}</p>`,
        `<p>artifacts=${artifacts || "none"}</p>`,
        renderRowsPreview(dataset),
        dataset.sql ? `<pre>${escapeHtml(provenance?.sql ?? dataset.sql)}</pre>` : "",
        "</article>",
      ].join("");
    })
    .join("");
}

function renderCaveats(report: ReportArtifact): string {
  if (report.caveats.length === 0) return "<p>暂无风险提示。</p>";
  return `<ul>${report.caveats.map((caveat) => {
    if (typeof caveat === "string") return `<li>${escapeHtml(caveat)}</li>`;
    return `<li>${escapeHtml(caveat.code ?? "")}: ${escapeHtml(caveat.message ?? "")}</li>`;
  }).join("")}</ul>`;
}

function buildChartRenderings(report: ReportArtifact): ChartRendering[] {
  return report.charts.map((chart, index) => {
    const dataset = report.datasets.find((item) => item.id === chart.datasetId) ?? report.datasets[0];
    const rows = dataset ? reportDatasetRows(dataset) : [];
    if (!dataset || rows.length === 0) {
      return { sourceChartId: chart.id, chartId: `report-chart-${index}`, option: null, note: "无可渲染预览数据" };
    }
    const spec = reportChartSpec(chart, dataset);
    const option = chartOption(spec, rows);
    return {
      sourceChartId: chart.id,
      chartId: `report-chart-${index}`,
      option,
      note: option ? undefined : "字段不足，无法渲染图表",
    };
  });
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

function renderRowsPreview(dataset: ReportDataset): string {
  const rows = reportDatasetRows(dataset).slice(0, 8);
  if (rows.length === 0) return "";
  const columns = reportDatasetColumns(dataset).map((column) => column.name).slice(0, 8);
  if (columns.length === 0) return "";
  return [
    "<details><summary>预览数据</summary>",
    "<table>",
    `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(String(row[column] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>",
    "</details>",
  ].join("");
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

function renderArtifactLink(ref: unknown): string {
  const record = ref && typeof ref === "object" && !Array.isArray(ref) ? (ref as { path?: unknown; kind?: unknown }) : {};
  const artifactPath = typeof ref === "string" ? ref : typeof record.path === "string" ? record.path : "";
  if (!artifactPath) return "";
  const kind = typeof record.kind === "string" ? record.kind : artifactKindFromPath(artifactPath);
  return `<a href="${escapeHtmlAttr(artifactPath)}">${escapeHtml(kind)}</a>`;
}

function artifactKindFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".pptx")) return "pptx";
  return "artifact";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
