import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createQueryEngine } from "../../../src/agent/queryEngine";
import type { EngineEvent } from "../../../src/agent/types";
import { getGlobalProviderCircuitBreaker } from "../../../src/provider/circuitBreaker";
import type { ProviderStatus } from "../../../src/provider/types";

const PROVIDER: ProviderStatus = {
  instanceId: "openai:default",
  type: "openai",
  displayName: "OpenAI",
  kind: "cloud",
  enabled: true,
  requiresApiKey: false,
  baseUrl: "http://x",
  model: "gpt-4",
  timeoutMs: 1000,
  envVars: [],
  fileConfig: {} as ProviderStatus["fileConfig"],
  configured: true,
  available: true,
  reason: "",
};

async function collect(gen: AsyncGenerator<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function lastReply(events: EngineEvent[]): string {
  const complete = events.filter((event) => event.type === "message-complete").at(-1);
  return complete && "text" in complete ? complete.text : "";
}

function mockOpenAiResponses(texts: string[]): typeof fetch {
  let index = 0;
  return (async () => {
    const text = texts[index] ?? texts.at(-1) ?? "";
    index += 1;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
            )
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      })
    );
  }) as unknown as typeof fetch;
}

let originalNativeTools: string | undefined;
let originalSubagent: string | undefined;
let tmpDirs: string[] = [];

beforeEach(() => {
  getGlobalProviderCircuitBreaker().reset();
  originalNativeTools = process.env.CODECLAW_NATIVE_TOOLS;
  originalSubagent = process.env.CODECLAW_SUBAGENT;
  process.env.CODECLAW_NATIVE_TOOLS = "true";
  process.env.CODECLAW_SUBAGENT = "true";
});

