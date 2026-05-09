import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileReportStore } from "../../../src/reports/store";
import type { ArtifactRef, ReportArtifact } from "../../../src/reports/types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-report-store-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("FileReportStore", () => {
  it("creates, reads, and lists reports", async () => {
    const store = new FileReportStore({ artifactsRoot: tmpRoot });
    const report = sampleReport("report-a", { ownerId: "user-1", workspaceId: "ws-1" });

    await store.create(report);

    expect(await store.read("report-a")).toMatchObject({ id: "report-a", title: "Sales report" });
    expect(existsSync(path.join(tmpRoot, "reports", "report-a", "report.json"))).toBe(true);
    expect((await store.list({ ownerId: "user-1" })).reports.map((item) => item.id)).toEqual(["report-a"]);
    expect((await store.list({ ownerId: "other" })).reports).toEqual([]);
  });

  it("updates reports and sorts list by updatedAt desc", async () => {
    const store = new FileReportStore({ artifactsRoot: tmpRoot });
    await store.create(sampleReport("report-a", { updatedAt: "2026-05-01T00:00:00.000Z" }));
    await store.create(sampleReport("report-b", { updatedAt: "2026-05-02T00:00:00.000Z" }));

    const updated = sampleReport("report-a", { title: "Updated", updatedAt: "2026-05-03T00:00:00.000Z" });
    await store.update(updated);

    expect((await store.read("report-a")).title).toBe("Updated");
    expect((await store.list()).reports.map((item) => item.id)).toEqual(["report-a", "report-b"]);
  });

  it("appends audit events and writes exports", async () => {
    const store = new FileReportStore({ artifactsRoot: tmpRoot });
    await store.create(sampleReport("report-a"));
    const exportPath = path.join(tmpRoot, "reports", "report-a", "report.html");
    writeFileSync(exportPath, "<html></html>");

    await store.writeExport("report-a", artifact(exportPath, "html"));
    await store.appendAudit("report-a", {
      id: "evt-1",
      reportId: "report-a",
      actor: { type: "user", id: "user-1" },
      action: "render",
      at: "2026-05-03T00:00:00.000Z",
    });

    expect((await store.read("report-a")).exports).toHaveLength(1);
    expect(readFileSync(path.join(tmpRoot, "reports", "report-a", "audit.jsonl"), "utf8")).toContain("evt-1");
  });

  it("rejects unsafe ids and artifact refs outside artifact root", async () => {
    const store = new FileReportStore({ artifactsRoot: tmpRoot });

    await expect(store.create(sampleReport("../bad"))).rejects.toThrow(/invalid report id/);
    await expect(
      store.create(
        sampleReport("report-a", {
          datasets: [
            {
              ...sampleReport("x").datasets[0],
              previewArtifact: artifact(path.join(tmpRoot, "..", "outside.json"), "json"),
            },
          ],
        })
      )
    ).rejects.toThrow(/outside artifact root/);
  });
});

function sampleReport(
  id: string,
  overrides: Partial<ReportArtifact> & { ownerId?: string; workspaceId?: string } = {}
): ReportArtifact {
  const now = "2026-05-03T00:00:00.000Z";
  const ownerId = overrides.ownerId ?? "user-1";
  const workspaceId = overrides.workspaceId ?? "ws-1";
  return {
    version: 1,
    id,
    title: overrides.title ?? "Sales report",
    question: "Analyze sales",
    owner: { type: "user", id: ownerId },
    workspaceId,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    status: overrides.status ?? "draft",
    datasets: overrides.datasets ?? [
      {
        id: "dataset-1",
        name: "sales",
        previewRows: 5,
        columns: [{ name: "item_name", type: "VARCHAR" }],
      },
    ],
    charts: overrides.charts ?? [],
    sections: overrides.sections ?? [],
    insights: overrides.insights ?? [],
    caveats: overrides.caveats ?? [],
    exports: overrides.exports ?? [],
    provenance: overrides.provenance ?? {
      source: "manual",
      question: "Analyze sales",
    },
  };
}

function artifact(p: string, kind: ArtifactRef["kind"]): ArtifactRef {
  return {
    path: p,
    kind,
    createdAt: "2026-05-03T00:00:00.000Z",
  };
}
