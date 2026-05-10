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
  reviseMedicalNodule: vi.fn(),
  searchMedicalKnowledge: vi.fn(),
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
  reviseMedicalNodule,
  searchMedicalKnowledge,
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
      maskUri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
      detectionConfidence: 0.91,
      source: "ai",
      status: "detected",
      createdAt: 1778245200000,
      updatedAt: 1778245200000,
    },
  ],
  measurements: [
    {
      id: "M1",
      noduleId: "N1",
      longAxisMm: 11,
      shortAxisMm: 6,
      apAxisMm: null,
      areaMm2: 42,
      aspectRatio: 1.83,
      measurementSource: "mask",
      confidence: 0.88,
      createdAt: 1778245300000,
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
      structured: {
        review_required: true,
        model_evidence: {
          segmentation_count: 1,
          measurement_count: 1,
        },
      },
      evidence: [
        { source: "tirads_result", rule_code: "ACR_2017_category_TR4" },
        {
          source: "segmentation_result",
          nodule_id: "N1",
          nodule_index: 1,
          model_job_id: "MJ-SEG",
          artifact_uri: "artifact://model-output/S1/IMG1/MJ-SEG/segmentation.json",
          model_name: "nnunet-tight-roi-segmenter",
          model_version: "tn3k-tight-roi-5fold-best",
          segmentation_source: "nnunet_tight_roi",
          mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
          confidence: 0.92,
          requires_doctor_review: true,
          metadata: {
            crop_box_xyxy: [8, 18, 32, 52],
            roi_size: [384, 384],
          },
        },
        {
          source: "measurement_result",
          nodule_id: "N1",
          nodule_index: 1,
          model_job_id: "MJ-MEASURE",
          artifact_uri: "artifact://model-output/S1/IMG1/MJ-MEASURE/measurement.json",
          model_name: "mask-measurement-worker",
          model_version: "validation-measurement-v1",
          measurement_source: "mask",
          long_axis_mm: 11,
          short_axis_mm: 6,
          ap_axis_mm: null,
          area_mm2: 42,
          aspect_ratio: 1.83,
          pixel_measurements: {
            long_axis_px: 22,
            short_axis_px: 12,
          },
          confidence: 0.88,
          requires_doctor_review: true,
        },
      ],
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
          model_comparison_json: "artifact://model-output/S1/IMG1/MJ1/comparison.json",
        },
        comparison: {
          consensus: {
            status: "matched",
            matched_count: 1,
            primary_only_count: 0,
            comparator_only_count: 0,
            primary_count: 1,
            comparator_count: 1,
          },
          matches: [
            {
              primary_detection_id: "primary-1",
              comparator_detection_id: "yolo-1",
              iou: 0.86,
              status: "matched",
            },
          ],
        },
        llm_evaluation: {
          status: "pending_llm",
          intended_model: "qwen3.6",
          overall_assessment: "consistent",
          doctor_review_focus: [
            "Matched detections can be reviewed at lower priority unless ImageQC flags risk.",
          ],
          constraints: [
            "LLM must not create, delete, or move bbox coordinates.",
          ],
        },
      },
      error: null,
      modelName: "rf-detr-medium-thyroid-detector",
      modelVersion: "validation",
      weightsHash: null,
      artifactUri: "artifact://model-output/S1/IMG1/MJ1/detections.json",
      createdAt: 1778245200000,
      updatedAt: 1778245300000,
      startedAt: 1778245200000,
      completedAt: 1778245300000,
    },
    {
      id: "MJ-SEG",
      studyId: "S1",
      imageId: "IMG1",
      agentTaskId: "AT-SEG",
      jobType: "thyroid.segment_nodule",
      status: "succeeded",
      priority: 100,
      attempts: 1,
      maxAttempts: 1,
      input: { nodule_id: "N1" },
      output: {
        segmentations: [
          {
            nodule_id: "N1",
            nodule_index: 1,
            mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
            segmentation_source: "nnunet_tight_roi",
            confidence: 0.92,
            metadata: {
              crop_box_xyxy: [8, 18, 32, 52],
              roi_size: [384, 384],
            },
          },
        ],
      },
      error: null,
      modelName: "nnunet-tight-roi-segmenter",
      modelVersion: "tn3k-tight-roi-5fold-best",
      weightsHash: null,
      artifactUri: "artifact://model-output/S1/IMG1/MJ-SEG/segmentation.json",
      createdAt: 1778245300000,
      updatedAt: 1778245400000,
      startedAt: 1778245300000,
      completedAt: 1778245400000,
    },
    {
      id: "MJ-MEASURE",
      studyId: "S1",
      imageId: "IMG1",
      agentTaskId: "AT-MEASURE",
      jobType: "thyroid.measure_nodule",
      status: "succeeded",
      priority: 100,
      attempts: 1,
      maxAttempts: 1,
      input: { nodule_id: "N1" },
      output: {
        measurements: [
          {
            nodule_id: "N1",
            nodule_index: 1,
            measurement_source: "mask",
            long_axis_mm: 11,
            short_axis_mm: 6,
            area_mm2: 42,
            aspect_ratio: 1.83,
            pixel_measurements: {
              long_axis_px: 22,
              short_axis_px: 12,
            },
            confidence: 0.88,
          },
        ],
      },
      error: null,
      modelName: "mask-measurement-worker",
      modelVersion: "validation-measurement-v1",
      weightsHash: null,
      artifactUri: "artifact://model-output/S1/IMG1/MJ-MEASURE/measurement.json",
      createdAt: 1778245400000,
      updatedAt: 1778245500000,
      startedAt: 1778245400000,
      completedAt: 1778245500000,
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
    vi.mocked(searchMedicalKnowledge).mockResolvedValue({
      enabled: true,
      mode: "bm25",
      query: "TR4",
      count: 1,
      warnings: [],
      evidence: [
        {
          chunkId: "medical/doc-acr-tirads-2017/tr4",
          score: 1.23,
          hits: ["tr4"],
          text: "TR4 nodules require size-based follow-up or FNA according to ACR TI-RADS.",
          document: {
            id: "doc-acr-tirads-2017",
            title: "ACR TI-RADS 2017",
            sourceType: "guideline",
            sourceName: "ACR",
            version: "2017",
            language: "en",
            effectiveDate: "2017-01-01",
            fileUri: "artifact://knowledge/acr.pdf",
            reviewStatus: "approved",
            approvedBy: "unit-test",
            approvedAt: 1778245200000,
          },
          metadata: {
            sectionTitle: "TR4",
            chunkType: "guideline",
            topic: "tirads",
            pageNo: 1,
            evidenceLevel: "guideline",
            tiradsSystem: "ACR_TI_RADS",
            bodyPart: "thyroid",
            reviewStatus: "approved",
            relPath: "examples/medical-knowledge/acr.md",
            lineStart: 10,
            lineEnd: 20,
            indexedAt: 1778245200000,
          },
        },
      ],
    });
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
    const revisionAnalysisSession = {
      id: "AS-REV",
      studyId: "S1",
      teamRunId: null,
      status: "queued",
      triggerSource: "doctor_bbox_revision",
      summary: { source: "doctor_bbox_revision", nodule_id: "N1" },
      error: null,
      startedAt: null,
      completedAt: null,
      createdBy: "web-test",
      createdAt: 1778245400001,
      updatedAt: 1778245400001,
    };
    const revisionAgentTasks = [
      {
        id: "AT-REV-1",
        analysisSessionId: "AS-REV",
        parentTaskId: null,
        agentName: "SegmentationAgent",
        taskType: "segment_nodules",
        status: "queued",
        input: { target_nodule_ids: ["N1"], allow_bbox_fallback: false },
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: 1778245400001,
        updatedAt: 1778245400001,
      },
      {
        id: "AT-REV-2",
        analysisSessionId: "AS-REV",
        parentTaskId: "AT-REV-1",
        agentName: "MeasurementAgent",
        taskType: "measure_nodules",
        status: "queued",
        input: { target_nodule_ids: ["N1"] },
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: 1778245400002,
        updatedAt: 1778245400002,
      },
      {
        id: "AT-REV-3",
        analysisSessionId: "AS-REV",
        parentTaskId: "AT-REV-2",
        agentName: "ReportDraftAgent",
        taskType: "draft_report",
        status: "queued",
        input: { target_nodule_ids: ["N1"], refresh_report_basis: true },
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: 1778245400003,
        updatedAt: 1778245400003,
      },
    ];
    vi.mocked(reviseMedicalNodule).mockResolvedValue({
      nodule: {
        ...studyBundle.nodules[0],
        bbox: [12, 22, 32, 42],
        source: "doctor",
        status: "doctor_revised",
        updatedAt: 1778245400000,
      },
      analysisSession: revisionAnalysisSession,
      agentTasks: revisionAgentTasks,
      auditLog: {
        id: "A3",
        studyId: "S1",
        actorType: "doctor",
        actorId: "web-test",
        action: "medical.nodule.revise",
        targetType: "nodule",
        targetId: "N1",
        detail: {
          before: {
            id: "N1",
            nodule_index: 1,
            bbox: [10, 20, 30, 40],
            mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
          },
          after: {
            id: "N1",
            nodule_index: 1,
            bbox: [12, 22, 32, 42],
            mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
          },
        },
        traceId: "N1",
        createdAt: 1778245400000,
      },
      bundle: {
        ...studyBundle,
        nodules: [
          {
            ...studyBundle.nodules[0],
            bbox: [12, 22, 32, 42],
            source: "doctor",
            status: "doctor_revised",
            updatedAt: 1778245400000,
          },
        ],
        analysisSessions: [...studyBundle.analysisSessions, revisionAnalysisSession],
        agentTasks: [...studyBundle.agentTasks, ...revisionAgentTasks],
        auditLogs: [
          ...studyBundle.auditLogs,
          {
            id: "A3",
            studyId: "S1",
            actorType: "doctor",
            actorId: "web-test",
            action: "medical.nodule.revise",
            targetType: "nodule",
            targetId: "N1",
            detail: {
              before: {
                id: "N1",
                nodule_index: 1,
                bbox: [10, 20, 30, 40],
                mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
              },
              after: {
                id: "N1",
                nodule_index: 1,
                bbox: [12, 22, 32, 42],
                mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
              },
            },
            traceId: "N1",
            createdAt: 1778245400000,
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
    expect(screen.getByText("知识证据")).toBeInTheDocument();
  });

  it("searches approved medical knowledge evidence", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("知识证据")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("知识证据"), { target: { value: "TR4" } });
    fireEvent.click(screen.getByRole("button", { name: "检索" }));

    await waitFor(() => expect(searchMedicalKnowledge).toHaveBeenCalledWith("TR4", 5));
    expect(await screen.findByText("ACR TI-RADS 2017")).toBeInTheDocument();
    expect(screen.getByText(/TR4 nodules require/)).toBeInTheDocument();
    expect(screen.getByText("examples/medical-knowledge/acr.md:10-20")).toBeInTheDocument();
  });

  it("opens study detail and starts analysis for an image", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    expect(await screen.findByText("artifact://raw/S1/IMG1.png")).toBeInTheDocument();
    expect(screen.getByText(/640×480/)).toBeInTheDocument();
    expect(screen.getAllByText("Nodule 1").length).toBeGreaterThan(0);
    expect(screen.getByText("TR4")).toBeInTheDocument();
    expect(screen.getByText(/甲状腺超声AI辅助报告/)).toBeInTheDocument();
    expect(screen.getByText("Overlay Revision")).toBeInTheDocument();
    expect(screen.getByText("Model Evidence")).toBeInTheDocument();
    expect(screen.getByText("nnunet_tight_roi")).toBeInTheDocument();
    expect(screen.getAllByText("nnunet-tight-roi-segmenter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("tn3k-tight-roi-5fold-best").length).toBeGreaterThan(0);
    expect(screen.getByText("8, 18, 32, 52")).toBeInTheDocument();
    expect(screen.getByText("384, 384")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ-SEG/mask.png")).toBeInTheDocument();
    expect(screen.getAllByText("artifact://model-output/S1/IMG1/MJ-SEG/segmentation.json").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mask-measurement-worker").length).toBeGreaterThan(0);
    expect(screen.getByText("11.00 mm")).toBeInTheDocument();
    expect(screen.getByText("6.00 mm")).toBeInTheDocument();
    expect(screen.getByText("42.00 mm2")).toBeInTheDocument();
    expect(screen.getByText("pixels long_axis_px=22, short_axis_px=12")).toBeInTheDocument();
    expect(screen.getAllByText("artifact://model-output/S1/IMG1/MJ-MEASURE/measurement.json").length).toBeGreaterThan(0);
    expect(screen.getByText("needs_doctor_review")).toBeInTheDocument();
    expect(screen.getByText("thyroid.detect_nodules")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/detections.json")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/overlay.png")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/comparison.json")).toBeInTheDocument();
    expect(screen.getByText("Detector Consensus")).toBeInTheDocument();
    expect(screen.getAllByText("matched").length).toBeGreaterThan(0);
    expect(screen.getByText("qwen3.6 · pending_llm · consistent")).toBeInTheDocument();
    expect(screen.getByText(/LLM must not create, delete, or move bbox coordinates/)).toBeInTheDocument();
    expect(screen.getByAltText("overlay revision preview")).toHaveAttribute(
      "src",
      "/v1/web/medical/artifacts?uri=artifact%3A%2F%2Fmodel-output%2FS1%2FIMG1%2FMJ1%2Foverlay.png&token=test-token"
    );
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
    fireEvent.change(screen.getByLabelText("报告正文"), {
      target: { value: "医生修订后的甲状腺超声报告" },
    });
    fireEvent.change(screen.getByLabelText("审核意见"), {
      target: { value: "医生已核对图像与证据" },
    });
    expect(screen.getByText(/已修改草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认报告" }));

    await waitFor(() =>
      expect(reviewMedicalReport).toHaveBeenCalledWith("R1", {
        action: "approve",
        finalText: "医生修订后的甲状腺超声报告",
        comment: "医生已核对图像与证据",
      })
    );
    expect(await screen.findByText("confirmed")).toBeInTheDocument();
    expect(screen.getByText("approve")).toBeInTheDocument();
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
  });

  it("draws a bbox on the overlay preview and saves the selected nodule revision", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    const canvas = await screen.findByTestId("overlay-revision-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 640,
        height: 480,
        right: 640,
        bottom: 480,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    fireEvent.mouseDown(canvas, { clientX: 12, clientY: 22 });
    fireEvent.mouseMove(canvas, { clientX: 32, clientY: 42 });
    fireEvent.mouseUp(canvas, { clientX: 32, clientY: 42 });
    expect(screen.getByText("12, 22, 32, 42")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存 overlay 修订" }));

    await waitFor(() =>
      expect(reviseMedicalNodule).toHaveBeenCalledWith("N1", {
        bbox: [12, 22, 32, 42],
        status: "doctor_revised",
      })
    );
    expect(await screen.findByText("doctor_revised")).toBeInTheDocument();
    expect(screen.getByText("bbox 10, 20, 30, 40 -> 12, 22, 32, 42")).toBeInTheDocument();
  });

  it("blocks zero-area overlay bbox revisions before calling the API", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    const canvas = await screen.findByTestId("overlay-revision-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 640,
        height: 480,
        right: 640,
        bottom: 480,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    fireEvent.mouseDown(canvas, { clientX: 12, clientY: 22 });
    fireEvent.mouseUp(canvas, { clientX: 12, clientY: 22 });

    fireEvent.click(screen.getByRole("button", { name: "保存 overlay 修订" }));

    expect(await screen.findByText("bbox 宽度和高度至少需要 1 像素，请重新拖拽框选。")).toBeInTheDocument();
    expect(reviseMedicalNodule).not.toHaveBeenCalled();
  });

  it("saves a doctor bbox revision for a nodule", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    await waitFor(() => expect(screen.getAllByText("Nodule 1").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("bbox xyxy"), { target: { value: "12, 22, 32, 42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));

    await waitFor(() =>
      expect(reviseMedicalNodule).toHaveBeenCalledWith("N1", {
        bbox: [12, 22, 32, 42],
        status: "doctor_revised",
      })
    );
    expect(await screen.findByText("doctor_revised")).toBeInTheDocument();
    expect(screen.getAllByText("medical.nodule.revise").length).toBeGreaterThan(0);
    expect(screen.getByText("bbox 10, 20, 30, 40 -> 12, 22, 32, 42")).toBeInTheDocument();
    expect(screen.getByText("Revision Evidence Diff")).toBeInTheDocument();
    expect(screen.getAllByText("pending refresh").length).toBeGreaterThan(0);
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
  });

  it("shows refreshed model evidence for a completed bbox revision audit", async () => {
    const revisionCreatedAt = 1778245400000;
    const refreshedMaskUri = "artifact://model-output/web-smoke/mask_nodule_1.png";
    vi.mocked(getMedicalStudy).mockResolvedValueOnce({
      bundle: {
        ...studyBundle,
        nodules: [
          {
            ...studyBundle.nodules[0],
            bbox: [12, 22, 32, 42],
            maskUri: refreshedMaskUri,
            source: "doctor",
            status: "doctor_revised",
            updatedAt: 1778245600000,
          },
        ],
        measurements: [
          {
            ...studyBundle.measurements[0],
            id: "M-REV",
            longAxisMm: 5,
            shortAxisMm: 5,
            areaMm2: 25,
            aspectRatio: 1,
            createdAt: 1778245600000,
          },
        ],
        reports: [
          {
            ...studyBundle.reports[0],
            id: "R-REV",
            updatedAt: 1778245700000,
            evidence: [
              { source: "tirads_result", rule_code: "ACR_2017_category_TR4" },
              {
                source: "segmentation_result",
                nodule_id: "N1",
                nodule_index: 1,
                model_job_id: "MJ-SEG-REV",
                artifact_uri: "artifact://model-output/web-smoke/segmentation.json",
                model_name: "nnunet-tight-roi-segmenter",
                model_version: "tn3k-tight-roi-5fold-best",
                segmentation_source: "nnunet_tight_roi",
                mask_uri: refreshedMaskUri,
                confidence: 0.91,
                requires_doctor_review: false,
                metadata: {
                  prompt_bbox: [12, 22, 32, 42],
                  crop_box_xyxy: [10, 20, 34, 44],
                  roi_size: [384, 384],
                },
              },
              {
                source: "measurement_result",
                nodule_id: "N1",
                nodule_index: 1,
                model_job_id: "MJ-MEASURE-REV",
                artifact_uri: "artifact://model-output/web-smoke/measurements.json",
                model_name: "mask-measurement-worker",
                model_version: "validation-measurement-v1",
                measurement_source: "mask",
                long_axis_mm: 5,
                short_axis_mm: 5,
                ap_axis_mm: null,
                area_mm2: 25,
                aspect_ratio: 1,
                pixel_measurements: { long_axis_px: 20, short_axis_px: 20, area_px2: 400 },
                confidence: 0.9,
                requires_doctor_review: false,
              },
            ],
          },
        ],
        modelJobs: [
          ...studyBundle.modelJobs,
          {
            ...studyBundle.modelJobs[1],
            id: "MJ-SEG-REV",
            output: {
              segmentations: [
                {
                  nodule_id: "N1",
                  nodule_index: 1,
                  mask_uri: refreshedMaskUri,
                  segmentation_source: "nnunet_tight_roi",
                  confidence: 0.91,
                },
              ],
            },
            updatedAt: 1778245600000,
          },
          {
            ...studyBundle.modelJobs[2],
            id: "MJ-MEASURE-REV",
            output: {
              measurements: [
                {
                  nodule_id: "N1",
                  nodule_index: 1,
                  measurement_source: "mask",
                  long_axis_mm: 5,
                  short_axis_mm: 5,
                  area_mm2: 25,
                  aspect_ratio: 1,
                  confidence: 0.9,
                },
              ],
            },
            updatedAt: 1778245600000,
          },
        ],
        auditLogs: [
          {
            id: "A-REV",
            studyId: "S1",
            actorType: "doctor",
            actorId: "web-test",
            action: "medical.nodule.revise",
            targetType: "nodule",
            targetId: "N1",
            detail: {
              before: {
                id: "N1",
                nodule_index: 1,
                bbox: [10, 20, 30, 40],
                mask_uri: "artifact://model-output/S1/IMG1/MJ-SEG/mask.png",
              },
              after: {
                id: "N1",
                nodule_index: 1,
                bbox: [12, 22, 32, 42],
                mask_uri: refreshedMaskUri,
              },
            },
            traceId: "N1",
            createdAt: revisionCreatedAt,
          },
        ],
      },
    });
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    expect(await screen.findByText("Revision Evidence Diff")).toBeInTheDocument();
    expect(screen.getByText("refreshed")).toBeInTheDocument();
    expect(screen.getByText("5.00 mm x 5.00 mm")).toBeInTheDocument();
    expect(screen.getByText("tirads_result, segmentation_result, measurement_result")).toBeInTheDocument();
    expect(screen.getAllByText(refreshedMaskUri).length).toBeGreaterThan(0);
    expect(screen.getAllByText("R-REV").length).toBeGreaterThan(0);
  });

  it("does not mark refreshed evidence when the audit bbox does not match the model basis", async () => {
    vi.mocked(getMedicalStudy).mockResolvedValueOnce({
      bundle: {
        ...studyBundle,
        nodules: [
          {
            ...studyBundle.nodules[0],
            bbox: [112, 64, 214, 172],
            source: "doctor",
            status: "doctor_revised",
            updatedAt: 1778245600000,
          },
        ],
        measurements: [
          {
            ...studyBundle.measurements[0],
            longAxisMm: 25.25,
            shortAxisMm: 20,
            areaMm2: 386.625,
            createdAt: 1778245600000,
          },
        ],
        reports: [
          {
            ...studyBundle.reports[0],
            id: "R-MISMATCH",
            updatedAt: 1778245700000,
            evidence: [
              {
                source: "segmentation_result",
                nodule_id: "N1",
                nodule_index: 1,
                mask_uri: "artifact://model-output/web-smoke/mismatch-mask.png",
                metadata: {
                  prompt_bbox: [112, 64, 214, 172],
                  crop_box_xyxy: [93, 48, 233, 188],
                },
              },
              {
                source: "measurement_result",
                nodule_id: "N1",
                nodule_index: 1,
                long_axis_mm: 25.25,
                short_axis_mm: 20,
              },
            ],
          },
        ],
        auditLogs: [
          {
            id: "A-MISMATCH",
            studyId: "S1",
            actorType: "doctor",
            actorId: "web-test",
            action: "medical.nodule.revise",
            targetType: "nodule",
            targetId: "N1",
            detail: {
              before: { id: "N1", nodule_index: 1, bbox: [95, 52, 201, 158] },
              after: { id: "N1", nodule_index: 1, bbox: [112, 63.85, 112, 63.85] },
            },
            traceId: "N1",
            createdAt: 1778245400000,
          },
        ],
      },
    });
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    expect(await screen.findByText("Revision Evidence Diff")).toBeInTheDocument();
    expect(screen.getByText("invalid revision bbox")).toBeInTheDocument();
    expect(screen.getAllByText("pending refresh").length).toBeGreaterThan(0);
  });

  it("blocks zero-area manual bbox revisions before calling the API", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    await waitFor(() => expect(screen.getAllByText("Nodule 1").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("bbox xyxy"), { target: { value: "12, 22, 12, 42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));

    expect(await screen.findByText("bbox 宽度和高度至少需要 1 像素，请重新拖拽框选。")).toBeInTheDocument();
    expect(reviseMedicalNodule).not.toHaveBeenCalled();
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
