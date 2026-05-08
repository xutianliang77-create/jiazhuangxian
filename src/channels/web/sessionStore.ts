/**
 * Web Channel · Server-side session 状态
 *
 * 把 QueryEngine 实例 + 待派发事件 emitter 装在一起。
 * POST /messages 进来异步驱动 submitMessage()；GET /stream（SSE）监听 emitter
 * 把每个 EngineEvent 当 SSE 帧推给客户端。
 *
 * 设计：
 *   - 单 sessionId 单 QueryEngine 实例（in-memory Map）
 *   - 同 sessionId 多次 stream 连接 → 都监听同一 emitter（broadcast）
 *   - destroy 时移除实例并 emit 'close' 让所有 SSE 客户端关闭
 *   - vitest 环境下 dataDb 仍由 QueryEngine 自己处理（不在此层管）
 */

import { EventEmitter } from "node:events";
import { ulid } from "ulid";

import type { EngineEvent, EngineMessage, QueryEngine, QueryEngineOptions } from "../../agent/types";
import { checkTokenBudget } from "../../agent/tokenBudget";
import { shouldShowThinking, stripThinking } from "../../lib/stripThinking";
import { readL1TranscriptFile, type L1TranscriptMessage } from "../../storage/repositories";
import {
  appendWebTranscriptMessage,
  archivePersistedSession,
  listPersistedSessions,
  readWebTranscriptMessages,
  upsertPersistedSession,
  type PersistedWebMessage,
  type PersistedSessionMeta,
} from "../../session/persistence";

export interface ServerSessionMeta {
  sessionId: string;
  userId: string;
  channel: "http";
  createdAt: number;
  lastSeenAt: number;
  workspace?: string;
  title?: string;
  messageCount?: number;
  estimatedTokens?: number;
  contextWindow?: number;
  contextExceeded?: boolean;
}

interface InternalServerSession {
  meta: ServerSessionMeta;
  engine: QueryEngine;
  emitter: EventEmitter;
}

export type EngineFactory = (options: QueryEngineOptions) => QueryEngine;

export interface SessionStoreOptions {
  /** QueryEngine 工厂；测试可注入 mock */
  engineFactory: EngineFactory;
  /** QueryEngine 默认参数（每次 createSession 用此基础 + per-call 覆盖）*/
  engineDefaults: Omit<QueryEngineOptions, "channel" | "userId">;
}

export class SessionStore {
  private readonly map = new Map<string, InternalServerSession>();
  private readonly opts: SessionStoreOptions;
  private readonly sessionsDir: string | undefined;

  constructor(opts: SessionStoreOptions) {
    this.opts = opts;
    this.sessionsDir = opts.engineDefaults.sessionsDir;
  }

  /** 新建 session 实例。userId 来自鉴权层；sessionId 由内部 ULID 生成。*/
  create(userId: string): ServerSessionMeta {
    const sessionId = `web-${ulid()}`;
    const now = Date.now();
    const meta: ServerSessionMeta = {
      sessionId,
      userId,
      channel: "http",
      createdAt: now,
      lastSeenAt: now,
      ...(this.opts.engineDefaults.workspace ? { workspace: this.opts.engineDefaults.workspace } : {}),
      messageCount: 0,
    };
    upsertPersistedSession(this.sessionsDir, {
      sessionId,
      channel: "http",
      userId,
      workspace: this.opts.engineDefaults.workspace,
      now,
    });
    this.map.set(sessionId, this.instantiate(meta));
    return meta;
  }

  /** 拿 session（含 emitter）；不存在或 userId 不匹配返回 null（隔离） */
  get(sessionId: string, userId: string): InternalServerSession | null {
    let s = this.map.get(sessionId);
    if (!s) {
      const persisted = this.findPersistedSession(sessionId, userId);
      if (!persisted) return null;
      s = this.instantiate(toServerMeta(persisted));
      this.map.set(sessionId, s);
    }
    if (!s) return null;
    if (s.meta.userId !== userId) return null;
    this.touch(s);
    return s;
  }

