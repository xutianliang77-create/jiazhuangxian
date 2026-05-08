import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryEngine } from "../../../src/agent/queryEngine";
import {
  TurnGuard,
  LowProgressGuard,
  getLowProgressToolTurns,
  getMaxOutputRecoveryTurns,
  getMaxToolTurns,
  getMaxTurnBytes,
  getTerminalRenderBytes,
} from "../../../src/agent/turnGuard";
import { wrapLargeTextArtifact } from "../../../src/agent/tools/artifact";
import { getGlobalProviderCircuitBreaker } from "../../../src/provider/circuitBreaker";
import type { EngineEvent } from "../../../src/agent/types";
import type { ProviderStatus } from "../../../src/provider/types";

const provider: ProviderStatus = {
  instanceId: "openai:default",
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
  delete process.env.CHATBI_MAX_TURN_BYTES;
  delete process.env.CODECLAW_MAX_TURN_BYTES;
  delete process.env.CHATBI_MAX_TOOL_TURNS;
  delete process.env.CODECLAW_MAX_TOOL_TURNS;
  delete process.env.CHATBI_MAX_OUTPUT_RECOVERY_TURNS;
  delete process.env.CODECLAW_MAX_OUTPUT_RECOVERY_TURNS;
  delete process.env.CHATBI_LOW_PROGRESS_TOOL_TURNS;
  delete process.env.CODECLAW_LOW_PROGRESS_TOOL_TURNS;
  delete process.env.CHATBI_TERMINAL_RENDER_BYTES;
  delete process.env.CODECLAW_TERMINAL_RENDER_BYTES;
  delete process.env.CHATBI_PROVIDER_COOLDOWN_MS;
  delete process.env.CODECLAW_PROVIDER_COOLDOWN_MS;
  delete process.env.CHATBI_PROVIDER_STUCK_THRESHOLD;
  delete process.env.CODECLAW_PROVIDER_STUCK_THRESHOLD;
  getGlobalProviderCircuitBreaker().reset();
});

