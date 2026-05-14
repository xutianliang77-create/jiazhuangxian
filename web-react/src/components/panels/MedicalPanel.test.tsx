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
  submitMedicalTiradsFeatures: vi.fn(),
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
  submitMedicalTiradsFeatures,
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
      queueStage: "pending_report_review",
      queueReason: "等待医生审核报告草稿",
      queuePriority: 10,
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
          source: "tirads_rule",
          rule_code: "ACR_2017_category_TR4",
          system_name: "ACR_TI_RADS",
          system_version: "2017",
          category: "TR4",
          points: 4,
          recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
        },
        {
          source: "medical_guideline",
          chunk_id: "medical/doc-acr-tirads-2017/tr4",
          text: "TR4 nodules require size-based follow-up or FNA according to ACR TI-RADS.",
          document: {
            title: "ACR TI-RADS 2017",
            fileUri: "artifact://knowledge/acr.pdf",
          },
          metadata: {
            sectionTitle: "TR4",
            relPath: "examples/medical-knowledge/acr.md",
            lineStart: 10,
            lineEnd: 20,
          },
        },
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
        draftText: "医生修订后的甲状腺超声报告",
        finalText: "医生修订后的甲状腺超声报告",
        structured: {
          ...studyBundle.reports[0].structured,
          sections: [
            { id: "line-1", title: "段落 1", text: "医生修订后的甲状腺超声报告", includeTitle: false },
          ],
        },
        confirmedBy: "web-test",
        confirmedAt: 1778245300000,
      },
      doctorReview: {
        id: "DR1",
        reportId: "R1",
        reviewerName: "web-test",
        action: "approve",
        comment: null,
        before: {
          status: "draft",
          draft_text: studyBundle.reports[0].draftText,
          evidence_count: 5,
          evidence_sources: [
            "tirads_result",
            "tirads_rule",
            "medical_guideline",
            "segmentation_result",
            "measurement_result",
          ],
        },
        after: {
          status: "confirmed",
          draft_text: "医生修订后的甲状腺超声报告",
          final_text: "医生修订后的甲状腺超声报告",
          evidence_count: 5,
          evidence_sources: [
            "tirads_result",
            "tirads_rule",
            "medical_guideline",
            "segmentation_result",
            "measurement_result",
          ],
        },
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
            draftText: "医生修订后的甲状腺超声报告",
            finalText: "医生修订后的甲状腺超声报告",
            structured: {
              ...studyBundle.reports[0].structured,
              sections: [
                { id: "line-1", title: "段落 1", text: "医生修订后的甲状腺超声报告", includeTitle: false },
              ],
            },
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
            before: {
              status: "draft",
              draft_text: studyBundle.reports[0].draftText,
              evidence_count: 5,
              evidence_sources: [
                "tirads_result",
                "tirads_rule",
                "medical_guideline",
                "segmentation_result",
                "measurement_result",
              ],
            },
            after: {
              status: "confirmed",
              draft_text: studyBundle.reports[0].draftText,
              final_text: "医生修订后的甲状腺超声报告",
              evidence_count: 5,
              evidence_sources: [
                "tirads_result",
                "tirads_rule",
                "medical_guideline",
                "segmentation_result",
                "measurement_result",
              ],
            },
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

    expect(await screen.findByText("医生工作台")).toBeInTheDocument();
    expect(screen.getByText("病例工作队列")).toBeInTheDocument();
    expect(screen.getByText("患者")).toBeInTheDocument();
    expect(screen.getByText("检查")).toBeInTheDocument();
    expect(screen.getByText("ACC-1")).toBeInTheDocument();
    expect(screen.getByText("US/thyroid")).toBeInTheDocument();
    expect(screen.getAllByText("运行中").length).toBeGreaterThan(0);
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.getByText("模型任务")).toBeInTheDocument();
    expect(screen.getByText("智能体任务")).toBeInTheDocument();
    expect(screen.getByText("模型网关")).toBeInTheDocument();
    expect(screen.getByText("yolov11")).toBeInTheDocument();
    expect(screen.getByText("手工登记病例")).toBeInTheDocument();
    expect(screen.getByText("知识证据")).toBeInTheDocument();
  });

  it("filters the case work queue by stage", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        summary.recentStudies[0],
        {
          ...summary.recentStudies[0],
          id: "S2",
          accessionNo: "ACC-2",
          latestAnalysisStatus: "queued",
          latestReportStatus: null,
          queueStage: "analysis_in_progress",
          queueReason: "结节检测排队中",
          queuePriority: 50,
        },
      ],
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByRole("button", { name: /S1 ACC-1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /S2 ACC-2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 1/ }));
    expect(screen.getByRole("button", { name: /S1 ACC-1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /S2 ACC-2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /分析中 1/ }));
    expect(screen.getByRole("button", { name: /S2 ACC-2/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /S1 ACC-1/ })).not.toBeInTheDocument();
  });

  it("auto-opens the first matching case when switching queue filters", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245200000,
        },
        {
          ...summary.recentStudies[0],
          id: "S2",
          accessionNo: "ACC-2",
          queueStage: "analysis_in_progress",
          queueReason: "结节检测排队中",
          queuePriority: 50,
          latestAnalysisStatus: "queued",
          latestReportStatus: null,
          updatedAt: 1778245300000,
        },
      ],
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /分析中 1/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
    expect(screen.getByText("当前")).toBeInTheDocument();
  });

  it("shows the batch queue mode bar for review queue", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245200000,
        },
      ],
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 1/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    expect(screen.getByText("批量队列")).toBeInTheDocument();
    expect(screen.getAllByText("待审核报告").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "确认并下一例" })).toBeInTheDocument();
  });

  it("shows an empty queue state with a recommended next queue", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245200000,
        },
      ],
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待确认特征 0/ }));
    expect(screen.getByText("当前队列已清空")).toBeInTheDocument();
    expect(screen.getByText("推荐下一队列：待审核报告")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到 待审核报告" })).toBeInTheDocument();
  });

  it("switches to the recommended queue and auto-opens its first study", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245200000,
        },
      ],
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待确认特征 0/ }));
    fireEvent.click(screen.getByRole("button", { name: "切换到 待审核报告" }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    expect(screen.getByText("批量队列")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并下一例" })).toBeInTheDocument();
  });

  it("navigates to the next study within the filtered work queue", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245200000,
        },
        {
          ...summary.recentStudies[0],
          id: "S2",
          accessionNo: "ACC-2",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245300000,
        },
      ],
    });
    vi.mocked(getMedicalStudy)
      .mockResolvedValueOnce({ bundle: studyBundle })
      .mockResolvedValueOnce({
        bundle: {
          ...studyBundle,
          study: { ...studyBundle.study, id: "S2", accessionNo: "ACC-2" },
        },
      });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 2/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
    fireEvent.click(screen.getAllByRole("button", { name: "下一例" })[0]!);
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
  });

  it("supports queue navigation shortcuts", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245200000,
        },
        {
          ...summary.recentStudies[0],
          id: "S2",
          accessionNo: "ACC-2",
          queueStage: "pending_report_review",
          queueReason: "等待医生审核报告草稿",
          queuePriority: 10,
          updatedAt: 1778245300000,
        },
      ],
    });
    vi.mocked(getMedicalStudy).mockImplementation(async (studyId: string) => ({
      bundle: {
        ...studyBundle,
        study: {
          ...studyBundle.study,
          id: studyId,
          accessionNo: studyId === "S1" ? "ACC-1" : "ACC-2",
        },
      },
    }));

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 2/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
  });

  it("auto-advances to the next review case after confirming a report", async () => {
    vi.mocked(getMedicalSummary)
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245400000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245300000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "ready_archive",
            queueReason: "报告已确认，等待归档",
            queuePriority: 20,
            latestReportStatus: "confirmed",
            updatedAt: 1778245500000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245300000,
          },
        ],
      });
    vi.mocked(getMedicalStudy)
      .mockResolvedValueOnce({ bundle: studyBundle })
      .mockResolvedValueOnce({
        bundle: {
          ...studyBundle,
          study: { ...studyBundle.study, id: "S2", accessionNo: "ACC-2" },
        },
      });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    fireEvent.change(screen.getByLabelText("审核意见"), {
      target: { value: "确认后切下一例" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认报告" }));

    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
  });

  it("runs the batch queue review action button", async () => {
    vi.mocked(getMedicalSummary)
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245400000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245300000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "ready_archive",
            queueReason: "报告已确认，等待归档",
            queuePriority: 20,
            latestReportStatus: "confirmed",
            updatedAt: 1778245500000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245300000,
          },
        ],
      });
    vi.mocked(getMedicalStudy)
      .mockResolvedValueOnce({ bundle: studyBundle })
      .mockResolvedValueOnce({
        bundle: {
          ...studyBundle,
          study: { ...studyBundle.study, id: "S2", accessionNo: "ACC-2" },
        },
      });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 2/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认并下一例" })).not.toBeDisabled());
    await waitFor(() => expect(screen.getByRole("button", { name: "确认报告" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确认并下一例" }));
    await waitFor(() => expect(reviewMedicalReport).toHaveBeenCalled());
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
  });

  it("supports report confirm shortcut and auto-advances", async () => {
    vi.mocked(getMedicalSummary)
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245400000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245300000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "ready_archive",
            queueReason: "报告已确认，等待归档",
            queuePriority: 20,
            latestReportStatus: "confirmed",
            updatedAt: 1778245500000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "pending_report_review",
            queueReason: "等待医生审核报告草稿",
            queuePriority: 10,
            updatedAt: 1778245300000,
          },
        ],
      });
    vi.mocked(getMedicalStudy)
      .mockResolvedValueOnce({ bundle: studyBundle })
      .mockResolvedValueOnce({
        bundle: {
          ...studyBundle,
          study: { ...studyBundle.study, id: "S2", accessionNo: "ACC-2" },
        },
      });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待审核报告 2/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    fireEvent.keyDown(window, { key: "Enter", altKey: true });
    await waitFor(() => expect(reviewMedicalReport).toHaveBeenCalled());
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
  });

  it("supports report archive shortcut", async () => {
    vi.mocked(getMedicalSummary).mockResolvedValueOnce({
      ...summary,
      recentStudies: [
        {
          ...summary.recentStudies[0],
          id: "S1",
          accessionNo: "ACC-1",
          queueStage: "ready_archive",
          queueReason: "报告已确认，等待归档",
          queuePriority: 20,
          latestReportStatus: "confirmed",
          updatedAt: 1778245400000,
        },
      ],
    });
    vi.mocked(getMedicalStudy).mockResolvedValueOnce({
      bundle: {
        ...studyBundle,
        reports: [
          {
            ...studyBundle.reports[0],
            status: "confirmed",
            finalText: "医生确认后的报告",
            draftText: "医生确认后的报告",
            confirmedBy: "web-test",
            confirmedAt: 1778245300000,
          },
        ],
      },
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待归档 1/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    expect(await screen.findByRole("button", { name: "审核归档" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("审核意见"), {
      target: { value: "快捷键归档" },
    });
    fireEvent.keyDown(window, { key: "Enter", altKey: true, shiftKey: true });
    await waitFor(() =>
      expect(reviewMedicalReport).toHaveBeenCalledWith(
        "R1",
        expect.objectContaining({
          action: "archive",
          comment: "快捷键归档",
        })
      )
    );
  });

  it("auto-advances to the next TI-RADS confirmation case after saving features", async () => {
    vi.mocked(getMedicalSummary)
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "waiting_tirads_confirmation",
            queueReason: "等待医生确认 TI-RADS 结构化特征",
            queuePriority: 30,
            latestReportStatus: null,
            updatedAt: 1778245400000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "waiting_tirads_confirmation",
            queueReason: "等待医生确认 TI-RADS 结构化特征",
            queuePriority: 30,
            latestReportStatus: null,
            updatedAt: 1778245300000,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...summary,
        recentStudies: [
          {
            ...summary.recentStudies[0],
            id: "S1",
            accessionNo: "ACC-1",
            queueStage: "analysis_in_progress",
            queueReason: "TI-RADS 规则计算排队中",
            queuePriority: 50,
            latestAnalysisStatus: "queued",
            latestReportStatus: null,
            updatedAt: 1778245500000,
          },
          {
            ...summary.recentStudies[0],
            id: "S2",
            accessionNo: "ACC-2",
            queueStage: "waiting_tirads_confirmation",
            queueReason: "等待医生确认 TI-RADS 结构化特征",
            queuePriority: 30,
            latestReportStatus: null,
            updatedAt: 1778245300000,
          },
        ],
      });
    vi.mocked(getMedicalStudy)
      .mockResolvedValueOnce({
        bundle: {
          ...studyBundle,
          tiradsFeatures: [
            {
              id: "TF1",
              noduleId: "N1",
              systemName: "ACR_TI_RADS",
              features: {
                composition: "solid",
                echogenicity: "isoechoic",
                shape: "wider_than_tall",
                margin: "ill_defined",
                echogenic_foci: ["none"],
              },
              confidence: {},
              sourceModel: "tirads-prefill-heuristic-v2",
              requiresReview: true,
              createdAt: 1778245600000,
            },
          ],
          tiradsResults: [],
        },
      })
      .mockResolvedValueOnce({
        bundle: {
          ...studyBundle,
          study: { ...studyBundle.study, id: "S2", accessionNo: "ACC-2" },
        },
      });
    vi.mocked(submitMedicalTiradsFeatures).mockResolvedValue({
      tiradsFeature: {
        id: "TF2",
        noduleId: "N1",
        systemName: "ACR_TI_RADS",
        features: {
          composition: "solid",
          echogenicity: "isoechoic",
          shape: "wider_than_tall",
          margin: "ill_defined",
          echogenic_foci: ["none"],
        },
        confidence: {},
        sourceModel: "doctor_structured_input",
        requiresReview: false,
        createdAt: 1778245700000,
      },
      analysisSession: null,
      agentTasks: [],
      auditLog: {
        id: "A-TIRADS",
        studyId: "S1",
        actorType: "doctor",
        actorId: "web-test",
        action: "medical.tirads_feature.submit",
        targetType: "nodule",
        targetId: "N1",
        detail: {},
        traceId: "TF2",
        createdAt: 1778245700000,
      },
      bundle: {
        ...studyBundle,
      },
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /待确认特征 2/ }));
    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S1"));
    expect(await screen.findByRole("button", { name: "确认并保存 TI-RADS 特征" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并保存 TI-RADS 特征" }));

    await waitFor(() => expect(getMedicalStudy).toHaveBeenCalledWith("S2"));
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
    expect(screen.getAllByText("结节 1").length).toBeGreaterThan(0);
    expect(screen.getByText("TR4")).toBeInTheDocument();
    expect(screen.getAllByText(/甲状腺超声AI辅助报告/).length).toBeGreaterThan(0);
    expect(screen.getByText("真实演示提示：主报告大模型需手动加载")).toBeInTheDocument();
    expect(screen.getByText("当前报告尚未由主报告大模型生成")).toBeInTheDocument();
    expect(screen.getAllByText("报告依据").length).toBeGreaterThan(0);
    expect(screen.getByText(/证据引用固定 · 5 项 · ev-/)).toBeInTheDocument();
    expect(screen.getByText(/TI-RADS 规则库/)).toBeInTheDocument();
    expect(screen.getByText(/医学知识库/)).toBeInTheDocument();
    expect(screen.getByText("examples/medical-knowledge/acr.md:10-20")).toBeInTheDocument();
    expect(screen.getByText("叠加图修订")).toBeInTheDocument();
    expect(screen.getByText("模型依据")).toBeInTheDocument();
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
    expect(screen.getByText("像素测量 long_axis_px=22, short_axis_px=12")).toBeInTheDocument();
    expect(screen.getAllByText("artifact://model-output/S1/IMG1/MJ-MEASURE/measurement.json").length).toBeGreaterThan(0);
    expect(screen.getByText("需医生复核")).toBeInTheDocument();
    expect(screen.getByText("甲状腺结节检测")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/detections.json")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/overlay.png")).toBeInTheDocument();
    expect(screen.getByText("artifact://model-output/S1/IMG1/MJ1/comparison.json")).toBeInTheDocument();
    expect(screen.getByText("检测模型一致性")).toBeInTheDocument();
    expect(screen.getAllByText("已匹配").length).toBeGreaterThan(0);
    expect(screen.getByText("qwen3.6 · 等待大模型 · 一致")).toBeInTheDocument();
    expect(screen.getByText(/LLM must not create, delete, or move bbox coordinates/)).toBeInTheDocument();
    expect(screen.getByAltText("叠加图修订预览")).toHaveAttribute(
      "src",
      "/v1/web/medical/artifacts?uri=artifact%3A%2F%2Fmodel-output%2FS1%2FIMG1%2FMJ1%2Foverlay.png&token=test-token"
    );
    expect(screen.getByAltText("检测叠加图预览")).toHaveAttribute(
      "src",
      "/v1/web/medical/artifacts?uri=artifact%3A%2F%2Fmodel-output%2FS1%2FIMG1%2FMJ1%2Foverlay.png&token=test-token"
    );
    expect(medicalArtifactUrl).toHaveBeenCalledWith("artifact://model-output/S1/IMG1/MJ1/overlay.png");

    fireEvent.click(screen.getByRole("button", { name: "启动分析" }));

    await waitFor(() => expect(startMedicalAnalysis).toHaveBeenCalledWith("S1", { imageId: "IMG1" }));
    expect(getMedicalStudy).toHaveBeenCalledWith("S1");
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
  });

  it("shows heuristic TI-RADS prefill awaiting doctor confirmation", async () => {
    vi.mocked(getMedicalStudy).mockResolvedValueOnce({
      bundle: {
        ...studyBundle,
        tiradsFeatures: [
          {
            id: "TF1",
            noduleId: "N1",
            systemName: "ACR_TI_RADS",
            features: {
              composition: "solid",
              echogenicity: "isoechoic",
              shape: "wider_than_tall",
              margin: "ill_defined",
              echogenic_foci: ["none"],
            },
            confidence: {
              composition: 0.24,
              echogenicity: 0.18,
              shape: 0.6,
            },
            sourceModel: "tirads-prefill-heuristic-v2",
            requiresReview: true,
            createdAt: 1778245600000,
          },
        ],
        tiradsResults: [],
        agentTasks: [
          {
            id: "AT-TIRADS",
            analysisSessionId: "AS-TIRADS",
            parentTaskId: null,
            agentName: "TiradsRuleAgent",
            taskType: "calculate_tirads",
            status: "queued",
            input: {},
            output: null,
            error: null,
            startedAt: null,
            completedAt: null,
            createdAt: 1778245600000,
            updatedAt: 1778245600000,
          },
        ],
      },
    });

    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    expect(await screen.findByText("已自动预填 TI-RADS 候选，请医生确认后保存。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并保存 TI-RADS 特征" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("实性")).toBeInTheDocument();
    expect(screen.getByDisplayValue("等回声")).toBeInTheDocument();
  });

  it("confirms a report draft from study detail", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    await waitFor(() => expect(screen.getAllByText(/甲状腺超声AI辅助报告/).length).toBeGreaterThan(0));
    expect(screen.getByText("结构化段落编辑")).toBeInTheDocument();
    expect(screen.getByText("报告版本 v1")).toBeInTheDocument();
    expect(screen.getByText("可编辑待审核")).toBeInTheDocument();
    expect(screen.getByText("证据指纹")).toBeInTheDocument();
    expect(screen.getByText("保存报告修订")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("段落内容 1"), {
      target: { value: "医生修订后的甲状腺超声报告" },
    });
    fireEvent.change(screen.getByLabelText("段落内容 2"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("审核意见"), {
      target: { value: "医生已核对图像与证据" },
    });
    expect(screen.getByText("修改痕迹")).toBeInTheDocument();
    expect(screen.getByText("原文片段")).toBeInTheDocument();
    expect(screen.getByText("新文片段")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认报告" }));

    await waitFor(() =>
      expect(reviewMedicalReport).toHaveBeenCalledWith(
        "R1",
        expect.objectContaining({
          action: "approve",
          finalText: "医生修订后的甲状腺超声报告",
          comment: "医生已核对图像与证据",
          structured: expect.objectContaining({
            editor: expect.objectContaining({
              evidence_locked: true,
              evidence_count: 5,
              evidence_fingerprint: expect.stringMatching(/^ev-/),
            }),
            sections: [
              expect.objectContaining({
                id: "line-1",
                text: "医生修订后的甲状腺超声报告",
                includeTitle: false,
              }),
            ],
          }),
        })
      )
    );
    expect(await screen.findByText("已确认")).toBeInTheDocument();
    expect(screen.getAllByText("确认").length).toBeGreaterThan(0);
    expect(screen.getByText("审核历史")).toBeInTheDocument();
    expect(screen.getByText("证据快照")).toBeInTheDocument();
    expect(screen.getByText("审核归档")).toBeInTheDocument();
    expect(screen.getByText("待归档只读")).toBeInTheDocument();
    expect(screen.getAllByText("修改痕迹").length).toBeGreaterThan(0);
    expect(screen.getAllByText("医生修订后的甲状腺超声报告").length).toBeGreaterThan(0);
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);

    vi.mocked(reviewMedicalReport).mockResolvedValueOnce({
      report: {
        ...studyBundle.reports[0],
        status: "archived",
        draftText: "医生修订后的甲状腺超声报告",
        finalText: "医生修订后的甲状腺超声报告",
        confirmedBy: "web-test",
        confirmedAt: 1778245300000,
      },
      doctorReview: {
        id: "DR2",
        reportId: "R1",
        reviewerName: "web-test",
        action: "archive",
        comment: "归档",
        before: { status: "confirmed", evidence_count: 5 },
        after: { status: "archived", evidence_count: 5 },
        createdAt: 1778245400000,
      },
      auditLog: {
        id: "A4",
        studyId: "S1",
        actorType: "doctor",
        actorId: "web-test",
        action: "medical.report.archive",
        targetType: "report",
        targetId: "R1",
        detail: { report_status: "archived", evidence_count: 5 },
        traceId: "DR2",
        createdAt: 1778245400000,
      },
      bundle: {
        ...studyBundle,
        reports: [
          {
            ...studyBundle.reports[0],
            status: "archived",
            finalText: "医生修订后的甲状腺超声报告",
            confirmedBy: "web-test",
            confirmedAt: 1778245300000,
          },
        ],
        doctorReviews: [
          {
            id: "DR2",
            reportId: "R1",
            reviewerName: "web-test",
            action: "archive",
            comment: "归档",
            before: { status: "confirmed", evidence_count: 5 },
            after: { status: "archived", evidence_count: 5 },
            createdAt: 1778245400000,
          },
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("审核意见"), {
      target: { value: "归档" },
    });
    fireEvent.click(screen.getByRole("button", { name: "审核归档" }));

    await waitFor(() =>
      expect(reviewMedicalReport).toHaveBeenLastCalledWith(
        "R1",
        expect.objectContaining({
          action: "archive",
          finalText: "医生修订后的甲状腺超声报告",
          comment: "归档",
        })
      )
    );
    expect(await screen.findByText("已归档")).toBeInTheDocument();
    expect(screen.getByText("只读归档")).toBeInTheDocument();
    expect(screen.getAllByText("归档").length).toBeGreaterThan(0);
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

    fireEvent.click(screen.getByRole("button", { name: "保存叠加图修订" }));

    await waitFor(() =>
      expect(reviseMedicalNodule).toHaveBeenCalledWith("N1", {
        bbox: [12, 22, 32, 42],
        status: "doctor_revised",
      })
    );
    expect(await screen.findByText("医生已修订")).toBeInTheDocument();
    expect(screen.getByText("检测框 10, 20, 30, 40 → 12, 22, 32, 42")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "保存叠加图修订" }));

    expect(await screen.findByText("检测框宽度和高度至少需要 1 像素，请重新拖拽框选。")).toBeInTheDocument();
    expect(reviseMedicalNodule).not.toHaveBeenCalled();
  });

  it("saves a doctor bbox revision for a nodule", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    await waitFor(() => expect(screen.getAllByText("结节 1").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("检测框坐标 xyxy"), { target: { value: "12, 22, 32, 42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));

    await waitFor(() =>
      expect(reviseMedicalNodule).toHaveBeenCalledWith("N1", {
        bbox: [12, 22, 32, 42],
        status: "doctor_revised",
      })
    );
    expect(await screen.findByText("医生已修订")).toBeInTheDocument();
    expect(screen.getAllByText("医生修订结节检测框").length).toBeGreaterThan(0);
    expect(screen.getByText("检测框 10, 20, 30, 40 → 12, 22, 32, 42")).toBeInTheDocument();
    expect(screen.getByText("修订后依据变化")).toBeInTheDocument();
    expect(screen.getAllByText("等待刷新").length).toBeGreaterThan(0);
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

    expect(await screen.findByText("修订后依据变化")).toBeInTheDocument();
    expect(screen.getByText("已刷新")).toBeInTheDocument();
    expect(screen.getByText("5.00 mm x 5.00 mm")).toBeInTheDocument();
    expect(screen.getAllByText("TI-RADS 结果, 分割结果, 测量结果").length).toBeGreaterThan(0);
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

    expect(await screen.findByText("修订后依据变化")).toBeInTheDocument();
    expect(screen.getByText("无效修订框")).toBeInTheDocument();
    expect(screen.getAllByText("等待刷新").length).toBeGreaterThan(0);
  });

  it("prefers server revision evidence when the bundle provides task-chain attribution", async () => {
    const serverMaskUri = "artifact://model-output/web-smoke/server-mask.png";
    vi.mocked(getMedicalStudy).mockResolvedValueOnce({
      bundle: {
        ...studyBundle,
        nodules: [
          {
            ...studyBundle.nodules[0],
            bbox: [12, 22, 32, 42],
            maskUri: serverMaskUri,
            source: "doctor",
            status: "doctor_revised",
            updatedAt: 1778245600000,
          },
        ],
        reports: [],
        auditLogs: [
          {
            id: "A-SERVER",
            studyId: "S1",
            actorType: "doctor",
            actorId: "web-test",
            action: "medical.nodule.revise",
            targetType: "nodule",
            targetId: "N1",
            detail: {
              before: { id: "N1", nodule_index: 1, bbox: [10, 20, 30, 40] },
              after: { id: "N1", nodule_index: 1, bbox: [12, 22, 32, 42] },
              revision_evidence: {
                source: "server_revision_task_chain",
                status: "refreshed",
                new_mask_uri: serverMaskUri,
                measurement: {
                  long_axis_mm: 7,
                  short_axis_mm: 4,
                },
                evidence_sources: ["server_segmentation", "server_measurement"],
                report_id: "R-SERVER",
              },
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

    expect(await screen.findByText("修订后依据变化")).toBeInTheDocument();
    expect(screen.getByText("已刷新")).toBeInTheDocument();
    expect(screen.getByText("7.00 mm x 4.00 mm")).toBeInTheDocument();
    expect(screen.getByText("server_segmentation, server_measurement")).toBeInTheDocument();
    expect(screen.getAllByText(serverMaskUri).length).toBeGreaterThan(0);
    expect(screen.getByText("R-SERVER")).toBeInTheDocument();
  });

  it("blocks zero-area manual bbox revisions before calling the API", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("ACC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ACC-1/ }));

    await waitFor(() => expect(screen.getAllByText("结节 1").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("检测框坐标 xyxy"), { target: { value: "12, 22, 12, 42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));

    expect(await screen.findByText("检测框宽度和高度至少需要 1 像素，请重新拖拽框选。")).toBeInTheDocument();
    expect(reviseMedicalNodule).not.toHaveBeenCalled();
  });

  it("registers a manual patient, study, and image then refreshes", async () => {
    render(<MedicalPanel onError={() => undefined} />);

    expect(await screen.findByText("手工登记病例")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("患者编号"), { target: { value: "EXT-P2" } });
    fireEvent.change(screen.getByLabelText("检查号"), { target: { value: "ACC-2" } });
    fireEvent.change(screen.getByLabelText("图像 URI"), {
      target: { value: "artifact://raw/ACC-2/IMG1.png" },
    });
    fireEvent.change(screen.getByLabelText("出生年"), { target: { value: "1980" } });
    fireEvent.change(screen.getByLabelText("宽度"), { target: { value: "640" } });
    fireEvent.change(screen.getByLabelText("高度"), { target: { value: "480" } });
    fireEvent.change(screen.getByLabelText("临床信息"), { target: { value: "manual validation" } });

    fireEvent.click(screen.getByRole("button", { name: "登记并启动分析" }));

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
    await waitFor(() => expect(startMedicalAnalysis).toHaveBeenCalledWith("S2", {
      imageId: "IMG2",
      triggerSource: "web_manual_case_auto",
    }));
    expect(await screen.findByText("已登记并启动分析 ACC-2")).toBeInTheDocument();
    expect(getMedicalSummary).toHaveBeenCalledTimes(2);
    expect(getMedicalStudy).toHaveBeenCalledWith("S2");
  });

  it("shows form error when manual registration fails", async () => {
    const onError = vi.fn();
    vi.mocked(createMedicalPatient).mockRejectedValue(new Error("duplicate-medical-record"));

    render(<MedicalPanel onError={onError} />);

    expect(await screen.findByText("手工登记病例")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("患者编号"), { target: { value: "EXT-P2" } });
    fireEvent.change(screen.getByLabelText("检查号"), { target: { value: "ACC-2" } });
    fireEvent.change(screen.getByLabelText("图像 URI"), {
      target: { value: "artifact://raw/ACC-2/IMG1.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登记并启动分析" }));

    expect(await screen.findByText("医疗病例登记失败：duplicate-medical-record")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("医疗病例登记失败：duplicate-medical-record");
    expect(startMedicalAnalysis).not.toHaveBeenCalled();
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

    expect(await screen.findByText("医疗数据存储未启用（缺少 data.db）")).toBeInTheDocument();
  });

  it("shows retryable error when summary loading fails", async () => {
    const onError = vi.fn();
    vi.mocked(getMedicalSummary).mockRejectedValue(new Error("offline"));

    render(<MedicalPanel onError={onError} />);

    expect(await screen.findByText("医疗工作台加载失败：offline")).toBeInTheDocument();
    expect(screen.getByText("重试加载")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("医疗工作台加载失败：offline");
  });
});
