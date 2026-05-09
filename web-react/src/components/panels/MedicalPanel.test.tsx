import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MedicalPanel from "./MedicalPanel";
import { useAuthStore } from "@/store/auth";

vi.mock("@/api/endpoints", () => ({
  getMedicalSummary: vi.fn(),
  getMedicalModelGatewayCheck: vi.fn(),
  getMedicalStudy: vi.fn(),
  medicalArtifactUrl: vi.fn((uri: string) => `/v1/web/medical/artifacts?uri=${encodeURIComponent(uri)}&token=test-token`),
  createMedicalPatient: vi.fn(),
  createMedicalStudy: vi.fn(),
  createMedicalImage: vi.fn(),
  reviewMedicalReport: vi.fn(),
  startMedicalAnalysis: vi.fn(),
}));

import {
  createMedicalImage,
  createMedicalPatient,
  createMedicalStudy,
  getMedicalModelGatewayCheck,
  getMedicalStudy,
  medicalArtifactUrl,
  getMedicalSummary,
  reviewMedicalReport,
  startMedicalAnalysis,
} from "@/api/endpoints";

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

const studyBundle = {
  patient: {
    id: "P1",
    externalPatientId: "EXT-P1",
    nameHash: null,
    sex: null,
    birthYear: null,
    deidentified: true,
    meta: {},
    createdAt: 1778245200000,
    updatedAt: 1778245200000,
  },
  study: {
    id: "S1",
    patientId: "P1",
    accessionNo: "ACC-1",
    studyInstanceUid: null,
    modality: "US",
    bodyPart: "thyroid",
    studyTime: null,
    status: "created",
    clinicalContext: null,
    sourceType: "manual",
    createdBy: "doctor",
    createdAt: 1778245200000,
    updatedAt: 1778245200000,
  },
  images: [
    {
      id: "IMG1",
      studyId: "S1",
      fileUri: "artifact://raw/S1/IMG1.png",
      previewUri: null,
      modelReadyUri: null,
      fileType: "png",
      width: 640,
      height: 480,
      imageQuality: null,
      qualityScore: null,
      processingStatus: "uploaded",
      createdAt: 1778245200000,
      updatedAt: 1778245200000,
    },
  ],
  nodules: [
    {
      id: "N1",
      studyId: "S1",
      imageId: "IMG1",
      noduleIndex: 1,
      location: null,
      bbox: [10, 20, 30, 40],
      maskUri: null,
      detectionConfidence: 0.91,
      source: "ai",
      status: "detected",
      createdAt: 1778245200000,
      updatedAt: 1778245200000,
    },
  ],
  tiradsFeatures: [],
  tiradsResults: [
    {
      id: "TR1",
      noduleId: "N1",
      systemName: "ACR_TI_RADS",
      systemVersion: "2017",
      score: 4,
      category: "TR4",
      recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
      evidenceRules: [{ rule_code: "ACR_2017_category_TR4" }],
      warnings: [],
      createdAt: 1778245200000,
    },
  ],
  reports: [
    {
      id: "R1",
      studyId: "S1",
      analysisSessionId: null,
      reportType: "thyroid_ultrasound",
      status: "draft",
      templateId: "tpl-thyroid-ultrasound-draft-v1",
      draftText: "甲状腺超声AI辅助报告（草稿）\nTI-RADS TR4，需医生审核确认后生效。",
      finalText: null,
      structured: { review_required: true },
      evidence: [{ source: "tirads_result", rule_code: "ACR_2017_category_TR4" }],
      createdByAgent: "worker-test",
      confirmedBy: null,
      confirmedAt: null,
      createdAt: 1778245200000,
      updatedAt: 1778245200000,
    },
  ],
  auditLogs: [
    {
      id: "A1",
      studyId: "S1",
      actorType: "agent",
      actorId: "worker-test",
      action: "medical.safety_review",
      targetType: "report",
      targetId: "R1",
      detail: {
        safety_status: "needs_doctor_review",
        issues: [{ rule_code: "NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR", severity: "critical", message: "需医生审核" }],
      },
      traceId: "AT-SAFE",
      createdAt: 1778245200000,
    },
  ],
  doctorReviews: [],
  modelJobs: [
    {
      id: "MJ1",
      studyId: "S1",
      imageId: "IMG1",
      agentTaskId: "AT-DETECT",
      jobType: "thyroid.detect_nodules",
      status: "succeeded",
      priority: 100,
      attempts: 1,
      maxAttempts: 1,
      input: {},
      output: {
        artifacts: {
          detections_json: "artifact://model-output/S1/IMG1/MJ1/detections.json",
          overlay_image: "artifact://model-output/S1/IMG1/MJ1/overlay.png",
        },
      },
      error: null,
      modelName: "yolov11-thyroid-detector",
      modelVersion: "validation",
      weightsHash: null,
      artifactUri: "artifact://model-output/S1/IMG1/MJ1/detections.json",
      createdAt: 1778245200000,
      updatedAt: 1778245300000,
      startedAt: 1778245200000,
      completedAt: 1778245300000,
    },
  ],
  analysisSessions: [],
  agentTasks: [],
};