async function collect(stream: AsyncGenerator<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("TurnGuard", () => {
  it("reads CodeClaw env limits before legacy env limits", () => {
    process.env.CODECLAW_MAX_TURN_BYTES = "100";
    process.env.CHATBI_MAX_TURN_BYTES = "42";
    process.env.CHATBI_MAX_TOOL_TURNS = "7";
    process.env.CHATBI_LOW_PROGRESS_TOOL_TURNS = "6";

    expect(getMaxTurnBytes()).toBe(100);
    expect(getMaxToolTurns()).toBe(7);
    expect(getLowProgressToolTurns()).toBe(6);
  });

  it("uses conservative defaults for TUI safety", () => {
    expect(getMaxTurnBytes()).toBe(64 * 1024);
    expect(getTerminalRenderBytes()).toBe(24 * 1024);
    expect(getMaxToolTurns()).toBe(24);
    expect(getMaxOutputRecoveryTurns()).toBe(2);
    expect(getLowProgressToolTurns()).toBe(4);
  });

  it("returns a stop decision when assistant output exceeds the turn budget", () => {
    const guard = new TurnGuard(8);

    expect(guard.recordAssistantDelta("1234")).toBeNull();
    const stop = guard.recordAssistantDelta("56789");

    expect(stop?.reason).toContain("assistant output exceeded 8 bytes");
    expect(stop?.message).toContain("CodeClaw stopped this response");
  });

  it("stops after consecutive failed tool turns without successful tools", () => {
    const guard = new LowProgressGuard(2);

    expect(guard.recordToolTurn({ toolCallCount: 1, successfulToolCount: 0 })).toBeNull();
    const stop = guard.recordToolTurn({ toolCallCount: 1, successfulToolCount: 0 });

    expect(stop?.reason).toContain("low progress after 2 failed tool turns");
  });

  it("resets low-progress tracking after a successful tool turn", () => {
    const guard = new LowProgressGuard(2);

    expect(guard.recordToolTurn({ toolCallCount: 1, successfulToolCount: 0 })).toBeNull();
    expect(guard.recordToolTurn({ toolCallCount: 1, successfulToolCount: 1 })).toBeNull();
    expect(guard.recordToolTurn({ toolCallCount: 1, successfulToolCount: 0 })).toBeNull();
  });

  it("stops a runaway provider stream and completes with a guard note", async () => {
    process.env.CHATBI_MAX_TURN_BYTES = "8";
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"12345"}}]}\n'));
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"67890"}}]}\n'));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
            controller.close();
          },
        })
      );

    const engine = createQueryEngine({
      currentProvider: provider,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    const events = await collect(engine.submitMessage("runaway"));
    const complete = [...events].reverse().find((event) => event.type === "message-complete");

    expect(complete).toBeDefined();
    expect((complete as { text: string }).text).toContain("CodeClaw stopped this response");
    expect(engine.getMessages().at(-1)?.text).toContain("CodeClaw stopped this response");
  });

  it("recovers bounded long output before giving the final artifact-safe answer", async () => {
    process.env.CHATBI_MAX_TURN_BYTES = "8";
    process.env.CHATBI_MAX_OUTPUT_RECOVERY_TURNS = "2";
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const content = calls === 1 ? "123456789" : calls === 2 ? "abcdefghi" : "done";
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(`data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n`)
            );
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
            controller.close();
          },
        })
      );
    };

    const engine = createQueryEngine({
      currentProvider: provider,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    const events = await collect(engine.submitMessage("long answer"));
    const complete = [...events].reverse().find((event) => event.type === "message-complete");

    expect(calls).toBe(3);
    expect((complete as { text: string }).text).toContain("123456789");
    expect((complete as { text: string }).text).toContain("abcdefghi");
    expect((complete as { text: string }).text).toContain("done");
  });

  it("does not cool down a provider for normal output-limit recovery", async () => {
    process.env.CHATBI_MAX_TURN_BYTES = "8";
    process.env.CHATBI_MAX_OUTPUT_RECOVERY_TURNS = "1";
    process.env.CHATBI_PROVIDER_COOLDOWN_MS = "60000";
    process.env.CHATBI_PROVIDER_STUCK_THRESHOLD = "1";
    let calls = 0;
    const fallbackProvider: ProviderStatus = {
      ...provider,
      instanceId: "ollama:default",
      type: "ollama",
      displayName: "Ollama",
      kind: "local",
      requiresApiKey: false,
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.1",
      apiKey: undefined,
      apiKeyEnvVar: undefined,
    };
    const fetchImpl = async (input: string | URL | Request) => {
      calls += 1;
      const url = String(input);
      if (url.includes("api.openai.com")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"12345"}}]}\n'));
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"67890"}}]}\n'));
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
              controller.close();
            },
          })
        );
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"message":{"content":"fallback-ok"}}\n'));
            controller.close();
          },
        })
      );
    };

    const engine = createQueryEngine({
      currentProvider: provider,
      fallbackProvider,
      permissionMode: "plan",
      workspace: process.cwd(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    await collect(engine.submitMessage("runaway"));
    const second = await collect(engine.submitMessage("try again"));

    expect(second.some((event) => event.type === "message-complete" && event.text.includes("fallback-ok"))).toBe(false);
    expect(calls).toBe(4);
  });

  it("/status shows provider circuit cooldown state", async () => {
    process.env.CHATBI_PROVIDER_COOLDOWN_MS = "60000";
    getGlobalProviderCircuitBreaker().markStuck(provider, "assistant output exceeded 8 bytes");

    const engine = createQueryEngine({
      currentProvider: provider,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
    });

    await collect(engine.submitMessage("/status"));

    const reply = engine.getMessages().at(-1)?.text ?? "";
    expect(reply).toContain("provider-circuit:");
    expect(reply).toContain("- OpenAI: running=0 stuck=1 transient=0 cooldown=");
    expect(reply).toContain("reason=assistant output exceeded 8 bytes");
  });

  it("wraps oversized assistant text as an artifact summary", () => {
    const root = mkdtempSync(path.join(tmpdir(), "codeclaw-artifact-"));
    try {
      const envelope = wrapLargeTextArtifact("abcdef0123456789", "session-1", "msg-1", {
        artifactsRoot: root,
        maxBytes: 8,
        label: "assistant response",
      });

      expect(envelope.artifactPath).toBeDefined();
      expect(envelope.summary).toContain("TRUNCATED assistant response");
      expect(envelope.summary).toContain("read_artifact");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wraps oversized QueryEngine final answers into artifact summaries", async () => {
    process.env.CHATBI_MAX_TURN_BYTES = "10000";
    process.env.CHATBI_TERMINAL_RENDER_BYTES = "64";
    const root = mkdtempSync(path.join(tmpdir(), "codeclaw-final-artifact-"));
    const longAnswer = `START-${"x".repeat(400)}-END`;
    try {
      const fetchImpl = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: {"choices":[{"delta":{"content":${JSON.stringify(longAnswer)}}}]}\n`
                )
              );
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
              controller.close();
            },
          })
        );

      const engine = createQueryEngine({
        currentProvider: provider,
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: process.cwd(),
        artifactsRoot: root,
        fetchImpl: fetchImpl as typeof fetch,
      });

      const events = await collect(engine.submitMessage("long final answer"));
      const complete = [...events].reverse().find((event) => event.type === "message-complete") as
        | { text: string }
        | undefined;
      const match = complete?.text.match(/full output saved to ([^;]+);/);

      expect(complete?.text).toContain("TRUNCATED assistant response");
      expect(match?.[1]).toBeDefined();
      expect(match?.[1].startsWith(root)).toBe(true);
      expect(existsSync(match![1])).toBe(true);
      expect(readFileSync(match![1], "utf8")).toBe(longAnswer);
      expect(engine.getMessages().at(-1)?.text).toBe(complete?.text);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
