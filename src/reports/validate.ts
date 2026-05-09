import { assertArtifactRefsWithinRoot } from "./store";
import { isPreviewTruncated } from "./provenance";
import type { ReportArtifact } from "./types";

export interface ReportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ReportValidationOptions {
  artifactsRoot?: string;
  strictSql?: boolean;
}

export function validateReportArtifact(
  report: ReportArtifact,
  options: ReportValidationOptions = {}
): ReportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (report.version !== 1) errors.push("report version must be 1");
  if (!report.id) errors.push("report id is required");
  if (!report.title) errors.push("report title is required");
  if (!report.question) errors.push("report question is required");
  if (!report.owner?.id) errors.push("report owner is required");
  if (!report.workspaceId) errors.push("report workspaceId is required");
  if (report.datasets.length === 0) errors.push("report requires at least one dataset");

  const datasetIds = new Set<string>();
  for (const dataset of report.datasets) {
    if (datasetIds.has(dataset.id)) errors.push(`duplicate dataset id: ${dataset.id}`);
    datasetIds.add(dataset.id);
    const sql = dataset.sql ?? dataset.provenance?.sql;
    const queryId = dataset.provenance?.queryId ?? dataset.queryId;
    if (queryId && !sql) {
      strictOrWarn(
        options,
        errors,
        warnings,
        `dataset ${dataset.id} has query id provenance without SQL text`
      );
    }
    if (sql && !dataset.provenance?.ruleCheck) {
      strictOrWarn(options, errors, warnings, `dataset ${dataset.id} has SQL without rule-check provenance`);
    }
    if (sql && dataset.provenance?.ruleCheck && !dataset.provenance.ruleCheck.passed) {
      strictOrWarn(options, errors, warnings, `dataset ${dataset.id} has SQL rule-check failures`);
    }
    if (sql) {
      const hasModel =
        Boolean(dataset.provenance?.generatedBy?.provider || dataset.provenance?.generatedBy?.model) ||
        Boolean(report.provenance.provider || report.provenance.model);
      const hasArtifact =
        Boolean(dataset.provenance?.artifacts?.result) ||
        Boolean(dataset.resultArtifact);
      const hasPreviewArtifact =
        Boolean(dataset.provenance?.artifacts?.preview || dataset.previewArtifact);
      const truncated = dataset.provenance?.preview?.truncated ?? isPreviewTruncated(dataset, report.caveats);

      if (!queryId) strictOrWarn(options, errors, warnings, `dataset ${dataset.id} has SQL without query id provenance`);
      if (!hasModel) warnings.push(`dataset ${dataset.id} has SQL without model provenance`);
      if (!dataset.provenance?.preview) warnings.push(`dataset ${dataset.id} has SQL without preview provenance`);
      if (!hasArtifact) {
        strictOrWarn(
          options,
          errors,
          warnings,
          `dataset ${dataset.id} has SQL without persisted result artifact provenance`
        );
      }
      if (!hasPreviewArtifact) {
        warnings.push(`dataset ${dataset.id} has SQL without persisted preview artifact provenance`);
      }
      if (truncated && !report.caveats.some((caveat) => caveat.code === "preview_truncated")) {
        warnings.push(`dataset ${dataset.id} preview is truncated without preview_truncated caveat`);
      }
    }
  }

  const chartIds = new Set<string>();
  for (const chart of report.charts) {
    if (chartIds.has(chart.id)) errors.push(`duplicate chart id: ${chart.id}`);
    chartIds.add(chart.id);
    if (!datasetIds.has(chart.datasetId)) {
      errors.push(`chart ${chart.id} references missing dataset: ${chart.datasetId}`);
    }
  }

  for (const section of report.sections) {
    for (const datasetId of section.datasetIds ?? []) {
      if (!datasetIds.has(datasetId)) errors.push(`section ${section.id} references missing dataset: ${datasetId}`);
    }
    for (const chartId of section.chartIds ?? []) {
      if (!chartIds.has(chartId)) errors.push(`section ${section.id} references missing chart: ${chartId}`);
    }
  }

  if (options.artifactsRoot) {
    try {
      assertArtifactRefsWithinRoot(report, options.artifactsRoot);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function strictOrWarn(
  options: ReportValidationOptions,
  errors: string[],
  warnings: string[],
  message: string
): void {
  if (options.strictSql) {
    errors.push(message);
    return;
  }
  warnings.push(message);
}
