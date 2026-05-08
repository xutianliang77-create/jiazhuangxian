/**
 * QueryEngine · L2 Session Memory 集成测试
 *
 * 覆盖 recall 注入 + /forget 流程，绕过 LLM 调用（summarizer 由独立单测覆盖）。
 *
 * 测试场景：
 *   - dataDbPath + channel + userId 齐备：predef digests 在构造时被 recall
 *     注入到 messages 头部 system message
 *   - 缺 channel/userId 时 recall 不触发（不抛错）
 *   - dataDbPath=null 显式禁用：runForgetCommand 返回提示性消息
 *   - runForgetCommand({all:true}) 真清掉 db 中所有 digest
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { createQueryEngine } from "../../../src/agent/queryEngine";
import type { EngineEvent } from "../../../src/agent/types";
import type { ProviderStatus } from "../../../src/provider/types";
import { openDataDb } from "../../../src/storage/db";
import {
  loadRecentDigests,
  saveMemoryDigest,
  type MemoryDigest,
} from "../../../src/memory/sessionMemory/store";

const tempDirs: string[] = [];

async function collect(stream: AsyncGenerator<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

const provider: ProviderStatus = {
  instanceId: "openai:memory-test",
  type: "openai",
  displayName: "OpenAI",
  kind: "cloud",
  enabled: true,
  requiresApiKey: true,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutMs: 30_000,
  apiKey: "test-key",
  apiKeyEnvVar: "OPENAI_API_KEY",
  envVars: ["OPENAI_API_KEY"],
  fileConfig: {},
  configured: true,
  available: true,
  reason: "configured",
};

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function mkDataDb(): { dataDbPath: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-qe-mem-"));
  tempDirs.push(dir);
  return { dataDbPath: path.join(dir, "data.db") };
}

function predefDigest(dataDbPath: string, partial: Partial<MemoryDigest> = {}): void {
  const handle = openDataDb({ path: dataDbPath, singleton: false });
  handle.db.pragma("foreign_keys = OFF");
  saveMemoryDigest(handle.db, {
    digestId: `d-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: "s-prev",
    channel: "cli",
    userId: "alice",
    summary: "上次讨论了 audit 链问题",
    messageCount: 8,
    tokenEstimate: 80,
    createdAt: Date.now() - 1000,
    ...partial,
  });
  handle.close();
}

describe("QueryEngine L2 Memory · recall 注入", () => {
  it("新 session 默认不自动注入 L2 摘要", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { summary: "上次讨论 audit 链 hash 设计" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
    });

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg).toBeUndefined();
  });

  it("显式 enableSessionMemoryRecall=true 时保留兼容构造期注入", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { summary: "上次讨论 audit 链 hash 设计" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
      enableSessionMemoryRecall: true,
    });

    const messages = engine.getMessages();
    const sysMsg = messages.find((m) => m.role === "system");
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.text).toContain("相关近期对话摘要");
    expect(sysMsg!.text).toContain("audit 链 hash 设计");
  });

  it("空 db（无 digest）→ 不注入 system message", () => {
    const { dataDbPath } = mkDataDb();

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
    });

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg).toBeUndefined();
  });

  it("disableSessionMemoryRecall=true → 即使有 digest 也不注入 system message", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { summary: "不应进入新会话上下文" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "http",
      userId: "alice",
      disableSessionMemoryRecall: true,
    });

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg).toBeUndefined();
  });

  it("缺 channel → recall 不触发（不抛）", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath);

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      // 故意不传 channel + userId
    });

    expect(engine.getMessages().find((m) => m.role === "system")).toBeUndefined();
  });

  it("跨用户隔离：alice 的 digest 不会被 bob 召回", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { userId: "alice", summary: "alice's chat" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "bob",
    });

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg).toBeUndefined();
  });

  it("用户显式说继续上次时才注入相关 L2 摘要", async () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { summary: "上次讨论 audit 链 hash 设计" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
      disableSessionMemoryRecall: true,
    });

    for await (const _event of engine.submitMessage("继续上次")) {
      // drain
    }

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.source).toBe("summary");
    expect(sysMsg!.text).toContain("audit 链 hash 设计");
  });

  it("显式续接注入的 L2 system 摘要会进入 provider 请求", async () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, {
      summary: [
        "目标: 继续修复 L2 recall",
        "已完成: 找到 getProviderMessages 过滤 system 的问题",
        "关键证据: memory-recall injected",
        "文件/对象: src/agent/queryEngine.ts",
        "失败与原因: 无",
        "当前决策: 显式续接才召回",
        "下一步: 验证 provider 能收到摘要",
        "禁止重复: 不要重复旧 raw transcript",
      ].join("\n"),
    });
    let requestBody = "";
    const fetchImpl = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n'));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
            controller.close();
          },
        })
      );
    };

    const engine = createQueryEngine({
      currentProvider: provider,
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
      disableSessionMemoryRecall: true,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await collect(engine.submitMessage("继续上次"));

    expect(requestBody).toContain("相关近期对话摘要");
    expect(requestBody).toContain("继续修复 L2 recall");
    expect(requestBody).toContain("src/agent/queryEngine.ts");
  });

  it("/resume 显式注入 L2 摘要并在回复中标记", async () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { summary: "上次处理 report-df892d9d 报表" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
      disableSessionMemoryRecall: true,
    });

    let text = "";
    for await (const event of engine.submitMessage("/resume")) {
      if (event.type === "message-complete") text = event.text;
    }

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.text).toContain("report-df892d9d");
    expect(text).toContain("memory-recall: injected");
  });

  it("不召回失败或 thinking 污染的旧 digest", async () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { digestId: "bad1", summary: "[LLM 摘要失败] Provider request failed", createdAt: 3000 });
    predefDigest(dataDbPath, { digestId: "bad2", summary: "Here's a thinking process: should not recall", createdAt: 2000 });
    predefDigest(dataDbPath, { digestId: "good", summary: "目标: 继续有效任务\n已完成: 有效摘要", createdAt: 1000 });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
      disableSessionMemoryRecall: true,
    });

    await collect(engine.submitMessage("/resume"));

    const sysMsg = engine.getMessages().find((m) => m.role === "system");
    expect(sysMsg!.text).toContain("继续有效任务");
    expect(sysMsg!.text).not.toContain("Provider request failed");
    expect(sysMsg!.text).not.toContain("thinking process");
  });

  it("恢复已有 session 时不会把坏 L2 recall system 送进 provider", async () => {
    const { dataDbPath } = mkDataDb();
    const dir = path.dirname(dataDbPath);
    const sessionsDir = path.join(dir, "sessions");
    const sessionId = "restore-bad-recall";
    const seed = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      sessionsDir,
      channel: "cli",
      userId: "alice",
      sessionId,
    });
    // @ts-expect-error Testing restored transcript edge case.
    seed.messages.unshift({
      id: "recall-bad",
      role: "system",
      source: "summary",
      text: "Here's a thinking process: stale bad recall",
    });
    await collect(seed.submitMessage("/status"));

    let requestBody = "";
    const fetchImpl = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n'));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
            controller.close();
          },
        })
      );
    };
    const restored = createQueryEngine({
      currentProvider: provider,
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace: process.cwd(),
      dataDbPath,
      sessionsDir,
      channel: "cli",
      userId: "alice",
      sessionId,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await collect(restored.submitMessage("hi"));

    expect(requestBody).not.toContain("stale bad recall");
    expect(requestBody).not.toContain("thinking process");
  });
});

describe("QueryEngine L2 Memory · /forget 流程", () => {
  it("dataDbPath=null 显式禁用 → runForgetCommand 返回提示", () => {
    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath: null,
    });

    // @ts-expect-error LocalQueryEngine 实例方法在 QueryEngine 接口未声明
    expect(engine.runForgetCommand({ all: true })).toContain("Memory not enabled");
  });

  it("--all 真清掉 db 中所有 digest", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { digestId: "d1", summary: "first" });
    predefDigest(dataDbPath, { digestId: "d2", summary: "second" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
    });

    // 走 public 接口：
    // @ts-expect-error LocalQueryEngine 实例方法在 QueryEngine 接口未声明
    const result = engine.runForgetCommand({ all: true });
    // W3-16 跨表清理后输出格式："Forgot N session(s) (all)."
    // 我们的 predef digest 没建 sessions 表行，走孤儿摘要路径——也算 1 个
    expect(result).toContain("Forgot");
    expect(result).toContain("session(s)");

    // 验证 db 真清空
    const handle = openDataDb({ path: dataDbPath, singleton: false });
    expect(loadRecentDigests(handle.db, "cli", "alice")).toEqual([]);
    handle.close();
  });

  it("--session 只清指定 session", () => {
    const { dataDbPath } = mkDataDb();
    predefDigest(dataDbPath, { digestId: "d1", sessionId: "s1" });
    predefDigest(dataDbPath, { digestId: "d2", sessionId: "s2" });

    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
    });

    // @ts-expect-error LocalQueryEngine 实例方法在 QueryEngine 接口未声明
    const r = engine.runForgetCommand({ sessionId: "s1" });
    // 输出格式："Forgot session s1.\n  rows deleted: N (memory_digest=1)"
    expect(r).toContain("Forgot session s1");
    expect(r).toContain("memory_digest=1");

    const handle = openDataDb({ path: dataDbPath, singleton: false });
    const remaining = loadRecentDigests(handle.db, "cli", "alice");
    expect(remaining.map((d) => d.sessionId)).toEqual(["s2"]);
    handle.close();
  });
});

describe("QueryEngine L2 Memory · /end 在无 provider/dataDb 时降级", () => {
  it("dataDbPath=null → runEndCommand 返回 not enabled", async () => {
    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath: null,
    });

    // @ts-expect-error LocalQueryEngine 实例方法在 QueryEngine 接口未声明
    const result = await engine.runEndCommand();
    expect(result).toContain("Memory not enabled");
  });

  it("dataDb 可用但缺 channel/userId → 提示性返回", async () => {
    const { dataDbPath } = mkDataDb();
    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      // 不传 channel + userId
    });

    // @ts-expect-error LocalQueryEngine 实例方法在 QueryEngine 接口未声明
    const result = await engine.runEndCommand();
    expect(result).toContain("requires channel + userId");
  });

  it("dataDb + channel + userId 齐 但无 provider → 提示性返回（不调 LLM）", async () => {
    const { dataDbPath } = mkDataDb();
    const engine = createQueryEngine({
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      dataDbPath,
      channel: "cli",
      userId: "alice",
    });

    // @ts-expect-error LocalQueryEngine 实例方法在 QueryEngine 接口未声明
    const result = await engine.runEndCommand();
    expect(result).toContain("No provider configured");
  });
});
