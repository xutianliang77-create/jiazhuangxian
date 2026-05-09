import { describe, expect, it } from "vitest";

import { validateReportArtifact } from "../../../src/reports/validate";
import type { ReportArtifact } from "../../../src/reports/types";

describe("validateReportArtifact", () => {
  it("accepts a minimal valid report", () => {
    const result = validateReportArtifact(sampleReport());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing datasets and invalid chart references", () => {
    const report = sampleReport({
      datasets: [],
      charts: [
        {
          id: "chart-1",
          title: "Bad chart",
          datasetId: "missing",
          chart: { kind: "bar", x: "item_name", y: "quantity" },
        },
      ],
    });
    const result = validateReportArtifact(report);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("report requires at least one dataset");
    expect(result.errors).toContain("chart chart-1 references missing dataset: missing");
  });

  it("warns when SQL lacks rule-check provenance", () => {
    const result = validateReportArtifact(
      sampleReport({
        datasets: [
          {
            id: "dataset-1",
            name: "sales",
            sql: "select * from sales",
            previewRows: 5,
            columns: [{ name: "item_name" }],
          },
        ],
      })
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("dataset dataset-1 has SQL without rule-check provenance");
    expect(result.warnings).toContain("dataset dataset-1 has SQL without query id provenance");
    expect(result.warnings).toContain("dataset dataset-1 has SQL without model provenance");
    expect(result.warnings).toContain("dataset dataset-1 has SQL without preview provenance");
    expect(result.warnings).toContain("dataset dataset-1 has SQL without persisted result artifact provenance");
  });

  it("warns when truncated SQL preview lacks caveat and artifact provenance", () => {
    const result = validateReportArtifact(
      sampleReport({
        datasets: [
          {
            id: "dataset-1",
            name: "sales",
            sql: "select * from sales",
            queryId: "q-1",
            previewRows: 5,
            rowCount: 10,
            columns: [{ name: "item_name" }],
            provenance: {
              sql: "select * from sales",
              queryId: "q-1",
              generatedBy: { provider: "lmstudio", model: "qwen3.6" },
              ruleCheck: { passed: true, errors: [], warnings: [] },
              preview: { rows: 5, rowCount: 10, truncated: true },
            },
          },
        ],
      })
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("dataset dataset-1 preview is truncated without preview_truncated caveat");
    expect(result.warnings).toContain("dataset dataset-1 has SQL without persisted result artifact provenance");
  });
});

function sampleReport(overrides: Partial<ReportArtifact> = {}): ReportArtifact {
  const now = "2026-05-03T00:00:00.000Z";
  return {
    version: 1,
    id: "report-1",
    title: "Sales report",
    question: "Analyze sales",
    owner: { type: "user", id: "user-1" },
    workspaceId: "ws-1",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    datasets: [
      {
        id: "dataset-1",
        name: "sales",
        previewRows: 5,
        columns: [{ name: "item_name", type: "VARCHAR" }],
      },
    ],
    charts: [],
    sections: [],
    insights: [],
    caveats: [],
    exports: [],
    provenance: { source: "manual", question: "Analyze sales" },
    ...overrides,
  };
}
