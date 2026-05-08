import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  archivePersistedSession,
  appendWebTranscriptMessage,
  findLastPersistedSession,
  listPersistedSessions,
  readWebTranscriptMessages,
  upsertPersistedSession,
} from "../../../src/session/persistence";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-session-index-"));
  tempDirs.push(dir);
  return dir;
}

describe("session persistence", () => {
  it("keeps the newest active session per channel/user/workspace discoverable", () => {
    const dir = tempDir();
    upsertPersistedSession(dir, {
      sessionId: "session-old",
      channel: "cli",
      userId: "alice",
      workspace: "/repo",
      now: 100,
    });
    upsertPersistedSession(dir, {
      sessionId: "session-new",
      channel: "cli",
      userId: "alice",
      workspace: "/repo",
      now: 200,
    });
    upsertPersistedSession(dir, {
      sessionId: "session-web",
      channel: "http",
      userId: "alice",
      workspace: "/repo",
      now: 300,
    });

    expect(findLastPersistedSession(dir, { channel: "cli", userId: "alice", workspace: "/repo" })?.sessionId).toBe(
      "session-new"
    );
    expect(listPersistedSessions(dir).map((session) => session.sessionId)).toEqual([
      "session-web",
      "session-new",
      "session-old",
    ]);
  });

  it("archives sessions instead of deleting index history", () => {
    const dir = tempDir();
    upsertPersistedSession(dir, {
      sessionId: "session-1",
      channel: "http",
      userId: "web-user",
      now: 100,
    });

    archivePersistedSession(dir, "session-1");

    expect(findLastPersistedSession(dir, { channel: "http", userId: "web-user" })).toBeNull();
    expect(listPersistedSessions(dir)).toMatchObject([{ sessionId: "session-1", state: "archived" }]);
  });

  it("persists web transcript messages and derives a session title", () => {
    const dir = tempDir();

    appendWebTranscriptMessage(
      dir,
      {
        id: "m-1",
        sessionId: "web-1",
        role: "user",
        text: "生成食品销量分析报表",
        ts: 100,
      },
      { channel: "http", userId: "web-user", workspace: "/repo" }
    );
    appendWebTranscriptMessage(
      dir,
      {
        id: "m-2",
        sessionId: "web-1",
        role: "assistant",
        text: "报表已生成。",
        ts: 200,
      },
      { channel: "http", userId: "web-user", workspace: "/repo" }
    );

    expect(listPersistedSessions(dir)[0]).toMatchObject({
      sessionId: "web-1",
      title: "生成食品销量分析报表",
      messageCount: 2,
    });
    expect(readWebTranscriptMessages(dir, "web-1")).toMatchObject([
      { id: "m-1", role: "user" },
      { id: "m-2", role: "assistant" },
    ]);
  });
});
