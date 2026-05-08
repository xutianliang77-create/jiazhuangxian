import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerKnowledgeSearchTool } from "../../../../src/agent/tools/knowledgeTool";
import { createToolRegistry } from "../../../../src/agent/tools/registry";
import { PermissionManager } from "../../../../src/permissions/manager";
import { indexWorkspace } from "../../../../src/rag/indexer";
import { openRagDb } from "../../../../src/rag/store";

let root: string;
let workspace: string;

beforeEach(() => {
  root = path.join(os.tmpdir(), `knowledge-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = path.join(root, "ws");
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("knowledge_search tool", () => {
  it("注册为只读 L3 统一入口，plan mode 可见", () => {
    const reg = createToolRegistry();
    registerKnowledgeSearchTool(reg, { workspace });

    expect(reg.has("knowledge_search")).toBe(true);
    expect(reg.listForMode("plan").map((tool) => tool.name)).toContain("knowledge_search");
  });

  it("参数缺失返回 invalid_args", async () => {
    const reg = createToolRegistry();
    registerKnowledgeSearchTool(reg, { workspace });
    const result = await reg.invoke("knowledge_search", {}, {
      workspace,
      permissionManager: new PermissionManager("plan"),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid_args");
  });

  it("索引存在时返回 provenance-rich 结果", async () => {
    writeFileSync(path.join(workspace, "memory.ts"), "export const knowledgeRecall = 'digest';\n");
    const handle = openRagDb(workspace);
    try {
      indexWorkspace(handle.db, workspace);
    } finally {
      handle.close();
    }

    const reg = createToolRegistry();
    registerKnowledgeSearchTool(reg, { workspace });
    const result = await reg.invoke("knowledge_search", { query: "knowledgeRecall digest", mode: "rag" }, {
      workspace,
      permissionManager: new PermissionManager("plan"),
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("memory.ts");
    expect(result.content).toContain("provenance");
    expect(result.content).toContain("bm25");
  });

  it("支持 sources 参数过滤来源", async () => {
    writeFileSync(path.join(workspace, "memory.ts"), "export const knowledgeRecall = 'digest';\n");
    const handle = openRagDb(workspace);
    try {
      indexWorkspace(handle.db, workspace);
    } finally {
      handle.close();
    }

    const reg = createToolRegistry();
    registerKnowledgeSearchTool(reg, { workspace });
    const result = await reg.invoke("knowledge_search", {
      query: "knowledgeRecall digest",
      sources: ["rag", "bad-source"],
    }, {
      workspace,
      permissionManager: new PermissionManager("plan"),
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("sources=rag");
    expect(result.content).not.toContain("sources=rag,graph");
  });
});
