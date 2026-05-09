import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultArtifactsRoot } from "../agent/tools/artifact";
import type {
  ArtifactRef,
  ReportArtifact,
  ReportAuditEvent,
  ReportListQuery,
  ReportListResult,
  ReportStore,
} from "./types";

export interface FileReportStoreOptions {
  artifactsRoot?: string;
}

export class FileReportStore implements ReportStore {
  private readonly root: string;

  constructor(options: FileReportStoreOptions = {}) {
    this.root = path.resolve(options.artifactsRoot ?? defaultArtifactsRoot(), "reports");
  }

  async create(report: ReportArtifact): Promise<ReportArtifact> {
    this.assertSafeId(report.id);
    this.assertArtifactRefs(report);
    const dir = this.reportDir(report.id);
    await mkdir(dir, { recursive: true });
    await this.writeJsonAtomic(this.reportFile(report.id), report);
    return report;
  }

  async update(report: ReportArtifact): Promise<ReportArtifact> {
    this.assertSafeId(report.id);
    this.assertArtifactRefs(report);
    await mkdir(this.reportDir(report.id), { recursive: true });
    await this.writeJsonAtomic(this.reportFile(report.id), report);
    return report;
  }

  async read(id: string): Promise<ReportArtifact> {
    this.assertSafeId(id);
    const raw = await readFile(this.reportFile(id), "utf8");
    return JSON.parse(raw) as ReportArtifact;
  }

  async list(query: ReportListQuery = {}): Promise<ReportListResult> {
    const dirs = await this.safeReadDir(this.root);
    const reports: ReportArtifact[] = [];
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      try {
        const report = await this.read(dirent.name);
        if (query.ownerId && report.owner.id !== query.ownerId) continue;
        if (query.workspaceId && report.workspaceId !== query.workspaceId) continue;
        if (query.status && report.status !== query.status) continue;
        reports.push(report);
      } catch {
        // Ignore incomplete artifact directories.
      }
    }
    reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { reports: query.limit ? reports.slice(0, Math.max(0, query.limit)) : reports };
  }

  async writeExport(id: string, exportRef: ArtifactRef): Promise<void> {
    this.assertSafeId(id);
    this.assertArtifactRefs(exportRef);
    const report = await this.read(id);
    const next: ReportArtifact = {
      ...report,
      updatedAt: new Date().toISOString(),
      exports: [
        ...report.exports.filter((item) => item.id !== exportRef.path),
        { id: exportRef.path, format: reportExportFormat(exportRef), artifact: exportRef },
      ],
    };
    await this.update(next);
  }

  async appendAudit(id: string, event: ReportAuditEvent): Promise<void> {
    this.assertSafeId(id);
    const dir = this.reportDir(id);
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "audit.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  private reportDir(id: string): string {
    return this.resolveInsideRoot(id);
  }

  private reportFile(id: string): string {
    return path.join(this.reportDir(id), "report.json");
  }

  private resolveInsideRoot(...parts: string[]): string {
    const target = path.resolve(this.root, ...parts);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error(`refuse to access outside reports artifact root: ${target}`);
    }
    return target;
  }

  private assertSafeId(id: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
      throw new Error(`invalid report id: ${id}`);
    }
  }

  private assertArtifactRefs(value: unknown): void {
    assertArtifactRefsWithinRoot(value, path.dirname(this.root));
  }

  private async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  }

  private async safeReadDir(dir: string): Promise<import("node:fs").Dirent[]> {
    try {
      await stat(dir);
      return await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }
}

function reportExportFormat(ref: ArtifactRef): "markdown" | "html" | "pdf" | "pptx" | "json" {
  if (ref.kind === "markdown" || ref.kind === "html" || ref.kind === "pdf" || ref.kind === "pptx" || ref.kind === "json") {
    return ref.kind;
  }
  throw new Error(`unsupported report export artifact kind: ${ref.kind}`);
}

export function assertArtifactRefsWithinRoot(value: unknown, artifactsRoot: string): void {
  const root = path.resolve(artifactsRoot);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.path === "string" && typeof record.kind === "string") {
      const target = path.resolve(record.path);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error(`artifact path is outside artifact root: ${target}`);
      }
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(value);
}
