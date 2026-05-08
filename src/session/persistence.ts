import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ChannelType } from "../channels/channelAdapter";

export interface PersistedSessionMeta {
  sessionId: string;
  channel: ChannelType;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  state: "active" | "archived";
  workspace?: string;
  title?: string;
  messageCount?: number;
}

export interface PersistedWebMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "error" | "tool";
  text: string;
  ts: number;
  tool?: { name: string; status: "running" | "completed" | "blocked" | "failed" | "pending"; detail?: string };
}

interface SessionIndexFile {
  version: 1;
  sessions: PersistedSessionMeta[];
}

const INDEX_FILE = "session-index.json";

export function sessionIndexPath(sessionsDir: string): string {
  return path.join(sessionsDir, INDEX_FILE);
}

export function listPersistedSessions(sessionsDir?: string): PersistedSessionMeta[] {
  if (!sessionsDir) return [];
  const file = sessionIndexPath(sessionsDir);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<SessionIndexFile>;
    if (!Array.isArray(raw.sessions)) return [];
    return raw.sessions.filter(isSessionMeta).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  } catch {
    return [];
  }
}

export function findLastPersistedSession(
  sessionsDir: string | undefined,
  query: { channel: ChannelType; userId: string; workspace?: string }
): PersistedSessionMeta | null {
  return (
    listPersistedSessions(sessionsDir).find(
      (session) =>
        session.state === "active" &&
        session.channel === query.channel &&
        session.userId === query.userId &&
        (!query.workspace || session.workspace === query.workspace)
    ) ?? null
  );
}

export function upsertPersistedSession(
  sessionsDir: string | undefined,
  input: {
    sessionId: string;
    channel: ChannelType;
    userId: string;
    workspace?: string;
    title?: string;
    messageCountDelta?: number;
    now?: number;
  }
): PersistedSessionMeta | null {
  if (!sessionsDir) return null;
  const now = input.now ?? Date.now();
  const sessions = listPersistedSessions(sessionsDir);
  const existing = sessions.find((session) => session.sessionId === input.sessionId);
  const next: PersistedSessionMeta = existing
    ? {
        ...existing,
        channel: input.channel,
        userId: input.userId,
        lastSeenAt: now,
        state: "active",
        title: existing.title ?? input.title,
        messageCount: (existing.messageCount ?? 0) + (input.messageCountDelta ?? 0),
        ...(input.workspace ? { workspace: input.workspace } : {}),
      }
    : {
        sessionId: input.sessionId,
        channel: input.channel,
        userId: input.userId,
        createdAt: now,
        lastSeenAt: now,
        state: "active",
        ...(input.title ? { title: input.title } : {}),
        ...(input.messageCountDelta ? { messageCount: input.messageCountDelta } : {}),
        ...(input.workspace ? { workspace: input.workspace } : {}),
      };
  writeIndex(sessionsDir, [next, ...sessions.filter((session) => session.sessionId !== input.sessionId)]);
  return next;
}

export function appendWebTranscriptMessage(
  sessionsDir: string | undefined,
  message: PersistedWebMessage,
  meta: { channel: ChannelType; userId: string; workspace?: string }
): void {
  if (!sessionsDir) return;
  const dir = sessionStorageDir(sessionsDir, message.sessionId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "web-transcript.jsonl"), `${JSON.stringify(message)}\n`, "utf8");
  upsertPersistedSession(sessionsDir, {
    sessionId: message.sessionId,
    channel: meta.channel,
    userId: meta.userId,
    workspace: meta.workspace,
    title: message.role === "user" ? titleFromText(message.text) : undefined,
    messageCountDelta: 1,
    now: message.ts,
  });
}

export function readWebTranscriptMessages(
  sessionsDir: string | undefined,
  sessionId: string,
  limit = 200
): PersistedWebMessage[] {
  if (!sessionsDir) return [];
  const file = path.join(sessionStorageDir(sessionsDir, sessionId), "web-transcript.jsonl");
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isPersistedWebMessage)
      .slice(-limit);
  } catch {
    return [];
  }
}

export function archivePersistedSession(sessionsDir: string | undefined, sessionId: string): void {
  if (!sessionsDir) return;
  const now = Date.now();
  writeIndex(
    sessionsDir,
    listPersistedSessions(sessionsDir).map((session) =>
      session.sessionId === sessionId ? { ...session, state: "archived", lastSeenAt: now } : session
    )
  );
}

function writeIndex(sessionsDir: string, sessions: PersistedSessionMeta[]): void {
  mkdirSync(sessionsDir, { recursive: true });
  const file = sessionIndexPath(sessionsDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body: SessionIndexFile = {
    version: 1,
    sessions: sessions.sort((a, b) => b.lastSeenAt - a.lastSeenAt),
  };
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function isSessionMeta(value: unknown): value is PersistedSessionMeta {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    (record.channel === "cli" ||
      record.channel === "http" ||
      record.channel === "wechat" ||
      record.channel === "sdk" ||
      record.channel === "mcp") &&
    typeof record.userId === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.lastSeenAt === "number" &&
    (record.state === "active" || record.state === "archived")
  );
}

function isPersistedWebMessage(value: unknown): value is PersistedWebMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.sessionId === "string" &&
    (record.role === "user" ||
      record.role === "assistant" ||
      record.role === "system" ||
      record.role === "error" ||
      record.role === "tool") &&
    typeof record.text === "string" &&
    typeof record.ts === "number"
  );
}

function sessionStorageDir(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, safeSessionSegment(sessionId));
}

function safeSessionSegment(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function titleFromText(text: string): string | undefined {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return undefined;
  return oneLine.length > 42 ? `${oneLine.slice(0, 42)}...` : oneLine;
}
