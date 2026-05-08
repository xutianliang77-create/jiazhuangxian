import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { BeelinkConfig } from "./types";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BeelinkConfig {
  const baseUrl = readRequired(env, "BEELINK_BASE_URL").replace(/\/+$/, "");
  const username = readRequired(env, "BEELINK_USERNAME");
  const password = readRequired(env, "BEELINK_PASSWORD");
  return {
    baseUrl,
    username,
    password,
    timeoutMs: readPositiveInt(env.BEELINK_TIMEOUT_MS, 30_000),
    previewRows: readPositiveInt(env.BEELINK_PREVIEW_ROWS, 5),
    maxPreviewRows: readPositiveInt(env.BEELINK_MAX_PREVIEW_ROWS, 50),
    artifactsRoot: env.BEELINK_ARTIFACTS_ROOT?.trim() || path.join(os.homedir(), ".codeclaw", "artifacts"),
    exportMaxRows: readPositiveInt(env.BEELINK_EXPORT_MAX_ROWS, 5_000),
    exportPageRows: readPositiveInt(env.BEELINK_EXPORT_PAGE_ROWS, 500),
    metadataDbPath: env.BEELINK_METADATA_DB?.trim() || defaultMetadataDbPath(process.cwd()),
    semanticLayerPath:
      env.BEELINK_SEMANTIC_LAYER?.trim() ||
      path.join(defaultBeelinkProjectDir(process.cwd()), "semantic-layer.json"),
    glossaryPath:
      env.BEELINK_GLOSSARY?.trim() || path.join(defaultBeelinkProjectDir(process.cwd()), "glossary.md"),
  };
}

function defaultMetadataDbPath(workspace: string): string {
  return path.join(defaultBeelinkProjectDir(workspace), "metadata.db");
}

function defaultBeelinkProjectDir(workspace: string): string {
  const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 16);
  return path.join(os.homedir(), ".codeclaw", "projects", hash, "beelink");
}

function readRequired(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
