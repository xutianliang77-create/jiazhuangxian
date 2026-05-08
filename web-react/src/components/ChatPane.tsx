/**
 * ChatPane · 虚拟滚动 + 流式 markdown + tool 折叠（B.4 完整版）
 *
 * - @tanstack/react-virtual 处理 N≥10K message 流畅
 * - SSE 流：message-start / message-delta / message-complete / tool-start / tool-end
 * - 自动滚到底部除非用户上滚（lastScrollFromBottom < 80px 才贴底）
 */

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSessionsStore } from "@/store/sessions";
import { useMessagesStore, type ChatMessage } from "@/store/messages";
import { useApprovalsStore } from "@/store/approvals";
import { useSubagentsStore } from "@/store/subagents";
import { useAuthStore } from "@/store/auth";
import { getSessionMessages, sendMessage } from "@/api/endpoints";
import type { MessageAttachment } from "@/api/endpoints";
import MessageBubble from "./MessageBubble";
import ApprovalCard from "./ApprovalCard";

interface Props {
  onError(msg: string | null): void;
}

const STICK_THRESHOLD_PX = 80;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DICOM_BYTES = 24 * 1024 * 1024;

// 稳定的空数组单例：避免 selector 每次返回新 [] 触发 zustand ref-equality 误判 + re-render 死循环（React #185）
const EMPTY_MSGS: ChatMessage[] = [];

interface PendingImageAttachment extends MessageAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
}

function isDicomFile(file: File): boolean {
  return file.type === "application/dicom" || /\.dcm$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function normalizeDicomDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;,]*;base64,/i, "data:application/dicom;base64,");
}