describe("MedicalPanel", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useAuthStore.setState({ token: "test-token", connected: true });
    vi.mocked(getMedicalSummary).mockResolvedValue(summary);
    vi.mocked(getMedicalModelGatewayCheck).mockResolvedValue({
      gatewayUrl: "http://127.0.0.1:8766",
      reachable: true,
      httpStatus: 200,
      checkedAt: 1778245300000,
      durationMs: 12,
      result: {
        status: "degraded",
        ready_detectors: ["yolov11"],
        runtime: { gpu: { cuda_available: true, device_count: 1 } },
      },
      warnings: ["cuda_unavailable"],
    });
    vi.mocked(getMedicalStudy).mockResolvedValue({ bundle: studyBundle });
    vi.mocked(reviewMedicalReport).mockResolvedValue({
      report: {
        ...studyBundle.reports[0],
        status: "confirmed",
        finalText: studyBundle.reports[0].draftText,
        confirmedBy: "web-test",
        confirmedAt: 1778245300000,
      },
      doctorReview: {
        id: "DR1",
        reportId: "R1",
        reviewerName: "web-test",
        action: "approve",
        comment: null,
        before: { status: "draft" },
        after: { status: "confirmed" },
        createdAt: 1778245300000,
      },
      auditLog: {
        id: "A2",
        studyId: "S1",
        actorType: "doctor",
        actorId: "web-test",
        action: "medical.report.approve",
        targetType: "report",
        targetId: "R1",
        detail: { report_status: "confirmed" },
        traceId: "DR1",
        createdAt: 1778245300000,
      },
      bundle: {
        ...studyBundle,
        reports: [
          {
            ...studyBundle.reports[0],
            status: "confirmed",
            finalText: studyBundle.reports[0].draftText,
            confirmedBy: "web-test",
            confirmedAt: 1778245300000,
          },
        ],
        doctorReviews: [
          {
            id: "DR1",
            reportId: "R1",
            reviewerName: "web-test",
            action: "approve",
            comment: null,
            before: { status: "draft" },
            after: { status: "confirmed" },
            createdAt: 1778245300000,
          },
        ],
      },
    });
    vi.mocked(startMedicalAnalysis).mockResolvedValue({
      analysisSession: {
        id: "AS1",
        studyId: "S1",
        teamRunId: null,
        status: "queued",
        triggerSource: "web_manual",
        summary: {},
        error: null,
        startedAt: null,
        completedAt: null,
        createdBy: "web-test",
        createdAt: 0,
        updatedAt: 0,
      },
      agentTasks: [
        {
          id: "AT1",
          analysisSessionId: "AS1",
          parentTaskId: null,
          agentName: "ImageQcAgent",
          taskType: "image_qc",
          status: "queued",
          input: {},
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      bundle: {
        ...studyBundle,
        analysisSessions: [
          {
            id: "AS1",
            studyId: "S1",
            teamRunId: null,
            status: "queued",
            triggerSource: "web_manual",
            summary: {},
            error: null,
            startedAt: null,
            completedAt: null,
            createdBy: "web-test",
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        agentTasks: [
          {
            id: "AT1",
            analysisSessionId: "AS1",
            parentTaskId: null,
            agentName: "ImageQcAgent",
            taskType: "image_qc",
            status: "queued",
            input: {},
            output: null,
            error: null,
            startedAt: null,
            completedAt: null,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      },
    });
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
    expect(screen.getByText("Model Gateway")).toBeInTheDocument();
    expect(screen.getByText("yolov11")).toBeInTheDocument();
    expect(screen.getByText("Manual Case")).toBeInTheDocument();
  });

  it("opens study detail and starts analysis for an image", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    expect(await screen.findByText("artifact://raw/S1/IMG1.png")).toBeInTheDocument();
    expect(screen.getByText(/640×480/)).toBeInTheDocument();
    expect(screen.getByText("Nodule 1")).toBeInTheDocument();
    expect(screen.getByText("TR4")).toBeInTheDocument();
    expect(screen.getByText(/甲状腺超声AI辅助报告/)).toBeInTheDocument();
    expect(screen.getByText("needs_doctor_review")).toBeInTheDocument();
    expect(screen.getByText("thyroid.detect_nodules")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/detections.json")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/overlay.png")).toBeInTheDocument();
    expect(screen.getByAltText("detector overlay preview")).toHaveAttribute(
      "src",
      "/v1/web/medical/artifacts?uri=artifact%3A%2F%2Fmodel-output%2FS1%2FIMG1%2FMJ1%2Foverlay.png&token=test-token"
    );
    expect(medicalArtifactUrl).toHaveBeenCalledWith("artifact://model-output/S1/IMG1/MJ1/overlay.png");

    fireEvent.click(screen.getByRole("button", { name: "启动分析" }));

    await waitFor(() => expect(startMedicalAnalysis).toHaveBeenCalledWith("S1", { imageId: "IMG1" }));
    expect(getMedicalStudy).toHaveBeenCalledWith("S1");
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
  });

  it("confirms a report draft from study detail", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    expect(await screen.findByText(/甲状腺超声AI辅助报告/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认报告" }));

    await waitFor(() =>
      expect(reviewMedicalReport).toHaveBeenCalledWith("R1", {
        action: "approve",
        finalText: "甲状腺超声AI辅助报告（草稿）\nTI-RADS TR4，需医生审核确认后生效。",
      })
    );
    expect(await screen.findByText("confirmed")).toBeInTheDocument();
    expect(screen.getByText("approve")).toBeInTheDocument();
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
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
    expect(getMedicalStudy).toHaveBeenCalledWith("S2");
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
