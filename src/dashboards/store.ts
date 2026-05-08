import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultArtifactsRoot } from "../agent/tools/artifact";
import { assertArtifactRefsWithinRoot } from "../reports/store";
import type {
  DashboardAuditEvent,
  DashboardListQuery,
  DashboardListResult,
  DashboardSpec,
  DashboardStore,
  DashboardVersion,
} from "./types";

export interface FileDashboardStoreOptions {
  artifactsRoot?: string;
}

export class FileDashboardStore implements DashboardStore {
  private readonly root: string;

  constructor(options: FileDashboardStoreOptions = {}) {
    this.root = path.resolve(options.artifactsRoot ?? defaultArtifactsRoot(), "dashboards");
  }

  async create(spec: DashboardSpec): Promise<DashboardSpec> {
    this.assertSafeId(spec.id);
    this.assertArtifactRefs(spec);
    await mkdir(this.dashboardDir(spec.id), { recursive: true });
    await this.writeJsonAtomic(this.dashboardFile(spec.id), spec);
    return spec;
  }

  async update(spec: DashboardSpec): Promise<DashboardSpec> {
    this.assertSafeId(spec.id);
    this.assertArtifactRefs(spec);
    await mkdir(this.dashboardDir(spec.id), { recursive: true });
    await this.writeJsonAtomic(this.dashboardFile(spec.id), spec);
    return spec;
  }

  async read(id: string): Promise<DashboardSpec> {
    this.assertSafeId(id);
    const raw = await readFile(this.dashboardFile(id), "utf8");
    return JSON.parse(raw) as DashboardSpec;
  }

  async list(query: DashboardListQuery = {}): Promise<DashboardListResult> {
    const dirs = await this.safeReadDir(this.root);
    const dashboards: DashboardSpec[] = [];
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      try {
        const dashboard = await this.read(dirent.name);
        if (query.ownerId && dashboard.owner.id !== query.ownerId) continue;
        if (query.workspaceId && dashboard.workspaceId !== query.workspaceId) continue;
        if (query.status && dashboard.status !== query.status) continue;
        dashboards.push(dashboard);
      } catch {
        // Ignore incomplete artifact directories.
      }
    }
    dashboards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { dashboards: query.limit ? dashboards.slice(0, Math.max(0, query.limit)) : dashboards };
  }

  async writeVersion(spec: DashboardSpec): Promise<DashboardVersion> {
    this.assertSafeId(spec.id);
    this.assertArtifactRefs(spec);
    const version = spec.lifecycle.version;
    const createdAt = new Date().toISOString();
    const file = path.join(this.dashboardDir(spec.id), "versions", `v${version}.json`);
    await this.writeJsonAtomic(file, spec);
    return {
      version,
      createdAt,
      artifact: {
        path: file,
        kind: "json",
        createdAt,
      },
    };
  }

  async appendAudit(id: string, event: DashboardAuditEvent): Promise<void> {
    this.assertSafeId(id);
    const dir = this.dashboardDir(id);
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "audit.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  private dashboardDir(id: string): string {
    return this.resolveInsideRoot(id);
  }

  private dashboardFile(id: string): string {
    return path.join(this.dashboardDir(id), "dashboard.json");
  }

  private resolveInsideRoot(...parts: string[]): string {
    const target = path.resolve(this.root, ...parts);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error(`refuse to access outside dashboards artifact root: ${target}`);
    }
    return target;
  }

  private assertSafeId(id: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
      throw new Error(`invalid dashboard id: ${id}`);
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