  list(userId: string): ServerSessionMeta[] {
    const byId = new Map<string, ServerSessionMeta>();
    for (const session of listPersistedSessions(this.sessionsDir)) {
      if (session.state !== "active" || session.channel !== "http" || session.userId !== userId) continue;
      byId.set(session.sessionId, this.withContextBudget(toServerMeta(session)));
    }
    for (const s of this.map.values()) {
      if (s.meta.userId === userId) byId.set(s.meta.sessionId, this.withContextBudget(s.meta));
    }
    return [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  readMessages(sessionId: string, userId: string, limit = 200): PersistedWebMessage[] | null {
    if (!this.findPersistedSession(sessionId, userId) && !this.map.has(sessionId)) return null;
    const s = this.map.get(sessionId);
    if (s && s.meta.userId !== userId) return null;
    const l1Messages = readL1TranscriptFile(this.sessionsDir, sessionId, { limit }).map((message) =>
      l1TranscriptToWebMessage(message, sessionId)
    );
    if (l1Messages.length > 0) return sanitizeWebMessagesForDisplay(l1Messages);
    const persisted = readWebTranscriptMessages(this.sessionsDir, sessionId, limit);
    if (persisted.length > 0 || !s) return sanitizeWebMessagesForDisplay(persisted);
    const visibleMessages =
      (s.engine as QueryEngine & { getVisibleMessages?: () => EngineMessage[] }).getVisibleMessages?.() ??
      s.engine.getMessages();
    return sanitizeWebMessagesForDisplay(engineMessagesToWebMessages(visibleMessages, sessionId, limit));
  }

  appendUserMessage(sessionId: string, userId: string, text: string): void {
    const s = this.get(sessionId, userId);
    if (!s) return;
    this.persistMessage(s, {
      id: `user-${Date.now()}`,
      sessionId,
      role: "user",
      text,
      ts: Date.now(),
    });
  }

  destroy(sessionId: string, userId: string): boolean {
    const s = this.map.get(sessionId);
    const persisted = this.findPersistedSession(sessionId, userId);
    if (s) {
      if (s.meta.userId !== userId) return false;
      s.emitter.emit("close");
      s.emitter.removeAllListeners();
      this.map.delete(sessionId);
    }
    if (persisted) archivePersistedSession(this.sessionsDir, sessionId);
    return !!s || !!persisted;
  }

  /**
   * 异步驱动 engine.submitMessage 把 events 喂给 emitter；不抛任何异常。
   * 调用方（POST /messages handler）通常 fire-and-forget 这个 promise。
   * channelSpecific 可携带 image 等附件元数据（透给 submitMessage options）。
   */
  async runSubmit(
    sessionId: string,
    userId: string,
    input: string,
    channelSpecific?: Record<string, unknown>
  ): Promise<void> {
    const s = this.get(sessionId, userId);
    if (!s) return;
    const streamState = new Map<string, { raw: string; visible: string }>();
    try {
      for await (const ev of s.engine.submitMessage(input, { channelSpecific })) {
        const sanitized = sanitizeEngineEventForWeb(ev, streamState);
        if (!sanitized) continue;
        this.persistEngineEvent(s, sanitized);
        s.emitter.emit("event", sanitized satisfies EngineEvent);
      }
    } catch (err) {
      // submitMessage 内部异常时给前端一条可见的错误消息
      s.emitter.emit("event", {
        type: "message-complete",
        messageId: `err-${Date.now()}`,
        text: `[server error] ${err instanceof Error ? err.message : String(err)}`,
      } satisfies EngineEvent);
    }
  }

  size(): number {
    return this.map.size;
  }

  /** 给 SIGHUP / 设置热重载用：遍历所有 active engines（不暴露 emitter） */
  forEachEngine(fn: (engine: QueryEngine, sessionId: string) => void): void {
    for (const [sessionId, s] of this.map.entries()) {
      try {
        fn(s.engine, sessionId);
      } catch {
        // 单 engine 处理失败不阻塞其它
      }
    }
  }

  /**
   * 向所有 active session 广播一条自定义事件（cron-result 等）。
   * 客户端在 EventSource 上能直接收到 data: {...} 帧。
   */
  broadcastEvent(event: { type: string; [k: string]: unknown }): void {
    for (const s of this.map.values()) {
      try {
        s.emitter.emit("event", event);
      } catch {
        // 单 session emitter 失败不阻塞其它
      }
    }
  }

  private instantiate(meta: ServerSessionMeta): InternalServerSession {
    return {
      meta,
      engine: this.opts.engineFactory({
        ...this.opts.engineDefaults,
        disableSessionMemoryRecall: this.opts.engineDefaults.disableSessionMemoryRecall ?? true,
        channel: "http",
        userId: meta.userId,
        sessionId: meta.sessionId,
      }),
      emitter: new EventEmitter(),
    };
  }

  private touch(session: InternalServerSession): void {
    const now = Date.now();
    session.meta.lastSeenAt = now;
    upsertPersistedSession(this.sessionsDir, {
      sessionId: session.meta.sessionId,
      channel: "http",
      userId: session.meta.userId,
      workspace: session.meta.workspace ?? this.opts.engineDefaults.workspace,
      now,
    });
  }

  private findPersistedSession(sessionId: string, userId: string): PersistedSessionMeta | null {
    return (
      listPersistedSessions(this.sessionsDir).find(
        (session) =>
          session.sessionId === sessionId &&
          session.userId === userId &&
          session.channel === "http" &&
          session.state === "active"
      ) ?? null
    );
  }

  private withContextBudget(meta: ServerSessionMeta): ServerSessionMeta {
    const provider = this.opts.engineDefaults.currentProvider;
    if (!provider) return meta;
    const transcript = readL1TranscriptFile(this.sessionsDir, meta.sessionId);
    if (transcript.length === 0) return meta;
    const messages = transcript.map((message, index) => ({
      id: message.messageId || `transcript-${index}`,
      role: normalizeRole(message.role),
      text: message.body,
      ...(message.source ? { source: message.source } : {}),
    })) satisfies EngineMessage[];
    const budget = checkTokenBudget(messages, provider);
    return {
      ...meta,
      estimatedTokens: budget.estimatedTokens,
      contextWindow: budget.contextWindow,
      contextExceeded: budget.shouldHardCut,
    };
  }

  private persistEngineEvent(session: InternalServerSession, ev: EngineEvent): void {
    const record = ev as unknown as Record<string, unknown>;
    if (record.type === "message-complete" && typeof record.messageId === "string" && typeof record.text === "string") {
      this.persistMessage(session, {
        id: record.messageId,
        sessionId: session.meta.sessionId,
        role: "assistant",
        text: record.text,
        ts: Date.now(),
      });
      return;
    }
    if (record.type === "tool-end" && typeof record.toolName === "string") {
      this.persistMessage(session, {
        id: `tool-${Date.now()}`,
        sessionId: session.meta.sessionId,
        role: "tool",
        text: "",
        ts: Date.now(),
        tool: {
          name: record.toolName,
          status: isToolStatus(record.status) ? record.status : "completed",
          ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
        },
      });
    }
  }

  private persistMessage(session: InternalServerSession, message: PersistedWebMessage): void {
    appendWebTranscriptMessage(this.sessionsDir, message, {
      channel: "http",
      userId: session.meta.userId,
      workspace: session.meta.workspace ?? this.opts.engineDefaults.workspace,
    });
    session.meta.lastSeenAt = message.ts;
    session.meta.messageCount = (session.meta.messageCount ?? 0) + 1;
    if (!session.meta.title && message.role === "user") {
      const title = message.text.replace(/\s+/g, " ").trim();
      if (title) session.meta.title = title.length > 42 ? `${title.slice(0, 42)}...` : title;
    }
  }
}

function normalizeRole(role: string): EngineMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "assistant";
}

function toServerMeta(session: PersistedSessionMeta): ServerSessionMeta {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    channel: "http",
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    ...(session.workspace ? { workspace: session.workspace } : {}),
    ...(session.title ? { title: session.title } : {}),
    ...(session.messageCount === undefined ? {} : { messageCount: session.messageCount }),
  };
}