export default function ChatPane({ onError }: Props) {
  const { activeId } = useSessionsStore();
  const { token } = useAuthStore();
  const msgs = useMessagesStore((s) => (activeId ? s.bySession.get(activeId) ?? EMPTY_MSGS : EMPTY_MSGS));
  const approval = useApprovalsStore((s) => (activeId ? s.bySession.get(activeId) ?? null : null));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  const sseRef = useRef<EventSource | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);

  // 暴露 setInput 给 CommandPalette（B.9）
  useEffect(() => {
    window.codeclawComposer = {
      setInput: (text) => setInput(text),
      focus: () => inputRef.current?.focus(),
    };
    return () => {
      delete window.codeclawComposer;
    };
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: msgs.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80,
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  useEffect(() => {
    if (!activeId || msgs.length > 0) return;
    const sessionId = activeId;
    let cancelled = false;
    async function loadHistory() {
      try {
        const result = await getSessionMessages(sessionId);
        if (cancelled || result.messages.length === 0) return;
        useMessagesStore.getState().hydrate(
          sessionId,
          result.messages.map((message) => ({
            id: message.id,
            sessionId: message.sessionId,
            role: message.role,
            text: message.text,
            ts: message.ts,
            ...(message.tool ? { tool: message.tool } : {}),
          }))
        );
      } catch (err) {
        if (!cancelled) onError(`会话历史读取失败：${(err as Error).message}`);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [activeId, msgs.length, onError]);

  // 自动贴底：用户上滚 80px+ 暂停贴底；回到底则恢复
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = fromBottom < STICK_THRESHOLD_PX;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current && msgs.length > 0) {
      rowVirtualizer.scrollToIndex(msgs.length - 1, { align: "end" });
    }
    // rowVirtualizer 每次 render 都是新引用；放进 deps 会和 scrollToIndex 触发的内部
    // setState 形成死循环（React #185 max update depth）。仅以 msgs.length 为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.length]);

  // SSE 订阅：activeId 变化时重连
  useEffect(() => {
    if (!activeId || !token) return;
    sseRef.current?.close();
    // EventSource 不支持自定义 header → 用 query token；后端阶段 B 后续接受 ?token
    // 阶段 A 后端仍读 Authorization → 先尝试，401 时报错给前端
    const url = `/v1/web/stream?sessionId=${encodeURIComponent(activeId)}&token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    sseRef.current = es;
    const store = useMessagesStore.getState();

    let currentStreamingId: string | null = null;

    es.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        switch (data?.type) {
          case "message-start":
            currentStreamingId = data.messageId;
            store.startAssistant(activeId, data.messageId);
            break;
          case "message-delta":
            if (currentStreamingId) store.appendDelta(activeId, currentStreamingId, data.delta);
            break;
          case "message-complete":
            store.completeAssistant(activeId, data.messageId, data.text);
            currentStreamingId = null;
            break;
          case "tool-start":
            store.appendTool(activeId, data.toolName, "running", data.detail);
            break;
          case "tool-end":
            store.appendTool(activeId, data.toolName, data.status, data.detail);
            break;
          case "approval-request":
            useApprovalsStore.getState().set(activeId, {
              id: data.approvalId,
              toolName: data.toolName,
              detail: data.detail ?? "",
              reason: data.reason ?? "",
              queuePosition: data.queuePosition ?? 1,
              totalPending: data.totalPending ?? 1,
            });
            break;
          case "approval-cleared":
            useApprovalsStore.getState().clear(activeId);
            break;
          case "subagent-start":
            useSubagentsStore.getState().start(activeId, {
              id: data.id,
              role: data.role,
              prompt: data.prompt,
              status: "running",
              startedAt: data.startedAt,
            });
            break;
          case "subagent-end":
            useSubagentsStore.getState().end(activeId, data.id, {
              status: data.status,
              toolCallCount: data.toolCallCount,
              durationMs: data.durationMs,
              finishedAt: Date.now(),
              error: data.error,
              resultPreview: data.resultPreview,
            });
            break;
          case "cron-result": {
            // 阶段 🅑 cron --notify=web：把任务结果作为系统消息塞到当前 chat 末尾
            const taskName = (data.task as { name?: string })?.name ?? "?";
            const status = (data.run as { status?: string })?.status ?? "?";
            const duration =
              ((data.run as { endedAt?: number; startedAt?: number })?.endedAt ?? 0) -
              ((data.run as { endedAt?: number; startedAt?: number })?.startedAt ?? 0);
            const output = (data.run as { output?: string })?.output ?? "";
            const text = `[Cron · ${taskName} · ${status} · ${duration}ms]\n${output.slice(0, 1024)}`;
            store.appendSystem(activeId, text);
            break;
          }
          default:
            // phase / 其它子事件先不渲染
            break;
        }
      } catch {
        // 心跳 / 非 JSON 行忽略
      }
    });
    es.addEventListener("error", () => {
      // 401（最常见，token 走 query 时后端尚未支持）；阶段 B 后端补丁后消失
      onError(
        "SSE 连接出错（如 401，需后端接受 ?token query；当前 build 仍读 Authorization）"
      );
    });
    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [activeId, token, onError]);

  async function addImageFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const available = Math.max(0, MAX_IMAGE_ATTACHMENTS - pendingImages.length);
    if (available === 0) {
      onError(`最多一次上传 ${MAX_IMAGE_ATTACHMENTS} 张影像图片。`);
      return;
    }
    const accepted: PendingImageAttachment[] = [];
    for (const file of incoming.slice(0, available)) {
      if (isDicomFile(file)) {
        if (file.size > MAX_DICOM_BYTES) {
          onError(`DICOM 文件过大：${file.name}，单个上限 24MB。`);
          continue;
        }
        const dataUrl = normalizeDicomDataUrl(await readFileAsDataUrl(file));
        accepted.push({
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          kind: "dicom",
          dataUrl,
          fileName: file.name,
          mimeType: "application/dicom",
          sizeBytes: file.size,
        });
        continue;
      }
      if (!file.type.startsWith("image/")) {
        onError(`已跳过非图片文件：${file.name}`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        onError(`图片过大：${file.name}，单张上限 5MB。`);
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      accepted.push({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "image",
        dataUrl,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
    }
    if (accepted.length > 0) {
      setPendingImages((current) => [...current, ...accepted].slice(0, MAX_IMAGE_ATTACHMENTS));
      onError(null);
    }
  }

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) void addImageFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (busy) return;
    void addImageFiles(e.dataTransfer.files);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!activeId || busy) return;
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    const prompt = text || "请用中文解读这张放射科影像。";
    const dicomCount = pendingImages.filter((item) => item.kind === "dicom").length;
    const imageCount = pendingImages.length - dicomCount;
    const attachSummary = [
      imageCount > 0 ? `${imageCount} 张影像图片` : "",
      dicomCount > 0 ? `${dicomCount} 个 DICOM 文件` : "",
    ].filter(Boolean).join("，");
    const displayText =
      pendingImages.length > 0 ? `${prompt}\n\n[已附加 ${attachSummary}]` : prompt;
    const attachments = pendingImages.map(({ id: _id, sizeBytes: _sizeBytes, ...attachment }) => attachment);
    useMessagesStore.getState().appendUser(activeId, displayText);
    setInput("");
    setBusy(true);
    try {
      await sendMessage(activeId, prompt, attachments);
      setPendingImages([]);
    } catch (err) {
      useMessagesStore.getState().appendError(activeId, `[发送失败] ${(err as Error).message}`);
      onError(`发送失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!activeId) {
    return <div className="p-6 text-muted text-sm">请在左侧选择或新建一个 session。</div>;
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {approval && activeId && (
        <ApprovalCard sessionId={activeId} approval={approval} onError={onError} />
      )}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const m = msgs[vi.index];
            return (
              <div
                key={m.id}
                ref={rowVirtualizer.measureElement}
                data-index={vi.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vi.start}px)`,
                  paddingBottom: 8,
                }}
              >
                <MessageBubble msg={m} />
              </div>
            );
          })}
        </div>
        {msgs.length === 0 && (
          <div className="text-muted text-sm">输入消息开始（含 markdown / 代码块 / 流式光标）。</div>
        )}
      </div>
      <form onSubmit={submit} className="border-t border-border p-3 space-y-2">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingImages.map((image) => (
              <div key={image.id} className="flex items-center gap-2 rounded border border-border bg-bg/60 px-2 py-1 text-xs">
                {image.kind === "dicom" ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-bg-subtle font-semibold text-muted">
                    DCM
                  </span>
                ) : (
                  <img src={image.dataUrl} alt={image.fileName} className="h-10 w-10 rounded object-cover" />
                )}
                <span className="max-w-40 truncate">{image.fileName}</span>
                <button
                  type="button"
                  className="text-muted hover:text-danger"
                  onClick={() => setPendingImages((current) => current.filter((item) => item.id !== image.id))}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.dcm,application/dicom"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
          <button
            type="button"
            disabled={busy}
            className="px-3 py-2 bg-bg border border-border rounded disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
          >
            上传影像
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder="输入消息，或上传 PNG/JPG 影像截图（Enter 发送 · Shift+Enter 换行）"
            className="flex-1 px-3 py-2 bg-bg border border-border rounded resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e as unknown as FormEvent);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || (!input.trim() && pendingImages.length === 0)}
            className="px-4 py-2 bg-accent text-white rounded disabled:opacity-50"
          >
            {busy ? "..." : "发送"}
          </button>
        </div>
      </form>
    </div>
  );
}
