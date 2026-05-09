import { reportChartKind, reportDatasetPreviewRows } from "./compat";
import type { ReportArtifact } from "./types";

export function renderReportMarkdown(report: ReportArtifact): string {
  const lines: string[] = [
    `# ${report.title}`,
    "",
    "## 问题",
    report.question,
    "",
    "## 结论",
    ...markdownList(report.insights.map((insight) => {
      const record = insight as typeof insight & { content?: string };
      return typeof insight === "string" ? insight : (record.markdown ?? record.content ?? "");
    }), "暂无结论。"),
    "",
    "## 图表",
    ...markdownList(report.charts.map((chart) => `${chart.title} (${chartKind(chart)})`), "暂无图表。"),
    "",
    "## 数据",
    ...report.datasets.map((dataset) => `- ${dataset.name}: previewRows=${reportDatasetPreviewRows(dataset)}, rowCount=${dataset.rowCount ?? "unknown"}`),
    "",
    "## SQL 和来源",
    ...markdownList(
      report.datasets
        .filter((dataset) => dataset.sql)
        .map((dataset) => [
          `\`${dataset.name}\`:`,
          `  - queryId: ${dataset.provenance?.queryId ?? dataset.queryId ?? "unknown"}`,
          `  - model: ${dataset.provenance?.generatedBy?.provider ?? report.provenance.provider ?? "unknown"} / ${dataset.provenance?.generatedBy?.model ?? report.provenance.model ?? "unknown"}`,
          `  - preview: rows=${dataset.provenance?.preview?.rows ?? reportDatasetPreviewRows(dataset)}, rowCount=${dataset.provenance?.preview?.rowCount ?? dataset.rowCount ?? "unknown"}, truncated=${dataset.provenance?.preview?.truncated ?? "unknown"}`,
          `  - artifacts: preview=${dataset.provenance?.artifacts?.preview?.path ?? dataset.previewArtifact?.path ?? "none"}, result=${dataset.provenance?.artifacts?.result?.path ?? dataset.resultArtifact?.path ?? "none"}`,
          "",
          "```sql",
          dataset.provenance?.sql ?? dataset.sql ?? "",
          "```",
        ].join("\n")),
      "暂无 SQL。"
    ),
    "",
    "## 风险提示",
    ...markdownList(report.caveats.map((caveat) => (typeof caveat === "string" ? caveat : `${caveat.code}: ${caveat.message}`)), "暂无风险提示。"),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function markdownList(items: string[], empty: string): string[] {
  if (items.length === 0) return [empty];
  return items.map((item) => `- ${item}`);
}

function chartKind(chart: ReportArtifact["charts"][number]): string {
  return reportChartKind(chart);
}
