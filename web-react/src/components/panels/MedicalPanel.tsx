import { useEffect, useState } from "react";
import { getMedicalSummary, type MedicalRecentStudy, type MedicalSummary } from "@/api/endpoints";

interface Props {
  onError(msg: string | null): void;
}

const COUNT_LABELS: Array<[keyof MedicalSummary["counts"], string]> = [
  ["patients", "Patients"],
  ["studies", "Studies"],
  ["images", "Images"],
  ["analysisSessions", "Analysis"],
  ["nodules", "Nodules"],
  ["reports", "Reports"],
  ["pendingReviews", "Review"],
];

export default function MedicalPanel({ onError }: Props) {
  const [summary, setSummary] = useState<MedicalSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setLocalError(null);
    try {
      setSummary(await getMedicalSummary());
    } catch (err) {
      const message = `Medical 加载失败：${(err as Error).message}`;
      setLocalError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (localError) {
    return (
      <div className="p-4">
        <div className="border border-danger rounded p-3 text-sm text-danger">{localError}</div>
        <button onClick={refresh} className="btn-secondary mt-3">重试加载</button>
      </div>
    );
  }

  if (!summary) {
    return <div className="p-4 text-sm text-muted">Loading medical workspace...</div>;
  }

  if (!summary.enabled) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Medical Workstation</h2>
          <button onClick={refresh} disabled={busy} className="btn-secondary text-sm">
            {busy ? "刷新中..." : "刷新"}
          </button>
        </div>
        <div className="border border-warning rounded p-3 text-sm text-warning">
          {summary.message ?? "medical storage disabled"}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[280px_1fr] min-h-0 h-full">
      <aside className="border-r border-border p-4 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">Medical Workstation</h2>
            <p className="text-xs text-muted">{summary.recentStudies.length} recent study(s)</p>
          </div>
          <button onClick={refresh} disabled={busy} className="btn-secondary text-sm">
            {busy ? "刷新中..." : "刷新"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {COUNT_LABELS.map(([key, label]) => (
            <div key={key} className="border border-border rounded p-2">
              <div className="text-[11px] text-muted uppercase">{label}</div>
              <div className="text-xl font-semibold mt-1">{summary.counts[key]}</div>
            </div>
          ))}
        </div>

        <QueueBlock title="Model Jobs" values={summary.queues.modelJobs} />
        <QueueBlock title="Agent Tasks" values={summary.queues.agentTasks} />
      </aside>

      <section className="p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">Recent Studies</h3>
          {summary.warnings.length > 0 && (
            <span className="text-xs text-warning">{summary.warnings.join(", ")}</span>
          )}
        </div>
        {summary.recentStudies.length === 0 ? (
          <p className="text-sm text-muted">暂无甲状腺超声验证病例。</p>
        ) : (
          <div className="space-y-2">
            {summary.recentStudies.map((study) => (
              <StudyRow key={study.id} study={study} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QueueBlock({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div>
      <h3 className="text-xs uppercase text-muted mb-2">{title}</h3>
      {entries.length === 0 ? (
        <div className="text-sm text-muted border border-border rounded p-2">none</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([status, count]) => (
            <div key={status} className="flex items-center justify-between text-sm border border-border rounded px-2 py-1.5">
              <span>{status}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudyRow({ study }: { study: MedicalRecentStudy }) {
  return (
    <article className="border border-border rounded p-3 hover:border-accent">
      <div className="flex items-start gap-3">
        <div>
          <div className="font-mono text-xs text-muted">{study.id}</div>
          <h4 className="text-sm font-semibold mt-1">
            {study.accessionNo ?? study.externalPatientId ?? "manual study"}
          </h4>
        </div>
        <span className="ml-auto text-xs border border-border rounded px-2 py-1">{study.status}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs">
        <Metric label="modality" value={`${study.modality}/${study.bodyPart}`} />
        <Metric label="source" value={study.sourceType} />
        <Metric label="images" value={String(study.imageCount)} />
        <Metric label="nodules" value={String(study.noduleCount)} />
        <Metric label="analysis" value={study.latestAnalysisStatus ?? "none"} />
        <Metric label="report" value={study.latestReportStatus ?? "none"} />
        <Metric label="updated" value={formatTime(study.updatedAt)} />
        <Metric label="created by" value={study.createdBy ?? "local"} />
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  return new Date(value).toLocaleString();
}
