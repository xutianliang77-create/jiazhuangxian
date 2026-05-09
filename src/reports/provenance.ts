import type { DataCaveat, ReportDataset, ReportProvenance } from "./types";

export function enrichReportDatasetsProvenance(
  datasets: ReportDataset[],
  reportProvenance: ReportProvenance,
  caveats: DataCaveat[] = []
): ReportDataset[] {
  return datasets.map((dataset) => {
    const sql = dataset.provenance?.sql ?? dataset.sql;
    if (!sql) return dataset;

    const queryId = dataset.provenance?.queryId ?? dataset.queryId;
    const generatedBy = dataset.provenance?.generatedBy ?? modelSource(reportProvenance);
    const preview = {
      rows: dataset.previewRows,
      ...(dataset.rowCount === undefined ? {} : { rowCount: dataset.rowCount }),
      truncated: isPreviewTruncated(dataset, caveats),
    };
    const artifacts =
      dataset.previewArtifact || dataset.resultArtifact
        ? {
            ...(dataset.previewArtifact ? { preview: dataset.previewArtifact } : {}),
            ...(dataset.resultArtifact ? { result: dataset.resultArtifact } : {}),
          }
        : undefined;

    return {
      ...dataset,
      sql,
      ...(queryId ? { queryId } : {}),
      provenance: {
        ...dataset.provenance,
        sql,
        ...(queryId ? { queryId } : {}),
        ...(generatedBy ? { generatedBy } : {}),
        preview,
        ...(artifacts ? { artifacts } : {}),
      },
    };
  });
}

export function isPreviewTruncated(dataset: ReportDataset, caveats: DataCaveat[] = []): boolean {
  if (dataset.rowCount !== undefined) return dataset.rowCount > dataset.previewRows;
  return caveats.some((caveat) => caveat.code === "preview_truncated");
}

function modelSource(provenance: ReportProvenance): { provider?: string; model?: string } | undefined {
  if (!provenance.provider && !provenance.model) return undefined;
  return {
    ...(provenance.provider ? { provider: provenance.provider } : {}),
    ...(provenance.model ? { model: provenance.model } : {}),
  };
}
