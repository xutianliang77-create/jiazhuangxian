import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalizeWorkspace } from "../../../src/lib/workspace";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("canonicalizeWorkspace", () => {
  it("returns the filesystem realpath when possible", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codeclaw-workspace-"));
    tempDirs.push(root);
    const link = `${root}-link`;
    tempDirs.push(link);
    symlinkSync(root, link, "dir");

    expect(canonicalizeWorkspace(link)).toBe(realpathSync.native(root));
  });

  it("falls back to a resolved absolute path for missing workspaces", () => {
    const missing = path.join(os.tmpdir(), "codeclaw-missing-workspace", "..", "missing");

    expect(canonicalizeWorkspace(missing)).toBe(path.resolve(missing));
  });
});
