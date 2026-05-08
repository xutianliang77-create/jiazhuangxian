import { useEffect } from "react";
import { useSessionsStore } from "@/store/sessions";
import { useMessagesStore } from "@/store/messages";
import { createSession, deleteSession, listSessions } from "@/api/endpoints";

interface Props {
  onError(msg: string | null): void;
}

export default function SessionsList({ onError }: Props) {
  const { list, activeId, setList, setActive, remove } = useSessionsStore();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await listSessions();
        if (cancelled) return;
        setList(r.sessions);
        if (!activeId && r.sessions[0]) {
          const safeSession = r.sessions.find((session) => !session.contextExceeded);
          setActive((safeSession ?? r.sessions[0]).sessionId);
        }
      } catch (err) {
        if (!cancelled) onError(`session 列表读取失败：${(err as Error).message}`);
      }
    }
    refresh();
    const id = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeId, setList, setActive, onError]);

  async function handleNew() {
    try {
      const meta = await createSession();
      useSessionsStore.getState().upsert(meta);
      useMessagesStore.getState().hydrate(meta.sessionId, []);
      setActive(meta.sessionId);
    } catch (err) {
      onError(`新建 session 失败：${(err as Error).message}`);
    }
  }

  async function handleArchive(sessionId: string, title?: string) {
    const label = title || sessionId.replace(/^web-/, "").slice(0, 10);
    const ok = window.confirm(`归档会话「${label}」？归档后会从左侧列表隐藏。`);
    if (!ok) return;
    try {
      await deleteSession(sessionId);
      remove(sessionId);
      useMessagesStore.getState().clear(sessionId);
      onError(null);
    } catch (err) {
      onError(`归档 session 失败：${(err as Error).message}`);
    }
  }

  return (
    <aside className="flex flex-col gap-2 min-h-0">
      <button
        onClick={handleNew}
        className="px-3 py-1.5 text-sm border border-border rounded text-left bg-bg/60 hover:bg-bg"
      >
        + 新会话
      </button>
      <ul className="overflow-y-auto flex flex-col gap-1.5 min-h-0">
        {list.map((s) => {
          const active = s.sessionId === activeId;
          return (
            <li key={s.sessionId}>
              <div
                className={
                  "group relative w-full text-left text-sm border rounded " +
                  (active
                    ? "border-accent bg-accent/10"
                    : "border-border bg-bg hover:bg-bg/80")
                }
              >
                <button
                  onClick={() => setActive(s.sessionId)}
                  className="w-full text-left px-2 py-1.5 pr-14"
                >
                  <div className="text-xs font-medium truncate">
                    {s.title || "未命名会话"}
                  </div>
                  <div className="text-xs text-muted">
                    <span className="font-mono">{s.sessionId.replace(/^web-/, "").slice(0, 10)}</span>
                    {" · "}
                    {new Date(s.lastSeenAt ?? s.createdAt).toLocaleTimeString()}
                    {s.messageCount ? ` · ${s.messageCount} 条` : ""}
                  </div>
                  {s.contextExceeded && (
                    <div className="mt-2 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
                      <span className="font-semibold">上下文超限 · 已保护性暂停</span>
                      <span className="block text-muted">建议新会话或先 /compact</span>
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  title="归档会话"
                  aria-label={`归档会话 ${s.title || s.sessionId}`}
                  onClick={() => void handleArchive(s.sessionId, s.title)}
                  className="absolute right-1.5 top-1.5 rounded border border-border bg-bg/80 px-1.5 py-0.5 text-[11px] text-muted opacity-100 hover:border-danger/50 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
                >
                  归档
                </button>
              </div>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="text-xs text-muted px-2">无会话；点 + 新会话</li>
        )}
      </ul>
    </aside>
  );
}
