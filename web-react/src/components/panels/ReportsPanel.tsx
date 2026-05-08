import { useEffect, useMemo, useState } from "react";
import {
  exportReport,
  listReports,
  readReport,
  upgradeReportToDashboard,
  type ReportArtifact,
  type ReportDataset,
} from "@/api/endpoints";
import { useAuthStore } from "@/store/auth";

interface Props {
  onError(msg: string | null): void;
  onOpenDashboards?(): void;
}

export default function ReportsPanel({ onError, onOpenDashboards }: Props) {
  const token = useAuthStore((s) => s.token);
  const [reports, setReports] = useState<ReportArtifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportArtifact | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = listLoading || detailLoading || actionBusy;

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesStatus = statusFilter === "all" || report.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return [report.title, report.question, report.id, report.workspaceId, report.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [query, reports, statusFilter]);

  const statusOptions = useMemo(
    () => ["all", ...Array.from(new Set(reports.map((report) => report.status))).sort()],
    [reports]
  );
  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all";
  const selectedReportId =
    selectedId && filteredReports.some((report) => report.id === selectedId)
      ? selectedId
      : filteredReports[0]?.id ?? (hasActiveFilters ? null : reports[0]?.id ?? null);
  const activeReport = selected?.id === selectedReportId ? selected : null;

  const htmlSrc = useMemo(() => {
    if (!selectedReportId || !token) return "";
    return `/v1/web/reports/${encodeURIComponent(selectedReportId)}/html?token=${encodeURIComponent(token)}`;
  }, [selectedReportId, token]);

  async function refresh() {
    setListLoading(true);
    try {
      const r = await listReports();
      setReports(r.reports);
      setSelectedId((current) =>
        current && r.reports.some((report) => report.id === current) ? current : r.reports[0]?.id ?? null
      );
      setLocalError(null);
      onError(null);
    } catch (err) {
      const msg = `Reports 加载失败：${(err as Error).message}`;
      setLocalError(msg);
      onError(msg);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedReportId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setSelected(null);
    readReport(selectedReportId)
      .then((r) => {
        if (!cancelled) {
          setSelected(r.report);
          setLocalError(null);
        }
      })
      .catch((err) => {
        const msg = `Report 读取失败：${(err as Error).message}`;
        if (!cancelled) setLocalError(msg);
        onError(msg);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, selectedReportId]);

  async function handleExport(format: "html" | "markdown") {
    if (!selectedReportId) return;
    setActionBusy(true);
    try {
      const r = await exportReport(selectedReportId, format);
      setLocalError(null);
      onError(`已导出 ${format}: ${r.artifact.path}`);
      await refresh();
    } catch (err) {
      const msg = `Report 导出失败：${(err as Error).message}`;
      setLocalError(msg);
      onError(msg);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleUpgrade() {
    if (!activeReport) return;
    setActionBusy(true);
    try {
      const r = await upgradeReportToDashboard(activeReport.id, {
        title: `${activeReport.title} Dashboard`,
      });
      setLocalError(null);
      onError(`已生成 Dashboard: ${r.dashboard.id}`);
      onOpenDashboards?.();
    } catch (err) {
      const msg = `升级 Dashboard 失败：${(err as Error).message}`;
      setLocalError(msg);
      onError(msg);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-80 border-r border-border p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold">Reports</h2>
            <div className="text-xs text-muted">
              {filteredReports.length} / {reports.length} saved analysis artifacts
            </div>
          </div>
          <button onClick={refresh} disabled={busy} className="btn-secondary">刷新</button>
        </div>
        <div className="space-y-2 mb-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、问题、workspace..."
            className="w-full px-3 py-2 bg-bg border border-border rounded text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full px-3 py-2 bg-bg border border-border rounded text-sm"
            aria-label="Report status filter"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "all" ? "全部状态" : status}
              </option>
            ))}
          </select>
        </div>
        {localError && (
          <div className="mb-3 border border-danger/40 bg-danger/5 rounded p-3 text-xs text-danger">
            <div>{localError}</div>
            <button onClick={refresh} className="mt-2 underline" disabled={listLoading}>
              重试加载
            </button>
          </div>
        )}
        <ul className="space-y-2">
          {filteredReports.map((report) => (
            <li key={report.id}>
              <button
                onClick={() => setSelectedId(report.id)}
                className={
                  "w-full text-left border rounded p-2.5 hover:border-accent " +
                  (selectedReportId === report.id ? "border-accent bg-accent/5" : "border-border")
                }
              >
                <div className="text-sm font-medium truncate">{report.title}</div>
                <div className="text-xs text-muted mt-1 truncate">{report.question}</div>
                <div className="text-[11px] text-muted mt-1">
                  {report.status} · {report.datasets.length} dataset(s) · {report.charts.length} chart(s)
                </div>
              </button>
            </li>
          ))}
          {listLoading && reports.length === 0 && (
            <>
              {[0, 1, 2].map((i) => (
                <li key={i} className="border border-border rounded p-2.5 animate-pulse">
                  <div className="h-4 bg-border/50 rounded w-2/3" />
                  <div className="h-3 bg-border/40 rounded w-full mt-2" />
                  <div className="h-3 bg-border/30 rounded w-1/2 mt-2" />
                </li>
              ))}
            </>
          )}
          {!listLoading && reports.length === 0 && (
            <li className="text-sm text-muted border border-dashed border-border rounded p-4">
              <div className="font-medium text-fg mb-1">暂无 Report</div>
              先在 Chat 中完成一次数据分析，并让模型调用 CreateReportArtifact。
            </li>
          )}
          {!listLoading && reports.length > 0 && filteredReports.length === 0 && (
            <li className="text-sm text-muted border border-dashed border-border rounded p-4">
              没有匹配的 Report。试试清空搜索或切换状态筛选。
            </li>
          )}
        </ul>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {detailLoading ? (
          <div className="p-6 text-sm text-muted">正在读取 Report 详情...</div>
        ) : activeReport ? (
          <>
            <div className="border-b border-border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold truncate">{activeReport.title}</h2>
                <div className="text-xs text-muted mt-1">
                  {activeReport.workspaceId} · updated {new Date(activeReport.updatedAt).toLocaleString()}
                  {activeReport.upgrade?.dashboardId ? ` · dashboard ${activeReport.upgrade.dashboardId}` : ""}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => handleExport("markdown")} disabled={busy} className="btn-secondary">
                  导出 MD
                </button>
                <button onClick={() => handleExport("html")} disabled={busy} className="btn-secondary">
                  导出 HTML
                </button>
                <button onClick={handleUpgrade} disabled={busy} className="btn-primary">
                  升级 Dashboard
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[280px_1fr] min-h-0 flex-1">
              <section className="border-r border-border p-3 overflow-y-auto text-sm">
                <h3 className="text-xs uppercase text-muted mb-2">Datasets</h3>
                <ul className="space-y-2">
                  {activeReport.datasets.map((dataset) => (
                    <li key={dataset.id} className="border border-border rounded p-2">
                      <div className="font-medium">{dataset.name}</div>
                      <div className="text-xs text-muted">
                        preview={dataset.previewRows} rows{dataset.rowCount ? ` · total=${dataset.rowCount}` : ""}
                      </div>
                      <DatasetProvenance dataset={dataset} report={activeReport} />
                    </li>
                  ))}
                </ul>
                {activeReport.caveats.length > 0 && (
                  <>
                    <h3 className="text-xs uppercase text-muted mt-4 mb-2">Caveats</h3>
                    <ul className="space-y-1">
                      {activeReport.caveats.map((caveat) => (
                        <li key={`${caveat.code}-${caveat.message}`} className="text-xs text-muted">
                          {caveat.code}: {caveat.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
              <section className="min-h-0 bg-white">
                {htmlSrc ? (
                  <iframe title={`Report ${activeReport.id}`} src={htmlSrc} className="w-full h-full border-0" />
                ) : (
                  <div className="p-6 text-sm text-muted">无法生成预览链接。</div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="p-6 text-sm text-muted">
            {reports.length === 0 ? "创建 Report 后会在这里展示详情和 HTML 预览。" : "选择一个 Report 查看详情。"}
          </div>
        )}
      </main>
    </div>
  );
}

function DatasetProvenance({ dataset, report }: { dataset: ReportDataset; report: ReportArtifact }) {
  const provenance = dataset.provenance;
  const preview = provenance?.preview;
  const queryId = provenance?.queryId ?? dataset.queryId ?? "unknown";
  const provider = provenance?.generatedBy?.provider ?? report.provenance?.provider ?? "unknown";
  const model = provenance?.generatedBy?.model ?? report.provenance?.model ?? "unknown";
  const previewRows = preview?.rows ?? dataset.previewRows;
  const rowCount = preview?.rowCount ?? dataset.rowCount ?? "unknown";
  const truncated = preview?.truncated ?? (dataset.rowCount ? dataset.rowCount > dataset.previewRows : "unknown");
  const previewArtifact = provenance?.artifacts?.preview ?? dataset.previewArtifact;
  const resultArtifact = provenance?.artifacts?.result ?? dataset.resultArtifact;
  const sql = provenance?.sql ?? dataset.sql;

  if (!sql && queryId === "unknown" && provider === "unknown" && model === "unknown" && !previewArtifact && !resultArtifact) {
    return null;
  }

  return (
    <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted space-y-1">
      <div className="font-medium text-fg">Provenance</div>
      <div>queryId={queryId}</div>
      <div>model={provider} / {model}</div>
      <div>preview rows={previewRows} · rowCount={rowCount} · truncated={String(truncated)}</div>
      <ArtifactLine label="preview artifact" path={previewArtifact?.path} />
      <ArtifactLine label="result artifact" path={resultArtifact?.path} />
      {sql && (
        <details>
          <summary className="cursor-pointer">SQL</summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[10px]">
            {sql}
          </pre>
        </details>
      )}
    </div>
  );
}

function ArtifactLine({ label, path }: { label: string; path?: string }) {
  return (
    <div className="truncate" title={path ?? undefined}>
      {label}={path ?? "none"}
    </div>
  );
}
