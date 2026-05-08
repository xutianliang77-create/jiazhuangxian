import { useEffect, useState } from "react";
import {
  cancelTeamRun,
  getTeamRuns,
  previewTeamClaimWrite,
  retryTeamRun,
  writeTeamClaim,
  type TeamRunSnapshot,
  type TeamWritePreview,
} from "@/api/endpoints";

interface Props {
  sessionId: string | null;
  onError(msg: string | null): void;
}

const STATUS_CLASS: Record<string, string> = {
  completed: "border-ok",
  blocked: "border-warning",
  failed: "border-danger",
  running: "border-accent",
};

export default function TeamPanel({ sessionId, onError }: Props) {
  const [runs, setRuns] = useState<TeamRunSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [previewingClaimId, setPreviewingClaimId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;

  async function refresh() {
    if (!sessionId) return;
    try {
      const r = await getTeamRuns(sessionId);
      setRuns(r.runs);
      setNote(r.note ?? null);
      setSelectedId((current) => current && r.runs.some((run) => run.id === current) ? current : r.runs[0]?.id ?? null);
    } catch (err) {
      onError(`TeamRun 加载失败：${(err as Error).message}`);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function cancelSelectedRun(runId: string) {
    if (!sessionId) return;
    setBusyRunId(runId);
    try {
      await cancelTeamRun(sessionId, runId);
      await refresh();
    } catch (err) {
      onError(`TeamRun 取消失败：${(err as Error).message}`);
    } finally {
      setBusyRunId(null);
    }
  }

  async function retrySelectedRun(runId: string) {
    if (!sessionId) return;
    setBusyRunId(runId);
    try {
      await retryTeamRun(sessionId, runId);
      await refresh();
    } catch (err) {
      onError(`TeamRun 重跑失败：${(err as Error).message}`);
    } finally {
      setBusyRunId(null);
    }
  }

  async function writeSelectedClaim(runId: string, claimId: string, prompt: string) {
    if (!sessionId) return;
    setBusyClaimId(claimId);
    try {
      await writeTeamClaim(sessionId, runId, claimId, prompt);
      await refresh();
    } catch (err) {
      onError(`Team 写入失败：${(err as Error).message}`);
    } finally {
      setBusyClaimId(null);
    }
  }

  async function previewSelectedClaimWrite(runId: string, claimId: string, prompt: string): Promise<TeamWritePreview | null> {
    if (!sessionId) return null;
    setPreviewingClaimId(claimId);
    try {
      const result = await previewTeamClaimWrite(sessionId, runId, claimId, prompt);
      return result.preview;
    } catch (err) {
      onError(`Team 写入预览失败：${(err as Error).message}`);
      return null;
    } finally {
      setPreviewingClaimId(null);
    }
  }

  if (!sessionId) {
    return <div className="p-4 text-sm text-muted">需要先选 session。</div>;
  }

  return (
    <div className="grid grid-cols-[300px_1fr] min-h-0 h-full">
      <aside className="border-r border-border p-4 overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">Agent Team</h2>
            <p className="text-xs text-muted">{runs.length} run(s)</p>
          </div>
          <button onClick={refresh} className="btn-secondary text-sm">刷新</button>
        </div>
        {runs.length === 0 && (
          <p className="text-sm text-muted">
            {note ?? "当前 session 还没有 TeamRun。可以在 Chat 里执行 /team run <goal>。"}
          </p>
        )}
        {runs.map((run) => (
          <button
            key={run.id}
            onClick={() => setSelectedId(run.id)}
            className={
              "w-full text-left border rounded p-3 hover:border-accent " +
              (selected?.id === run.id ? "border-accent bg-accent/5" : "border-border")
            }
          >
            <div className="font-mono text-xs">{run.id}</div>
            <div className="text-sm font-semibold line-clamp-2 mt-1">{run.userGoal}</div>
            <div className="text-xs text-muted mt-1">
              {run.status} · {run.taskRuns.length} task(s) · {new Date(run.updatedAt).toLocaleTimeString()}
            </div>
          </button>
        ))}
      </aside>
      <section className="p-4 overflow-y-auto">
        {!selected ? (
          <p className="text-sm text-muted">选择一个 TeamRun 查看详情。</p>
        ) : (
          <TeamRunDetail
            run={selected}
            busy={busyRunId === selected.id}
            onCancel={() => cancelSelectedRun(selected.id)}
            onRetry={() => retrySelectedRun(selected.id)}
            busyClaimId={busyClaimId}
            previewingClaimId={previewingClaimId}
            onPreviewClaim={(claimId, prompt) => previewSelectedClaimWrite(selected.id, claimId, prompt)}
            onWriteClaim={(claimId, prompt) => writeSelectedClaim(selected.id, claimId, prompt)}
          />
        )}
      </section>
    </div>
  );
}

function TeamRunDetail({
  run,
  busy,
  onCancel,
  onRetry,
  busyClaimId,
  previewingClaimId,
  onPreviewClaim,
  onWriteClaim,
}: {
  run: TeamRunSnapshot;
  busy: boolean;
  onCancel(): void;
  onRetry(): void;
  busyClaimId: string | null;
  previewingClaimId: string | null;
  onPreviewClaim(claimId: string, prompt: string): Promise<TeamWritePreview | null>;
  onWriteClaim(claimId: string, prompt: string): void;
}) {
  const cls = STATUS_CLASS[run.status] ?? "border-border";
  const canCancel = !["completed", "failed", "cancelled"].includes(run.status);
  const canRetry = run.taskRuns.every((taskRun) => taskRun.task.writePolicy === "read_only");
  return (
    <div className="space-y-4">
      <div className={`border rounded p-4 ${cls}`}>
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-lg font-bold">{run.userGoal}</h2>
            <p className="text-xs text-muted font-mono">{run.id}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-semibold">{run.status}</span>
            {canRetry && (
              <button
                onClick={onRetry}
                disabled={busy}
                className="btn-secondary text-xs"
                title="仅重跑 read-only TeamRun"
              >
                {busy ? "处理中..." : "重跑"}
              </button>
            )}
            {canCancel && (
              <button
                onClick={onCancel}
                disabled={busy}
                className="btn-secondary text-xs"
              >
                {busy ? "取消中..." : "取消"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm whitespace-pre-wrap">{run.summary}</p>
        {run.mergeGate && (
          <div className="mt-3 text-xs border border-border rounded p-2">
            <div className="font-semibold">Merge Gate: {run.mergeGate.status} · {run.mergeGate.strategy}</div>
            <div className="text-muted mt-1">
              required={run.mergeGate.requiredRoles.join(", ") || "none"} ·
              satisfied={run.mergeGate.satisfiedRoles.join(", ") || "none"} ·
              missing={run.mergeGate.missingRoles.join(", ") || "none"}
            </div>
            <p className="text-muted mt-1">{run.mergeGate.summary}</p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">Tasks</h3>
        <div className="space-y-2">
          {run.taskRuns.map((taskRun) => (
            <div key={taskRun.task.id} className="border border-border rounded p-3">
              <div className="flex items-center gap-2 text-sm">
                <strong>{taskRun.task.id}</strong>
                <span className="text-muted">· {taskRun.task.role}</span>
                <span className="text-xs text-muted">model={taskRun.task.model ?? "inherit-parent"}</span>
                <span className="ml-auto">{taskRun.status}</span>
              </div>
              <p className="text-xs text-muted mt-1">{taskRun.task.objective}</p>
              {taskRun.blockedReason && (
                <p className="text-xs text-warning mt-1">blocked: {taskRun.blockedReason}</p>
              )}
              {taskRun.result && (
                <pre className="text-xs mt-2 bg-bg border border-border rounded p-2 whitespace-pre-wrap">
                  {taskRun.result.summary}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">Claims</h3>
        <div className="space-y-2">
          {(!run.claims || run.claims.length === 0) && (
            <p className="text-sm text-muted">暂无文件 claim。只读 TeamRun 通常不需要 claim。</p>
          )}
          {(run.claims ?? []).map((claim) => (
            <ClaimCard
              key={claim.id}
              claim={claim}
              busy={busyClaimId === claim.id}
              previewing={previewingClaimId === claim.id}
              onPreview={(prompt) => onPreviewClaim(claim.id, prompt)}
              onWrite={(prompt) => onWriteClaim(claim.id, prompt)}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">Blackboard</h3>
        <div className="space-y-2">
          {run.blackboard.length === 0 && <p className="text-sm text-muted">暂无 Blackboard 条目。</p>}
          {run.blackboard.map((entry) => (
            <div key={entry.id} className="border border-border rounded p-2 text-sm">
              <span className="font-semibold">{entry.kind}</span>
              <span className="text-muted"> · {entry.taskId}</span>
              <p className="text-xs mt-1 whitespace-pre-wrap">{entry.summary}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">Mailbox</h3>
        <div className="space-y-2">
          {run.mailbox.length === 0 && <p className="text-sm text-muted">暂无 handoff。</p>}
          {run.mailbox.map((message) => (
            <div key={message.id} className="border border-border rounded p-2 text-sm">
              <span className="font-semibold">{message.kind}</span>
              <span className="text-muted"> · {message.fromTaskId}{message.toTaskId ? ` -> ${message.toTaskId}` : ""}</span>
              <p className="text-xs mt-1 whitespace-pre-wrap">{message.text || message.summary}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClaimCard({
  claim,
  busy,
  previewing,
  onPreview,
  onWrite,
}: {
  claim: NonNullable<TeamRunSnapshot["claims"]>[number];
  busy: boolean;
  previewing: boolean;
  onPreview(prompt: string): Promise<TeamWritePreview | null>;
  onWrite(prompt: string): void;
}) {
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<TeamWritePreview | null>(null);
  const canWrite = claim.mode === "write" && claim.status === "active";
  const validPrompt = /^\/(?:write|append|replace)\b/.test(prompt.trim());
  const canConfirm = validPrompt && preview?.ok === true;
  async function handlePreview() {
    const nextPreview = await onPreview(prompt.trim());
    setPreview(nextPreview);
  }
  return (
    <div className="border border-border rounded p-2 text-sm">
      <span className="font-mono">{claim.path}</span>
      <span className="text-muted"> · {claim.mode} · {claim.status} · {claim.taskId}</span>
      {claim.reason && <p className="text-xs text-muted mt-1">{claim.reason}</p>}
      {canWrite && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-warning">
            已批准写入。请输入本地写工具命令，只允许写入该 claim 文件，例如：
            <code className="font-mono"> /replace {claim.path} :: old :: new</code>
          </p>
          <textarea
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setPreview(null);
            }}
            className="w-full min-h-20 rounded border border-border bg-bg p-2 font-mono text-xs"
            placeholder={`/replace ${claim.path} :: old :: new`}
            disabled={busy || previewing}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy || previewing || !validPrompt}
              onClick={handlePreview}
              title="只读预览，不会写文件"
            >
              {previewing ? "预览中..." : "预览写入"}
            </button>
            {canConfirm && (
              <button
                type="button"
                className="btn-secondary text-xs border-danger text-danger"
                disabled={busy}
                onClick={() => onWrite(prompt.trim())}
                title="后端仍会校验 active claim 和目标文件"
              >
                {busy ? "写入中..." : "确认写入"}
              </button>
            )}
          </div>
          {preview && (
            <div className="border border-border rounded p-2 text-xs space-y-2">
              <div className={preview.ok ? "text-ok" : "text-danger"}>
                {preview.summary}: {preview.detail}
              </div>
              {preview.beforeSnippet !== undefined && (
                <pre className="bg-bg border border-border rounded p-2 whitespace-pre-wrap">
                  before: {preview.beforeSnippet || "[empty]"}
                </pre>
              )}
              {preview.afterSnippet !== undefined && (
                <pre className="bg-bg border border-border rounded p-2 whitespace-pre-wrap">
                  after: {preview.afterSnippet || "[empty]"}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
