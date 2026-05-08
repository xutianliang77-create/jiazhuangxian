/**
 * M1-B.2 · queryEngine native tool_use multi-turn 派发循环
 *
 * 端到端覆盖：
 *   - env CODECLAW_NATIVE_TOOLS=true 时 toolRegistry 注册 9 个 builtin
 *   - 第 1 回合 LLM 发 tool_calls(read foo.txt) → engine 调 toolRegistry.invoke
 *     → push role:"tool" 消息（含 toolCallId）→ 触发第 2 次 LLM 调用
 *   - 第 2 回合 LLM 发文字 → 主流程结束、yield message-complete + phase=completed
 *   - 第 2 次 fetch 的 messages 含完整 turn 1 上下文（assistant w/ toolCalls + tool result）
 *   - MAX_TOOL_TURNS 防无限循环
 *   - env 关闭时（默认）零行为变化、不发 tools schema
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { createQueryEngine } from "../../../src/agent/queryEngine";
import { getGlobalProviderCircuitBreaker } from "../../../src/provider/circuitBreaker";
import type { ProviderStatus } from "../../../src/provider/types";

function provider(): ProviderStatus {
  return {
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
}

function sseFrames(frames: object[]): string {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n`).join("") + "data: [DONE]\n";
}

function sseResponse(body: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    })
  );
}

async function collect(
  gen: AsyncGenerator<unknown>
): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

let workspace: string;
const ORIGINAL_ENV = process.env.CODECLAW_NATIVE_TOOLS;
const ORIGINAL_REPEAT_LIMIT_ENV = process.env.CHATBI_REPEATED_TOOL_CALL_LIMIT;
const ORIGINAL_LOW_PROGRESS_ENV = process.env.CHATBI_LOW_PROGRESS_TOOL_TURNS;

beforeEach(() => {
  getGlobalProviderCircuitBreaker().reset();
  workspace = path.join(os.tmpdir(), `nt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  process.env.CODECLAW_NATIVE_TOOLS = "true";
});

afterEach(() => {
  getGlobalProviderCircuitBreaker().reset();
  rmSync(workspace, { recursive: true, force: true });
  if (ORIGINAL_ENV === undefined) delete process.env.CODECLAW_NATIVE_TOOLS;
  else process.env.CODECLAW_NATIVE_TOOLS = ORIGINAL_ENV;
  if (ORIGINAL_REPEAT_LIMIT_ENV === undefined) delete process.env.CHATBI_REPEATED_TOOL_CALL_LIMIT;
  else process.env.CHATBI_REPEATED_TOOL_CALL_LIMIT = ORIGINAL_REPEAT_LIMIT_ENV;
  if (ORIGINAL_LOW_PROGRESS_ENV === undefined) delete process.env.CHATBI_LOW_PROGRESS_TOOL_TURNS;
  else process.env.CHATBI_LOW_PROGRESS_TOOL_TURNS = ORIGINAL_LOW_PROGRESS_ENV;
});

describe("queryEngine native tool_use multi-turn", () => {
  it("turn 1 tool_call(read) → engine 派发 → turn 2 final answer", async () => {
    writeFileSync(path.join(workspace, "foo.txt"), "secret-content-42");

    const requests: Array<{ messages: Array<Record<string, unknown>>; tools?: unknown }> = [];
    let callIndex = 0;

    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<Record<string, unknown>>;
        tools?: unknown;
      };
      requests.push(body);
      callIndex += 1;

      if (callIndex === 1) {
        // turn 1：LLM 调 read 工具
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"foo.txt"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      // turn 2：LLM 看到 tool 结果后回答
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "Found content: secret-content-42" }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });

    await collect(engine.submitMessage("read foo.txt 看看"));

    // 两次 fetch：每个 turn 一次
    expect(callIndex).toBeGreaterThanOrEqual(2);

    // 第 1 次 request 含 tools schema
    expect(Array.isArray(requests[0].tools)).toBe(true);
    const tools0 = requests[0].tools as Array<{ type: string; function: { name: string } }>;
    expect(tools0.map((t) => t.function.name)).toContain("read");

    // 第 2 次 request 的 messages 含 assistant.tool_calls + role:"tool" 结果
    const turn2Msgs = requests[1].messages as Array<{
      role: string;
      tool_calls?: Array<{ id: string; function: { name: string } }>;
      tool_call_id?: string;
      content?: string;
    }>;
    const assistantToolUse = turn2Msgs.find((m) => m.role === "assistant" && m.tool_calls);
    expect(assistantToolUse?.tool_calls?.[0].function.name).toBe("read");
    expect(assistantToolUse?.tool_calls?.[0].id).toBe("call_1");

    const toolResult = turn2Msgs.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect(toolResult?.tool_call_id).toBe("call_1");
    expect(String(toolResult?.content)).toContain("secret-content-42");

    // engine.getMessages 含 user / assistant(turn1, toolCalls) / tool / assistant(turn2)
    const all = engine.getMessages();
    const roles = all.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles.filter((r) => r === "assistant").length).toBeGreaterThanOrEqual(2);
    expect(roles).toContain("tool");
    expect(all.at(-1)?.text).toContain("secret-content-42");

    const evidence = engine.getEvidenceSnapshot?.() ?? [];
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      toolName: "read",
      status: "succeeded",
      toolCallId: "call_1",
    });
    expect(evidence[0]?.argsPreview).toContain("foo.txt");
    expect(evidence[0]?.resultSummary).toContain("secret-content-42");
  });

  it("hides tool preambles for SQL-only prompts while preserving provider tool context", async () => {
    writeFileSync(path.join(workspace, "schema.txt"), "D=product, E=orders, F=revenue");

    const requests: Array<{ messages: Array<Record<string, unknown>>; tools?: unknown }> = [];
    let callIndex = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<Record<string, unknown>>;
        tools?: unknown;
      };
      requests.push(body);
      callIndex += 1;

      if (callIndex === 1) {
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { content: "Let me first check schema." } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_schema", function: { name: "read" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"schema.txt"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }

      return sseResponse(
        sseFrames([
          {
            choices: [
              {
                delta: {
                  content:
                    'SELECT D AS product, SUM(E) AS total_quantity, SUM(F) AS total_sales_amount FROM "@xu".sample_sales_daily GROUP BY D ORDER BY total_sales_amount DESC LIMIT 10;',
                },
                finish_reason: "stop",
              },
            ],
          },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });

    const events = await collect(
      engine.submitMessage(
        "请生成 SQL，只输出 SQL，不要执行：统计 @xu.sample_sales_daily 每个商品的销量和销售额。"
      )
    );

    expect(events.some((event) => JSON.stringify(event).includes("Let me first check schema"))).toBe(false);
    expect(engine.getVisibleMessages().some((message) => message.text.includes("Let me first check schema"))).toBe(false);
    expect(engine.getMessages().some((message) => message.hiddenFromUi && message.text.includes("Let me first check schema"))).toBe(true);

    const turn2Msgs = requests[1].messages as Array<{ role: string; tool_calls?: unknown }>;
    expect(turn2Msgs.some((message) => message.role === "assistant" && message.tool_calls)).toBe(true);
    expect(engine.getVisibleMessages().at(-1)?.text).toBe(
      'SELECT D AS product, SUM(E) AS total_quantity, SUM(F) AS total_sales_amount FROM "@xu".sample_sales_daily GROUP BY D ORDER BY total_sales_amount DESC LIMIT 10;'
    );
  });

  it("env=false 显式关闭时不发 tools schema、走单回合（向后兼容）", async () => {
    process.env.CODECLAW_NATIVE_TOOLS = "false";
    const requests: Array<{ tools?: unknown }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { tools?: unknown });
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "plain answer" }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });

    await collect(engine.submitMessage("hi"));

    expect(requests).toHaveLength(1);
    expect(requests[0].tools).toBeUndefined();
    expect(engine.getMessages().at(-1)?.text).toBe("plain answer");
  });

  it("v0.7.0: env 未设时默认启用 native tools（注册 builtin tools）", async () => {
    delete process.env.CODECLAW_NATIVE_TOOLS;
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requests.push(
        JSON.parse(String(init?.body)) as { tools?: Array<{ function: { name: string } }> }
      );
      return sseResponse(
        sseFrames([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });

    await collect(engine.submitMessage("hi"));

    expect(Array.isArray(requests[0].tools)).toBe(true);
    const names = (requests[0].tools as Array<{ function: { name: string } }>).map(
      (t) => t.function.name
    );
    expect(names).toContain("read");
  });

  it("stops repeated identical tool calls and forces a final answer", async () => {
    process.env.CHATBI_REPEATED_TOOL_CALL_LIMIT = "2";
    writeFileSync(path.join(workspace, "foo.txt"), "loop-breaker-content");
    const requests: Array<{ messages: Array<Record<string, unknown>>; tools?: unknown }> = [];
    let callIndex = 0;

    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<Record<string, unknown>>;
        tools?: unknown;
      };
      requests.push(body);
      callIndex += 1;
      if (callIndex <= 2) {
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${callIndex}`, function: { name: "read" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"foo.txt"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "Final answer from existing tool result." }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });

    await collect(engine.submitMessage("read foo repeatedly"));

    expect(callIndex).toBe(3);
    expect(requests[2].tools).toBeUndefined();
    expect(engine.getMessages().filter((message) => message.role === "tool")).toHaveLength(1);
    expect(engine.getMessages().at(-1)?.text).toContain("Final answer from existing tool result.");
  });

  it("blocks oversized source scans before direct read/glob tools consume the turn", async () => {
    let providerCalls = 0;
    const fetchImpl = (async () => {
      providerCalls += 1;
      return sseResponse(
        sseFrames([
          {
            choices: [
              {
                delta: {
                  tool_calls: Array.from({ length: 6 }, (_, index) => ({
                    index,
                    id: `read_${index}`,
                    function: {
                      name: "read",
                      arguments: JSON.stringify({ file_path: `src/file-${index}.ts` }),
                    },
                  })),
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace,
      fetchImpl,
    });

    const events = await collect(engine.submitMessage("扫描整个项目的所有源码文件，每一个文件都要详细阅读，输出完整 bug 报告"));
    const complete = [...events].reverse().find((event) => (event as { type?: string }).type === "message-complete") as { text?: string } | undefined;

    expect(providerCalls).toBe(1);
    expect(complete?.text).toContain("task_needs_staging");
    expect(complete?.text).toContain("direct-tool-guard");
    expect(complete?.text).toContain("阶段 1");
    expect(engine.getMessages().filter((message) => message.role === "tool")).toHaveLength(6);
    expect(engine.getMessages().filter((message) => message.role === "tool").every((message) => message.text.includes("task_needs_staging"))).toBe(true);
  });

  it("stops low-progress failed tool turns and forces a final answer", async () => {
    process.env.CHATBI_LOW_PROGRESS_TOOL_TURNS = "2";
    const requests: Array<{ tools?: unknown }> = [];
    let providerCalls = 0;
    let toolCalls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tools?: unknown };
      requests.push(body);
      providerCalls += 1;
      if (body.tools === undefined) {
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { content: "Final answer after repeated tool failures." }, finish_reason: "stop" }] },
          ])
        );
      }
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: `fail_${providerCalls}`, function: { name: "fake_query" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `{"attempt":${providerCalls}}` } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace,
      fetchImpl,
    });
    (engine as unknown as {
      toolRegistry: {
        register(tool: {
          name: string;
          description: string;
          inputSchema: { type: "object"; properties: Record<string, unknown> };
          invoke(args: unknown, ctx: unknown): Promise<{ ok: boolean; content: string; isError?: boolean }>;
        }): void;
      };
    }).toolRegistry.register({
      name: "fake_query",
      description: "test-only failing query tool",
      inputSchema: { type: "object", properties: {} },
      invoke: async () => {
        toolCalls += 1;
        return { ok: false, content: "query failed", isError: true };
      },
    });

    await collect(engine.submitMessage("keep trying broken queries"));

    expect(toolCalls).toBe(2);
    expect(requests[2].tools).toBeUndefined();
    expect(engine.getMessages().at(-1)?.text).toContain("Final answer after repeated tool failures.");
  });

  it("M2-03：plan mode → LLM 调 ExitPlanMode → engine 切 default mode + 后续轮次拿全工具", async () => {
    let callIndex = 0;
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { tools?: Array<{ function: { name: string } }> });
      callIndex += 1;
      if (callIndex === 1) {
        // turn 1 (plan mode)：LLM 调 ExitPlanMode 提交 plan
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "ep_1", function: { name: "ExitPlanMode" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"plan":"1. read foo.txt\\n2. modify it"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      // turn 2 (default mode)：LLM 看到 tool 结果就回答（mode 已切，工具全量可见）
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "Plan accepted, executing now." }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "plan",
      workspace,
      fetchImpl,
    });
    await collect(engine.submitMessage("帮我修个 bug"));

    expect(callIndex).toBeGreaterThanOrEqual(2);
    // turn 1 在 plan mode：tools 数组只含 read-only + memory_write + ExitPlanMode；不含 bash/write
    const turn1Tools = (requests[0].tools ?? []).map((t) => t.function.name);
    expect(turn1Tools).toContain("ExitPlanMode");
    expect(turn1Tools).toContain("read");
    expect(turn1Tools).not.toContain("bash");
    expect(turn1Tools).not.toContain("write");
    // turn 2 mode 切到 default：tools 全量含 bash/write
    const turn2Tools = (requests[1].tools ?? []).map((t) => t.function.name);
    expect(turn2Tools).toContain("bash");
    expect(turn2Tools).toContain("write");
    // engine 当前 permissionMode 已切回 default
    expect(engine.getRuntimeState().permissionMode).toBe("default");
  });

  it("M2-04：evaluate(deny) → push role:tool 否决 + 不调 invoke", async () => {
    let callIndex = 0;
    const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> });
      callIndex += 1;
      if (callIndex === 1) {
        // turn 1：LLM 调 bash 高危命令（含 rm 触发 deny）
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "b1", function: { name: "bash" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":"rm -rf /"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      // turn 2：LLM 看到 deny 改口
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "Sorry, I cannot do that." }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "acceptEdits", // high risk → deny
      workspace,
      fetchImpl,
    });
    await collect(engine.submitMessage("clean up everything"));

    expect(callIndex).toBe(2);
    // turn 2 messages 含一条 role:"tool" 且 content 含 denial reason
    const turn2Msgs = requests[1].messages as Array<{ role: string; content?: string }>;
    const denialTool = turn2Msgs.find((m) => m.role === "tool");
    expect(denialTool).toBeDefined();
    expect(String(denialTool?.content)).toMatch(/User policy denied|denied this tool call/);
    // engine.getMessages 含 tool role + 最终 assistant
    expect(engine.getMessages().filter((m) => m.role === "tool").length).toBeGreaterThanOrEqual(1);
    expect(engine.getMessages().at(-1)?.text).toContain("cannot");
  });

  it("M2-04：evaluate(ask) → 同样 push role:tool 阻 LLM 重试（保守降级）", async () => {
    let callIndex = 0;
    const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> });
      callIndex += 1;
      if (callIndex === 1) {
        // turn 1：default mode + write tool（medium → ask）
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "w1", function: { name: "write" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"x.ts","content":"y"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "OK skipping" }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });
    await collect(engine.submitMessage("write x.ts"));

    const turn2Msgs = requests[1].messages as Array<{ role: string; content?: string }>;
    const askTool = turn2Msgs.find((m) => m.role === "tool");
    expect(askTool).toBeDefined();
    expect(String(askTool?.content)).toContain("Approval required");
  });

  it("M2-04：evaluate(allow) → 正常 invoke（read low risk 在 default mode）", async () => {
    writeFileSync(path.join(workspace, "ok.txt"), "all-good-content");
    let callIndex = 0;
    const fetchImpl = (async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "r1", function: { name: "read" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"ok.txt"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "Got: all-good-content" }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;
    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });
    await collect(engine.submitMessage("read ok.txt"));
    // tool message 是真读到的内容，不是 denial
    const toolMsg = engine.getMessages().find((m) => m.role === "tool");
    expect(toolMsg?.text).toContain("all-good-content");
    expect(toolMsg?.text).not.toContain("denied");
  });

  it("passes abortSignal to tools so interrupt can stop long tool execution", async () => {
    let sawSignal = false;
    let sawAbort = false;
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve;
    });
    const fetchImpl = (async () =>
      sseResponse(
        sseFrames([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "slow_1", function: { name: "slow_tool" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      )) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace,
      fetchImpl,
    });
    (engine as unknown as {
      toolRegistry: {
        register(tool: {
          name: string;
          description: string;
          inputSchema: { type: "object"; properties: Record<string, unknown> };
          invoke(args: unknown, ctx: { abortSignal?: AbortSignal }): Promise<{ ok: boolean; content: string; isError?: boolean }>;
        }): void;
      };
    }).toolRegistry.register({
      name: "slow_tool",
      description: "test-only slow tool",
      inputSchema: { type: "object", properties: {} },
      invoke: async (_args, ctx) => {
        sawSignal = !!ctx.abortSignal;
        markToolStarted();
        return await new Promise((resolve) => {
          const finish = () => {
            sawAbort = true;
            resolve({ ok: false, content: "aborted by test", isError: true });
          };
          if (ctx.abortSignal?.aborted) {
            finish();
            return;
          }
          ctx.abortSignal?.addEventListener("abort", finish, { once: true });
        });
      },
    });

    const stream = engine.submitMessage("run slow tool");
    let sawToolStart = false;
    while (!sawToolStart) {
      const next = await stream.next();
      if (next.done) break;
      sawToolStart = (next.value as { type?: string }).type === "tool-start";
    }
    expect(sawToolStart).toBe(true);

    const pendingToolResult = stream.next();
    await toolStarted;
    engine.interrupt();
    await pendingToolResult;
    const tail: unknown[] = [];
    for await (const event of stream) tail.push(event);

    expect(sawSignal).toBe(true);
    expect(sawAbort).toBe(true);
    expect(tail.some((event) => (event as { type?: string; phase?: string }).type === "phase" && (event as { phase?: string }).phase === "halted")).toBe(true);
  });

  it("falls back to successful tool summaries when final provider summary fails", async () => {
    let callIndex = 0;
    const fetchImpl = (async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "query_1", function: { name: "fake_query" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace,
      fetchImpl,
    });
    (engine as unknown as {
      toolRegistry: {
        register(tool: {
          name: string;
          description: string;
          inputSchema: { type: "object"; properties: Record<string, unknown> };
          invoke(args: unknown, ctx: unknown): Promise<{ ok: boolean; content: string; isError?: boolean }>;
        }): void;
      };
    }).toolRegistry.register({
      name: "fake_query",
      description: "test-only query tool",
      inputSchema: { type: "object", properties: {} },
      invoke: async () => ({
        ok: true,
        content: "Query preview rows: 2\n| food | sales |\n| --- | --- |\n| bread | 10 |\n| milk | 8 |",
      }),
    });

    const events = await collect(engine.submitMessage("query and chart"));
    const complete = [...events].reverse().find((event) => (event as { type?: string }).type === "message-complete") as { text?: string } | undefined;

    expect(callIndex).toBeGreaterThanOrEqual(2);
    expect(complete?.text).toContain("工具已经执行完成，但最终模型总结失败");
    expect(complete?.text).toContain("CodeClaw 已生成本地 fallback，未再次调用模型");
    expect(complete?.text).toContain("Provider request failed: fetch failed");
    expect(complete?.text).toContain("provider-attempts:");
    expect(complete?.text).toContain("openai:default#1 transient: fetch failed");
    expect(complete?.text).toContain("已完成的工具动作");
    expect(complete?.text).toContain("工具结果摘要 · fake_query");
    expect(complete?.text).toContain("fake_query");
    expect(complete?.text).toContain("结果: 返回查询预览 2 行。");
    expect(complete?.text).toContain("artifact: none");
    expect(complete?.text).toContain("下一步:");
  });

  it("falls back to successful tool summaries when final provider summary is empty", async () => {
    let callIndex = 0;
    const fetchImpl = (async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return sseResponse(
          sseFrames([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "query_1", function: { name: "fake_query" } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ])
        );
      }
      return sseResponse(
        sseFrames([
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace,
      fetchImpl,
    });
    (engine as unknown as {
      toolRegistry: {
        register(tool: {
          name: string;
          description: string;
          inputSchema: { type: "object"; properties: Record<string, unknown> };
          invoke(args: unknown, ctx: unknown): Promise<{ ok: boolean; content: string; isError?: boolean }>;
        }): void;
      };
    }).toolRegistry.register({
      name: "fake_query",
      description: "test-only query tool",
      inputSchema: { type: "object", properties: {} },
      invoke: async () => ({
        ok: true,
        content: "Query preview rows: 2\n| item | quantity |\n| --- | --- |\n| bread | 10 |\n| milk | 8 |",
      }),
    });

    const events = await collect(engine.submitMessage("query and chart"));
    const complete = [...events].reverse().find((event) => (event as { type?: string }).type === "message-complete") as { text?: string } | undefined;

    expect(callIndex).toBeGreaterThanOrEqual(2);
    expect(complete?.text).toContain("工具已经执行完成，但模型最终总结为空");
    expect(complete?.text).toContain("CodeClaw 已生成本地 fallback，未再次调用模型");
    expect(complete?.text).toContain("The model returned an empty final response");
    expect(complete?.text).toContain("工具结果摘要 · fake_query");
    expect(complete?.text).toContain("结果: 返回查询预览 2 行。");
    expect(complete?.text).toContain("artifact: none");
    expect(complete?.text).toContain("下一步:");
    expect(complete?.text).not.toBe("Provider returned an empty response.");
  });

  it("formats tool fallback as structured recent summaries instead of raw dumps", () => {
    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "dontAsk",
      workspace,
      fetchImpl: (() => {
        throw new Error("not used");
      }) as unknown as typeof fetch,
    });
    const reply = (engine as unknown as {
      buildEmptyResponseWithToolFallback(tools: Array<{ toolName: string; summary: string; artifactPath?: string }>): string;
    }).buildEmptyResponseWithToolFallback([
      { toolName: "bash", summary: "old_raw_should_not_appear\n/old/file.ts" },
      { toolName: "glob", summary: "/repo/src/a.ts\n/repo/src/b.ts\nraw_glob_body_should_not_appear" },
      { toolName: "read", summary: "Read /repo/src/queryEngine.ts\nraw_read_body_should_not_appear" },
      { toolName: "mcp__beelink__RunSqlQuery", summary: "Query preview rows: 3\nQuery id: q-123\nraw_mcp_body_should_not_appear" },
      { toolName: "Task", summary: "Task reviewer failed: Provider request failed: fetch failed\nraw_task_body_should_not_appear" },
      { toolName: "bash", summary: "/repo/src/agent/a.ts\n/repo/src/agent/b.ts\nraw_bash_body_should_not_appear", artifactPath: "/tmp/tool-6.txt" },
    ]);

    expect(reply).not.toContain("old_raw_should_not_appear");
    expect(reply).not.toContain("raw_glob_body_should_not_appear");
    expect(reply).not.toContain("raw_read_body_should_not_appear");
    expect(reply).not.toContain("raw_mcp_body_should_not_appear");
    expect(reply).not.toContain("raw_task_body_should_not_appear");
    expect(reply).not.toContain("raw_bash_body_should_not_appear");
    expect(reply.match(/\n\d+\. /g)?.length).toBe(5);
    expect(reply).toContain("匹配到的文件清单 · glob");
    expect(reply).toContain("读取了哪些文件 · read");
    expect(reply).toContain("调用了哪些外部能力 · mcp__beelink__RunSqlQuery");
    expect(reply).toContain("子代理产出/失败原因 · Task");
    expect(reply).toContain("文件结构/目录扫描 · bash");
    expect(reply).toContain("artifact: /tmp/tool-6.txt");
    expect(reply).toContain("下一步:");
  });

  it("LLM 没有调工具时 multi-turn 退化为单回合（即使 env 开启）", async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return sseResponse(
        sseFrames([
          { choices: [{ delta: { content: "no tool needed" }, finish_reason: "stop" }] },
        ])
      );
    }) as unknown as typeof fetch;

    const engine = createQueryEngine({
      currentProvider: provider(),
      fallbackProvider: null,
      permissionMode: "default",
      workspace,
      fetchImpl,
    });

    await collect(engine.submitMessage("hi"));

    expect(callCount).toBe(1);
    expect(engine.getMessages().at(-1)?.text).toBe("no tool needed");
  });
});
