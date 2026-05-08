import { useEffect, useMemo, useState } from "react";
import {
  listDashboards,
  readDashboard,
  renderDashboard,
  validateDashboard,
  type DashboardDataset,
  type DashboardSpec,
} from "@/api/endpoints";
import { useAuthStore } from "@/store/auth";

interface Props {
  onError(msg: string | null): void;
}

export default function DashboardsPanel({ onError }: Props) {
  const token = useAuthStore((s) => s.token);
  const [dashboards, setDashboards] = useState<DashboardSpec[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<DashboardSpec | null>(null);
  const [validation, setValidation] = useState<string>("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = listLoading || detailLoading || actionBusy;

  const filteredDashboards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dashboards.filter((dashboard) => {
      const matchesStatus = statusFilter === "all" || dashboard.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return [
        dashboard.title,
        dashboard.description,
        dashboard.id,
        dashboard.workspaceId,
        dashboard.status,
        dashboard.sourceReportId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [dashboards, query, statusFilter]);

  const statusOptions = useMemo(
    () => ["all", ...Array.from(new Set(dashboards.map((dashboard) => dashboard.status))).sort()],
    [dashboards]
  );
  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all";
  const selectedDashboardId =
    selectedId && filteredDashboards.some((dashboard) => dashboard.id === selectedId)
      ? selectedId
      : filteredDashboards[0]?.id ?? (hasActiveFilters ? null : dashboards[0]?.id ?? null);
  const activeDashboard = selected?.id === selectedDashboardId ? selected : null;

  const htmlSrc = useMemo(() => {
    if (!selectedDashboardId || !token) return "";
    return `/v1/web/dashboards/${encodeURIComponent(selectedDashboardId)}/html?token=${encodeURIComponent(token)}`;
  }, [selectedDashboardId, token]);

  async function refresh() {
    setListLoading(true);
    try {
      const r = await listDashboards();
      setDashboards(r.dashboards);
      setSelectedId((current) =>
        current && r.dashboards.some((dashboard) => dashboard.id === current)
          ? current
          : r.dashboards[0]?.id ?? null
      );
      setLocalError(null);
      onError(null);
    } catch (err) {
      const msg = `Dashboards 加载失败：${(err as Error).message}`;
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
    if (!selectedDashboardId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setSelected(null);
    setValidation("");
    readDashboard(selectedDashboardId)
      .then((r) => {
        if (!cancelled) {
          setSelected(r.dashboard);
          setLocalError(null);
        }
      })
      .catch((err) => {
        const msg = `Dashboard 读取失败：${(err as Error).message}`;
        if (!cancelled) setLocalError(msg);
        onError(msg);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, selectedDashboardId]);

  async function handleRender() {
    if (!selectedDashboardId) return;
    setActionBusy(true);
    try {
      const r = await renderDashboard(selectedDashboardId);
      setLocalError(null);
      onError(`已渲染 Dashboard: ${r.artifact.path}`);
    } catch (err) {
      const msg = `Dashboard 渲染失败：${(err as Error).message}`;
      setLocalError(msg);
      onError(msg);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleValidate() {
    if (!selectedDashboardId) return;
    setActionBusy(true);
    try {
      const r = await validateDashboard(selectedDashboardId);
      setValidation(JSON.stringify(r, null, 2));
      setLocalError(null);
      onError(r.valid ? null : "Dashboard 校验未通过，请查看校验结果。");
    } catch (err) {
      const msg = `Dashboard 校验失败：${(err as Error).message}`;
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
            <h2 className="text-sm font-bold">Dashboards</h2>
            <div className="text-xs text-muted">
              {filteredDashboards.length} / {dashboards.length} dashboard draft(s)
            </div>
          </div>
          <button onClick={refresh} disabled={busy} className="btn-secondary">刷新</button>
        </div>
        <div className="space-y-2 mb-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、来源 report、workspace..."
            className="w-full px-3 py-2 bg-bg border border-border rounded text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full px-3 py-2 bg-bg border border-border rounded text-sm"
            aria-label="Dashboard status filter"
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
          {filteredDashboards.map((dashboard) => (
            <li key={dashboard.id}>
              <button
                onClick={() => setSelectedId(dashboard.id)}
                className={
                  "w-full text-left border rounded p-2.5 hover:border-accent " +
                  (selectedDashboardId === dashboard.id ? "border-accent bg-accent/5" : "border-border")
                }
              >
                <div className="text-sm font-medium truncate">{dashboard.title}</div>
                <div className="text-xs text-muted mt-1">
                  {dashboard.status} · {dashboard.datasets.length} dataset(s) · {dashboard.pages.length} page(s)
                </div>
                {dashboard.sourceReportId && (
                  <div className="text-[11px] text-muted mt-1 truncate">from {dashboard.sourceReportId}</div>
                )}
              </button>
            </li>
          ))}
          {listLoading && dashboards.length === 0 && (
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
          {!listLoading && dashboards.length === 0 && (
            <li className="text-sm text-muted border border-dashed border-border rounded p-4">
              <div className="font-medium text-fg mb-1">暂无 Dashboard</div>
              可从 Reports 面板把高价值报告升级为 Dashboard 草稿。
            </li>
          )}
          {!listLoading && dashboards.length > 0 && filteredDashboards.length === 0 && (
            <li className="text-sm text-muted border border-dashed border-border rounded p-4">
              没有匹配的 Dashboard。试试清空搜索或切换状态筛选。
            </li>
          )}
        </ul>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {detailLoading ? (
          <div className="p-6 text-sm text-muted">正在读取 Dashboard 详情...</div>
        ) : activeDashboard ? (
          <>
            <div className="border-b border-border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold truncate">{activeDashboard.title}</h2>
                <div className="text-xs text-muted mt-1">
                  {activeDashboard.workspaceId} · v{activeDashboard.lifecycle.version} · updated{" "}
                  {new Date(activeDashboard.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={handleValidate} disabled={busy} className="btn-secondary">
                  校验
                </button>
                <button onClick={handleRender} disabled={busy} className="btn-primary">
                  渲染
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[280px_1fr] min-h-0 flex-1">
              <section className="border-r border-border p-3 overflow-y-auto text-sm">
                <h3 className="text-xs uppercase text-muted mb-2">Pages</h3>
                <ul className="space-y-2">
                  {activeDashboard.pages.map((page) => (
                    <li key={page.id} className="border border-border rounded p-2">
                      <div className="font-medium">{page.title}</div>
                      <div className="text-xs text-muted">{page.widgets.length} widget(s)</div>
                    </li>
                  ))}
                </ul>
                <h3 className="text-xs uppercase text-muted mt-4 mb-2">Datasets</h3>
                <ul className="space-y-2">
                  {activeDashboard.datasets.map((dataset) => (
                    <li key={dataset.id} className="border border-border rounded p-2">
                      <div className="font-medium">{dataset.name}</div>
                      <div className="text-xs text-muted">
                        {dataset.kind} · preview={dataset.previewRows}
                      </div>
                      <DatasetProvenance dataset={dataset} dashboard={activeDashboard} />
                    </li>
                  ))}
                </ul>
                {validation && (
                  <>
                    <h3 className="text-xs uppercase text-muted mt-4 mb-2">Validation</h3>
                    <pre className="text-xs font-mono bg-bg border border-border rounded p-2 whitespace-pre-wrap">
                      {validation}
                    </pre>
                  </>
                )}
              </section>
              <section className="min-h-0 bg-white">
                {htmlSrc ? (
                  <iframe title={`Dashboard ${activeDashboard.id}`} src={htmlSrc} className="w-full h-full border-0" />
                ) : (
                  <div className="p-6 text-sm text-muted">无法生成预览链接。</div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="p-6 text-sm text-muted">
            {dashboards.length === 0
              ? "从 Report 升级 Dashboard 后，会在这里展示多页预览和校验结果。"
              : "选择一个 Dashboard 查看详情。"}
          </div>
        )}
      </main>
    </div>
  );
}

function DatasetProvenance({ dataset, dashboard }: { dataset: DashboardDataset; dashboard: DashboardSpec }) {
  const provenance = dataset.provenance;
  const preview = provenance?.preview;
  const queryId = provenance?.queryId ?? dataset.refresh?.queryId ?? "unknown";
  const provider = provenance?.generatedBy?.provider ?? dashboard.provenance?.provider ?? "unknown";
  const model = provenance?.generatedBy?.model ?? dashboard.provenance?.model ?? "unknown";
  const previewRows = preview?.rows ?? dataset.previewRows;
  const rowCount = preview?.rowCount ?? dataset.rowCount ?? "unknown";
  const truncated = preview?.truncated ?? (dataset.rowCount ? dataset.rowCount > dataset.previewRows : "unknown");
  const previewArtifact = provenance?.artifacts?.preview ?? dataset.sourceArtifact;
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
