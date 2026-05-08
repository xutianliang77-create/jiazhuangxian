import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DashboardsPanel from "./DashboardsPanel";
import { useAuthStore } from "@/store/auth";

vi.mock("@/api/endpoints", () => ({
  listDashboards: vi.fn(),
  readDashboard: vi.fn(),
  renderDashboard: vi.fn(),
  validateDashboard: vi.fn(),
}));

import {
  listDashboards,
  readDashboard,
  renderDashboard,
  validateDashboard,
} from "@/api/endpoints";

const dashboard = {
  id: "dashboard-1",
  title: "Food Sales Dashboard",
  description: "Upgraded from report",
  owner: { type: "user", id: "user-1" },
  workspaceId: "ws-1",
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  status: "draft" as const,
  sourceReportId: "report-1",
  datasets: [
    {
      id: "dataset-1",
      name: "food_sales",
      kind: "sql",
      sql: "select item_name, sum(quantity) as quantity from food_sales group by item_name",
      previewRows: 5,
      rowCount: 20,
      refresh: { mode: "manual", queryId: "q-dashboard-1" },
      resultArtifact: {
        path: "/tmp/dashboard-result.json",
        kind: "json" as const,
        createdAt: "2026-05-03T00:00:00.000Z",
      },
      provenance: {
        sql: "select item_name, sum(quantity) as quantity from food_sales group by item_name",
        queryId: "q-dashboard-1",
        generatedBy: { provider: "lmstudio", model: "qwen3.6" },
        preview: { rows: 5, rowCount: 20, truncated: true },
        artifacts: {
          result: {
            path: "/tmp/dashboard-result.json",
            kind: "json" as const,
            createdAt: "2026-05-03T00:00:00.000Z",
          },
        },
      },
    },
  ],
  pages: [{ id: "page-1", title: "Overview", widgets: [{ id: "widget-1", type: "chart", title: "Top items" }] }],
  filters: [],
  parameters: [],
  interactions: [],
  provenance: { source: "report_upgrade", sourceReportId: "report-1", provider: "lmstudio", model: "qwen3.6" },
  lifecycle: { version: 1 },
};

const publishedDashboard = {
  ...dashboard,
  id: "dashboard-2",
  title: "Executive Dashboard",
  description: "Published board",
  status: "published" as const,
  sourceReportId: "report-2",
  datasets: [{ id: "dataset-2", name: "executive_sales", kind: "sql", previewRows: 5, rowCount: 10 }],
  pages: [{ id: "page-2", title: "Executive", widgets: [] }],
};

describe("DashboardsPanel", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useAuthStore.setState({ token: "test-token", connected: true });
    vi.mocked(listDashboards).mockResolvedValue({ dashboards: [dashboard] });
    vi.mocked(readDashboard).mockResolvedValue({ dashboard });
    vi.mocked(renderDashboard).mockResolvedValue({
      artifact: {
        path: "/tmp/dashboard.html",
        kind: "html",
        createdAt: "2026-05-03T00:00:00.000Z",
      },
    });
    vi.mocked(validateDashboard).mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads dashboards, reads selected dashboard, and builds authenticated iframe src", async () => {
    render(<DashboardsPanel onError={() => undefined} />);

    expect((await screen.findAllByText("Food Sales Dashboard")).length).toBeGreaterThan(0);
    expect(screen.getByText("from report-1")).toBeInTheDocument();
    expect(await screen.findByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("food_sales")).toBeInTheDocument();
    expect(screen.getByText("Provenance")).toBeInTheDocument();
    expect(screen.getByText("queryId=q-dashboard-1")).toBeInTheDocument();
    expect(screen.getByText("model=lmstudio / qwen3.6")).toBeInTheDocument();
    expect(screen.getByText("preview rows=5 · rowCount=20 · truncated=true")).toBeInTheDocument();
    expect(screen.getByText("result artifact=/tmp/dashboard-result.json")).toBeInTheDocument();

    const iframe = screen.getByTitle("Dashboard dashboard-1") as HTMLIFrameElement;
    expect(iframe.src).toContain("/v1/web/dashboards/dashboard-1/html");
    expect(iframe.src).toContain("token=test-token");
    expect(readDashboard).toHaveBeenCalledWith("dashboard-1");
  });

  it("validates and renders dashboard", async () => {
    const onError = vi.fn();
    render(<DashboardsPanel onError={onError} />);

    await screen.findByText("Overview");
    fireEvent.click(screen.getByText("校验"));
    await waitFor(() => expect(validateDashboard).toHaveBeenCalledWith("dashboard-1"));
    expect(await screen.findByText(/"valid": true/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("渲染"));
    await waitFor(() => expect(renderDashboard).toHaveBeenCalledWith("dashboard-1"));
    expect(onError).toHaveBeenCalledWith("已渲染 Dashboard: /tmp/dashboard.html");
  });

  it("filters dashboards by search text and status", async () => {
    vi.mocked(listDashboards).mockResolvedValue({ dashboards: [dashboard, publishedDashboard] });
    vi.mocked(readDashboard).mockImplementation(async (id) => ({
      dashboard: id === "dashboard-2" ? publishedDashboard : dashboard,
    }));

    render(<DashboardsPanel onError={() => undefined} />);

    expect((await screen.findAllByText("Food Sales Dashboard")).length).toBeGreaterThan(0);
    expect(screen.getByText("Executive Dashboard")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索标题、来源 report、workspace..."), {
      target: { value: "executive" },
    });
    expect(screen.queryByText("Food Sales Dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("Executive Dashboard")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dashboard status filter"), { target: { value: "draft" } });
    expect(screen.getByText("没有匹配的 Dashboard。试试清空搜索或切换状态筛选。")).toBeInTheDocument();
  });

  it("shows a retryable local error when dashboard list loading fails", async () => {
    const onError = vi.fn();
    vi.mocked(listDashboards).mockRejectedValue(new Error("offline"));

    render(<DashboardsPanel onError={onError} />);

    expect(await screen.findByText("Dashboards 加载失败：offline")).toBeInTheDocument();
    expect(screen.getByText("重试加载")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Dashboards 加载失败：offline");
  });
});
