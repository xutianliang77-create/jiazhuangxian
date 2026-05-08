import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionStore } from "../../../../src/channels/web/sessionStore";
import type { QueryEngine } from "../../../../src/agent/types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-session-store-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("disables cross-session memory recall for web engines by default", () => {
    const engineFactory = vi.fn(
      () =>
        ({
          getMessages: () => [],
        }) as unknown as QueryEngine
    );
    const store = new SessionStore({
      engineDefaults: {
        currentProvider: null,
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: "ws-1",
        sessionsDir: path.join(tmpRoot, "sessions"),
      },
      engineFactory,
    });

    store.create("web-user");

    expect(engineFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "http",
        disableSessionMemoryRecall: true,
      })
    );
  });

  it("falls back to active engine messages when no persisted web transcript exists", () => {
    const store = new SessionStore({
      engineDefaults: {
        currentProvider: null,
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: "ws-1",
        sessionsDir: path.join(tmpRoot, "sessions"),
      },
      engineFactory: () =>
        ({
          getMessages: () => [
            {
              id: "ready",
              role: "assistant",
              text: "CodeClaw is ready. No provider is configured yet.",
              source: "local",
            },
            { id: "u-1", role: "user", text: "生成食品销量分析报表", source: "user" },
            { id: "a-1", role: "assistant", text: "报表已生成。", source: "model" },
          ],
        }) as unknown as QueryEngine,
    });

    const session = store.create("web-user");
    expect(store.readMessages(session.sessionId, "web-user")).toMatchObject([
      { id: "u-1", role: "user", text: "生成食品销量分析报表" },
      { id: "a-1", role: "assistant", text: "报表已生成。" },
    ]);
  });

  it("sanitizes persisted assistant thinking before returning web history", async () => {
    const store = new SessionStore({
      engineDefaults: {
        currentProvider: null,
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: "ws-1",
        sessionsDir: path.join(tmpRoot, "sessions"),
      },
      engineFactory: () =>
        ({
          getMessages: () => [],
          async *submitMessage() {
            yield {
              type: "message-complete",
              messageId: "a-1",
              text: "<think>private reasoning</think>最终答案",
            };
          },
        }) as unknown as QueryEngine,
    });

    const session = store.create("web-user");
    await store.runSubmit(session.sessionId, "web-user", "hi");

    expect(store.readMessages(session.sessionId, "web-user")).toMatchObject([
      { id: "a-1", role: "assistant", text: "最终答案" },
    ]);
  });

  it("sanitizes streaming assistant deltas before emitting web events", async () => {
    const store = new SessionStore({
      engineDefaults: {
        currentProvider: null,
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: "ws-1",
        sessionsDir: path.join(tmpRoot, "sessions"),
      },
      engineFactory: () =>
        ({
          getMessages: () => [],
          async *submitMessage() {
            yield { type: "message-start", messageId: "a-1", role: "assistant" };
            yield { type: "message-delta", messageId: "a-1", delta: "<unused94>thought private" };
            yield { type: "message-delta", messageId: "a-1", delta: " reasoning<unused95>最终" };
            yield { type: "message-delta", messageId: "a-1", delta: "答案" };
            yield {
              type: "message-complete",
              messageId: "a-1",
              text: "<unused94>thought private reasoning<unused95>最终答案",
            };
          },
        }) as unknown as QueryEngine,
    });

    const session = store.create("web-user");
    const serverSession = store.get(session.sessionId, "web-user");
    const events: unknown[] = [];
    serverSession?.emitter.on("event", (event) => events.push(event));

    await store.runSubmit(session.sessionId, "web-user", "hi");

    expect(events).toEqual([
      { type: "message-start", messageId: "a-1", role: "assistant" },
      { type: "message-delta", messageId: "a-1", delta: "最终" },
      { type: "message-delta", messageId: "a-1", delta: "答案" },
      { type: "message-complete", messageId: "a-1", text: "最终答案" },
    ]);
  });
});