function isToolStatus(value: unknown): value is NonNullable<PersistedWebMessage["tool"]>["status"] {
  return value === "running" || value === "completed" || value === "blocked" || value === "failed" || value === "pending";
}

function sanitizeWebMessagesForDisplay(messages: PersistedWebMessage[]): PersistedWebMessage[] {
  if (shouldShowThinking()) return messages;
  return messages.map((message) =>
    message.role === "assistant" ? { ...message, text: stripThinking(message.text) } : message
  );
}

function sanitizeEngineEventForWeb(
  ev: EngineEvent,
  streamState: Map<string, { raw: string; visible: string }>
): EngineEvent | null {
  if (shouldShowThinking()) return ev;
  if (ev.type === "message-start") {
    streamState.set(ev.messageId, { raw: "", visible: "" });
    return ev;
  }
  if (ev.type === "message-delta") {
    const state = streamState.get(ev.messageId) ?? { raw: "", visible: "" };
    state.raw += ev.delta;
    const nextVisible = stripThinking(state.raw);
    const visibleDelta = nextVisible.slice(state.visible.length);
    streamState.set(ev.messageId, { raw: state.raw, visible: nextVisible });
    if (!visibleDelta) return null;
    return { ...ev, delta: visibleDelta };
  }
  if (ev.type === "message-complete") {
    streamState.delete(ev.messageId);
    return { ...ev, text: stripThinking(ev.text) };
  }
  return ev;
}

function engineMessagesToWebMessages(
  messages: EngineMessage[],
  sessionId: string,
  limit: number
): PersistedWebMessage[] {
  return messages
    .filter((message) => !message.hiddenFromUi)
    .filter((message) => !(message.source === "local" && message.text.startsWith("CodeClaw is ready.")))
    .map((message, index) => {
      const base = {
        id: message.id || `engine-${index}`,
        sessionId,
        text: message.text,
        ts: Date.now() - Math.max(0, messages.length - index),
      };
      if (message.role === "tool") {
        return {
          ...base,
          role: "tool" as const,
          text: "",
          tool: {
            name: message.toolName ?? "tool",
            status: "completed" as const,
            detail: message.text,
          },
        };
      }
      return {
        ...base,
        role: message.role === "user" || message.role === "assistant" || message.role === "system" ? message.role : "system",
      };
    })
    .slice(-limit);
}

function l1TranscriptToWebMessage(message: L1TranscriptMessage, sessionId: string): PersistedWebMessage {
  return {
    id: message.messageId,
    sessionId,
    role: message.role,
    text: message.body,
    ts: message.createdAt,
    ...(message.role === "tool"
      ? { tool: { name: "tool", status: "completed" as const, detail: message.body }, text: "" }
      : {}),
  };
}
