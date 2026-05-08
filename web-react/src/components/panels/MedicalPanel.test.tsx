import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MedicalPanel from "./MedicalPanel";
import { useAuthStore } from "@/store/auth";

vi.mock("@/api/endpoints", () => ({
  getMedicalSummary: vi.fn(),
  createMedicalPatient: vi.fn(),
  createMedicalStudy: vi.fn(),
  createMedicalImage: vi.fn(),
}));

import { createMedicalImage, createMedicalPatient, createMedicalStudy, getMedicalSummary } from "@/api/endpoints";

const summary = {
  enabled: true,
  counts: {
    patients: 1,
    studies: 2,
    images: 3,
    analysisSessions: 4,
    nodules: 5,
    reports: 6,
    pendingReviews: 7,
  },
  queues: {
    modelJobs: { queued: 1, failed: 2 },
    agentTasks: { running: 1 },
  },
  recentStudies: [
    {
      id: "S1",
      patientId: "P1",
      externalPatientId: "EXT-P1",
      accessionNo: "ACC-1",
      modality: "US",
      bodyPart: "thyroid",
      studyTime: null,
      status: "created",
      sourceType: "manual",
      createdBy: "doctor",
      createdAt: 1778245200000,
      updatedAt: 1778245200000,
      imageCount: 1,
      noduleCount: 2,
      latestAnalysisStatus: "running",
      latestReportStatus: "draft",
    },
  ],
  warnings: [],
};

describe("MedicalPanel", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useAuthStore.setState({ token: "test-token", connected: true });
    vi.mocked(getMedicalSummary).mockResolvedValue(summary);
    vi.mocked(createMedicalPatient).mockResolvedValue({
      patient: {
        id: "P2",
        externalPatientId: "EXT-P2",
        nameHash: null,
        sex: null,
        birthYear: null,
        deidentified: true,
        meta: {},
        createdAt: 0,
        updatedAt: 0,
      },
    });
    vi.mocked(createMedicalStudy).mockResolvedValue({
      study: {
        id: "S2",
        patientId: "P2",
        accessionNo: "ACC-2",
        studyInstanceUid: null,
        modality: "US",
        bodyPart: "thyroid",
        studyTime: null,
        status: "created",
        clinicalContext: null,
        sourceType: "manual",
        createdBy: "web-test",
        createdAt: 0,
        updatedAt: 0,
      },
    });
    vi.mocked(createMedicalImage).mockResolvedValue({
      image: {
        id: "IMG2",
        studyId: "S2",
        fileUri: "artifact://raw/ACC-2/IMG1.png",
        previewUri: null,
        modelReadyUri: null,
        fileType: "png",
        width: 640,
        height: 480,
        imageQuality: null,
        qualityScore: null,
        processingStatus: "uploaded",
        createdAt: 0,
        updatedAt: 0,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads medical summary and shows counts, queues, and recent studies", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("Medical Workstation")).toBeInTheDocument();
    expect(screen.getByText("Patients")).toBeInTheDocument();
    expect(screen.getByText("Studies")).toBeInTheDocument();
    expect(screen.getByText("ACC-1")).toBeInTheDocument();
    expect(screen.getByText("US/thyroid")).toBeInTheDocument();
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("Model Jobs")).toBeInTheDocument();
    expect(screen.getByText("Agent Tasks")).toBeInTheDocument();
    expect(screen.getByText("Manual Case")).toBeInTheDocument();
  });

  it("registers a manual patient, study, and image then refreshes", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("Manual Case")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("患者编号"), { target: { value: "EXT-P2" } });
    fireEvent.change(screen.getByLabelText("检查号"), { target: { value: "ACC-2" } });
    fireEvent.change(screen.getByLabelText("图像 URI"), {
      target: { value: "artifact://raw/ACC-2/IMG1.png" },
    });
    fireEvent.change(screen.getByLabelText("出生年"), { target: { value: "1980" } });
    fireEvent.change(screen.getByLabelText("宽度"), { target: { value: "640" } });
    fireEvent.change(screen.getByLabelText("高度"), { target: { value: "480" } });
    fireEvent.change(screen.getByLabelText("临床信息"), { target: { value: "manual validation" } });

    fireEvent.click(screen.getByRole("button", { name: "登记" }));

    await waitFor(() => expect(createMedicalPatient).toHaveBeenCalled());
    expect(createMedicalPatient).toHaveBeenCalledWith({
      externalPatientId: "EXT-P2",
      sex: undefined,
      birthYear: 1980,
      meta: { source: "web_manual_case" },
    });
    expect(createMedicalStudy).toHaveBeenCalledWith({
      patientId: "P2",
      accessionNo: "ACC-2",
      clinicalContext: "manual validation",
      sourceType: "manual",
    });
    expect(createMedicalImage).toHaveBeenCalledWith({
      studyId: "S2",
      fileUri: "artifact://raw/ACC-2/IMG1.png",
      fileType: "png",
      width: 640,
      height: 480,
    });
    expect(await screen.findByText("已登记 ACC-2")).toBeInTheDocument();
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
  });

  it("shows form error when manual registration fails", async () => {
    const onError = vi.fn();
    vi.mocked(createMedicalPatient).mockRejectedValue(new Error("duplicate-medical-record"));

    render(<MedicalPanel onError={onError} />);

    expect(await screen.findByText("Manual Case")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("患者编号"), { target: { value: "EXT-P2" } });
    fireEvent.change(screen.getByLabelText("检查号"), { target: { value: "ACC-2" } });
    fireEvent.change(screen.getByLabelText("图像 URI"), {
      target: { value: "artifact://raw/ACC-2/IMG1.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登记" }));

    expect(await screen.findByText("Medical 登记失败：duplicate-medical-record")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Medical 登记失败：duplicate-medical-record");
  });

  it("shows disabled medical storage state", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValue({
      ...summary,
      enabled: false,
      message: "medical storage disabled (no data.db)",
      counts: {
        patients: 0,
        studies: 0,
        images: 0,
        analysisSessions: 0,
        nodules: 0,
        reports: 0,
        pendingReviews: 0,
      },
      queues: { modelJobs: {}, agentTasks: {} },
      recentStudies: [],
      warnings: ["data_db_not_configured"],
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("medical storage disabled (no data.db)")).toBeInTheDocument();
  });

  it("shows retryable error when summary loading fails", async () => {
    const onError = vi.fn();
    vi.mocked(getMedicalSummary).mockRejectedValue(new Error("offline"));

    render(<MedicalPanel onError={onError} />);

    expect(await screen.findByText("Medical 加载失败：offline")).toBeInTheDocument();
    expect(screen.getByText("重试加载")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Medical 加载失败：offline");
  });
});