afterEach(() => {
  getGlobalProviderCircuitBreaker().reset();
  if (originalNativeTools === undefined) delete process.env.CODECLAW_NATIVE_TOOLS;
  else process.env.CODECLAW_NATIVE_TOOLS = originalNativeTools;
  if (originalSubagent === undefined) delete process.env.CODECLAW_SUBAGENT;
  else process.env.CODECLAW_SUBAGENT = originalSubagent;
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe("QueryEngine /team", () => {
  it("parses role-level model overrides for Team plans", async () => {
    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses(["unused"]),
      auditDbPath: null,
      dataDbPath: null,
    });

    const planText = lastReply(await collect(engine.submitMessage(
      "/team plan --model explorer=qwen/qwen3.6-14b --model reviewer=qwen/qwen3.6-27b 审查 src/agent/queryEngine.ts"
    )));

    expect(planText).toContain("model: qwen/qwen3.6-14b");
    expect(planText).toContain("model: qwen/qwen3.6-27b");
  });

  it("runs read-only Team workers through the Task tool and stores status", async () => {
    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses(["explorer evidence", "reviewer evidence"]),
      auditDbPath: null,
      dataDbPath: null,
    });

    const runText = lastReply(await collect(engine.submitMessage("/team run 审查 src/agent/queryEngine.ts")));
    expect(runText).toContain("Agent Team Run");
    expect(runText).toContain("status: completed");
    expect(runText).toContain("explorer evidence");
    expect(runText).toContain("reviewer evidence");
    expect(runText).toContain("Blackboard:");

    const statusText = lastReply(await collect(engine.submitMessage("/team status")));
    expect(statusText).toContain("Agent Team Run");
    expect(statusText).toContain("reviewer evidence");
  });

  it("persists TeamRun status into data.db when session identity is available", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-team-engine-"));
    tmpDirs.push(tmpRoot);
    const dbPath = path.join(tmpRoot, "data.db");
    const sessionId = "web-team-session";
    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses(["persisted explorer", "persisted reviewer"]),
      auditDbPath: null,
      dataDbPath: dbPath,
      channel: "http",
      userId: "user-a",
      sessionId,
    });

    await collect(engine.submitMessage("/team run 审查 src/agent/queryEngine.ts"));

    const restored = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses(["unused"]),
      auditDbPath: null,
      dataDbPath: dbPath,
      channel: "http",
      userId: "user-a",
      sessionId,
    });
    const statusText = lastReply(await collect(restored.submitMessage("/team status")));
    expect(statusText).toContain("persisted reviewer");
  });

  it("approves claimed-file gates without executing writes", async () => {
    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses(["explorer evidence"]),
      auditDbPath: null,
      dataDbPath: null,
    });

    const runText = lastReply(await collect(engine.submitMessage("/team run 修复 src/agent/queryEngine.ts 并补测试")));
    expect(runText).toContain("status: waiting_approval");
    const claimId = /- ([^ ]+) \[write\] pending_approval src\/agent\/queryEngine\.ts/.exec(runText)?.[1];
    expect(claimId).toBeTruthy();

    const approveText = lastReply(await collect(engine.submitMessage(`/team approve ${claimId}`)));
    expect(approveText).toContain("Team claim approved");
    expect(approveText).toContain("/team write");
    expect(approveText).toContain("[write] active src/agent/queryEngine.ts");
  });

  it("executes approved claimed-file writes through /team write", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-team-write-engine-"));
    tmpDirs.push(tmpRoot);
    mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    writeFileSync(path.join(tmpRoot, "src/example.ts"), "const value = 'old';\n", "utf8");

    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: tmpRoot,
      fetchImpl: mockOpenAiResponses(["explorer evidence"]),
      auditDbPath: null,
      dataDbPath: null,
    });

    const runText = lastReply(await collect(engine.submitMessage("/team run 修复 src/example.ts")));
    const claimId = /- ([^ ]+) \[write\] pending_approval src\/example\.ts/.exec(runText)?.[1];
    expect(claimId).toBeTruthy();

    await collect(engine.submitMessage(`/team approve ${claimId}`));
    const writeText = lastReply(await collect(engine.submitMessage(
      `/team write ${claimId} /replace src/example.ts :: old :: new`
    )));

    expect(writeText).toContain("Team write completed");
    expect(writeText).toContain("[write] released src/example.ts");
    expect(writeText).toContain("team-task-2 [implementer] completed");
    expect(readFileSync(path.join(tmpRoot, "src/example.ts"), "utf8")).toContain("'new'");
  });

  it("cancels waiting TeamRuns and releases pending claims", async () => {
    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses(["explorer evidence"]),
      auditDbPath: null,
      dataDbPath: null,
    });

    const runText = lastReply(await collect(engine.submitMessage("/team run 修复 src/agent/queryEngine.ts 并补测试")));
    const runId = /^id: (team-run-\S+)$/m.exec(runText)?.[1];
    expect(runId).toBeTruthy();

    const cancelText = lastReply(await collect(engine.submitMessage(`/team cancel ${runId}`)));
    expect(cancelText).toContain("TeamRun cancelled");
    expect(cancelText).toContain("status: cancelled");
    expect(cancelText).toContain("[write] released src/agent/queryEngine.ts");
  });

  it("retries read-only TeamRuns and rejects write-capable retries", async () => {
    const engine = createQueryEngine({
      currentProvider: PROVIDER,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: mockOpenAiResponses([
        "first explorer",
        "first reviewer",
        "retry explorer",
        "retry reviewer",
        "write explorer",
      ]),
      auditDbPath: null,
      dataDbPath: null,
    });

    const readOnlyText = lastReply(await collect(engine.submitMessage("/team run 审查 src/agent/queryEngine.ts")));
    const readOnlyRunId = /^id: (team-run-\S+)$/m.exec(readOnlyText)?.[1];
    expect(readOnlyRunId).toBeTruthy();

    const retryText = lastReply(await collect(engine.submitMessage(`/team retry ${readOnlyRunId}`)));
    expect(retryText).toContain("TeamRun retried");
    expect(retryText).toContain("retry reviewer");

    const writeText = lastReply(await collect(engine.submitMessage("/team run 修复 src/agent/queryEngine.ts")));
    const writeRunId = /^id: (team-run-\S+)$/m.exec(writeText)?.[1];
    expect(writeRunId).toBeTruthy();
    const blockedRetryText = lastReply(await collect(engine.submitMessage(`/team retry ${writeRunId}`)));
    expect(blockedRetryText).toContain("cannot be retried automatically");
  });
});
