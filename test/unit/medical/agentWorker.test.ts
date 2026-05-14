import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMedicalAgentWorkerOnce, runMedicalAgentWorkerOnceAsync } from "../../../src/medical/agentWorker";
import { ingestMedicalKnowledgeManifest, type MedicalKnowledgeManifest } from "../../../src/medical/knowledge/ingestion";
import { MedicalCaseRepo, type AgentTaskRecord } from "../../../src/medical/storage";
import { openRagDb } from "../../../src/rag/store";
import type { ProviderStatus } from "../../../src/provider/types";
import { migrateIfNeeded } from "../../../src/storage/migrate";

let tmpRoot: string;
let db: Database.Database;
let repo: MedicalCaseRepo;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-medical-agent-worker-"));
  db = new Database(path.join(tmpRoot, "data.db"));
  db.pragma("foreign_keys = ON");
  migrateIfNeeded(db, "data");
  repo = new MedicalCaseRepo(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // noop
  }
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("medical agent worker", () => {
  it("runs synchronous tasks and waits for detector model_job completion", () => {
    const { sessionId, tasks } = seedAgentTaskChain(["image_qc", "detect_nodules", "classify_tirads_features"]);

    const first = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2000 });
    expect(first).toMatchObject({ status: "succeeded", claimed: true, taskType: "image_qc" });
    expect(repo.getAgentTask(tasks[0].id)?.status).toBe("succeeded");
    expect(repo.getAnalysisSession(sessionId)?.status).toBe("running");

    const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2100 });
    expect(second).toMatchObject({ status: "waiting_model", claimed: true, taskType: "detect_nodules" });
    expect(second.modelJobId).toBeTruthy();
    expect(repo.getAgentTask(tasks[1].id)?.status).toBe("waiting_model");
    const modelJob = repo.getModelJob(second.modelJobId!);
    expect(modelJob).toMatchObject({
      agentTaskId: tasks[1].id,
      jobType: "thyroid.detect_nodules",
      status: "queued",
      modelName: "rf-detr-medium-thyroid-detector",
      modelVersion: "tn5000-rfdetr-medium-ema",
    });
    expect(modelJob?.input.image_uri).toBe("artifact://raw/ACC-AGENT/IMG1.png");
    expect(modelJob?.input.metadata).toMatchObject({
      model_pipeline: {
        policy_version: "thyroid-gpu-pipeline-v1",
        detector: {
          primary_model: "rf-detr-medium-thyroid-detector",
          comparator_model: "yolov11-thyroid-detector",
        },
      },
    });

    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({ nodules: [{ nodule_index: 1, bbox: [10, 20, 30, 40], confidence: 0.91 }] }),
      2200,
      2200,
      second.modelJobId
    );

    const third = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2300 });
    expect(third).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "detect_nodules",
      output: {
        persisted_nodules: [
          {
            nodule_index: 1,
            bbox: [10, 20, 30, 40],
            detection_confidence: 0.91,
            source: "ai",
          },
        ],
      },
    });
    expect(repo.getAgentTask(tasks[1].id)?.status).toBe("succeeded");
    expect(repo.listNodulesByStudy(String(tasks[1].input.study_id))).toMatchObject([
      {
        noduleIndex: 1,
        imageId: String(tasks[1].input.image_id),
        bbox: [10, 20, 30, 40],
        detectionConfidence: 0.91,
        source: "ai",
      },
    ]);

    const fourth = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2400 });
    expect(fourth).toMatchObject({ status: "succeeded", claimed: true, taskType: "classify_tirads_features" });
    expect(repo.getAgentTask(tasks[2].id)?.status).toBe("succeeded");
    expect(repo.getAnalysisSession(sessionId)?.status).toBe("succeeded");
  });

  it("runs segmentation and measurement model tasks and persists mask and measurements", () => {
    const { sessionId, tasks } = seedAgentTaskChain(["segment_nodules", "measure_nodules"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 50],
      detectionConfidence: 0.9,
      now: 1500,
    });

    const first = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2500 });
    expect(first).toMatchObject({ status: "waiting_model", taskType: "segment_nodules" });
    const segmentJob = repo.getModelJob(first.modelJobId!);
    expect(segmentJob).toMatchObject({
      jobType: "thyroid.segment_nodule",
      input: {
        nodules: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            bbox: [10, 20, 30, 50],
          },
        ],
      },
    });

    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, artifact_uri = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({
        segmentations: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            bbox: [10, 20, 30, 50],
            contour: [[10, 20], [30, 20], [30, 50], [10, 50]],
            mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png",
            confidence: 0.5,
            segmentation_source: "bbox_fallback",
            requires_doctor_review: true,
          },
        ],
        warnings: ["bbox_fallback_segmentation_used"],
      }),
      "artifact://model-output/thyroid-segment-nodule/S/IMG/J/segmentation.json",
      2600,
      2600,
      first.modelJobId
    );

    const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2700 });
    expect(second).toMatchObject({
      status: "succeeded",
      taskType: "segment_nodules",
      output: {
        persisted_segmentations: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png",
          },
        ],
      },
    });
    expect(repo.getNodule(nodule.id)?.maskUri).toBe("artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png");

    const third = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2800 });
    expect(third).toMatchObject({ status: "waiting_model", taskType: "measure_nodules" });
    expect(repo.getModelJob(third.modelJobId!)?.input).toMatchObject({
      nodules: [
        {
          nodule_id: nodule.id,
          mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png",
        },
      ],
    });

    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, artifact_uri = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({
        measurements: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            long_axis_mm: null,
            short_axis_mm: null,
            area_mm2: null,
            aspect_ratio: 1.5,
            measurement_source: "bbox_fallback",
            confidence: 0.5,
            pixel_measurements: { long_axis_px: 30, short_axis_px: 20, area_px2: 600 },
            requires_doctor_review: true,
          },
        ],
        warnings: ["pixel_spacing_missing:mm_measurement_unavailable"],
      }),
      "artifact://model-output/thyroid-measure-nodule/S/IMG/J/measurements.json",
      2900,
      2900,
      third.modelJobId
    );

    const fourth = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3000 });
    expect(fourth).toMatchObject({
      status: "succeeded",
      taskType: "measure_nodules",
      output: {
        persisted_measurements: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            aspect_ratio: 1.5,
            measurement_source: "bbox_fallback",
          },
        ],
      },
    });
    expect(repo.listMeasurementsByStudy(studyId)).toMatchObject([
      {
        noduleId: nodule.id,
        longAxisMm: null,
        shortAxisMm: null,
        areaMm2: null,
        aspectRatio: 1.5,
        measurementSource: "bbox_fallback",
      },
    ]);
    expect(repo.getAnalysisSession(sessionId)?.status).toBe("succeeded");
  });

  it("limits segmentation and measurement model payloads to targeted revised nodules", () => {
    const { tasks } = seedAgentTaskChain(["segment_nodules", "measure_nodules"], {
      segment_nodules: { target_nodule_ids: ["N-TARGET-2"], allow_bbox_fallback: false },
      measure_nodules: { target_nodule_ids: ["N-TARGET-2"] },
    });
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    repo.upsertNodule({
      id: "N-TARGET-1",
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 50],
      detectionConfidence: 0.9,
      now: 1500,
    });
    const target = repo.upsertNodule({
      id: "N-TARGET-2",
      studyId,
      imageId,
      noduleIndex: 2,
      bbox: [120, 80, 168, 140],
      detectionConfidence: 0.88,
      now: 1501,
    });

    const first = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2900 });
    expect(first).toMatchObject({ status: "waiting_model", taskType: "segment_nodules" });
    expect(repo.getModelJob(first.modelJobId!)?.input).toMatchObject({
      allow_bbox_fallback: false,
      nodules: [
        {
          nodule_id: target.id,
          nodule_index: 2,
          bbox: [120, 80, 168, 140],
        },
      ],
    });

    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, artifact_uri = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({
        segmentations: [
          {
            nodule_id: target.id,
            nodule_index: 2,
            mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_2.png",
            confidence: 0.84,
            segmentation_source: "nnunet-tight-roi",
          },
        ],
      }),
      "artifact://model-output/thyroid-segment-nodule/S/IMG/J/segmentation.json",
      3000,
      3000,
      first.modelJobId
    );

    const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3100 });
    expect(second).toMatchObject({ status: "succeeded", taskType: "segment_nodules" });

    const third = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3200 });
    expect(third).toMatchObject({ status: "waiting_model", taskType: "measure_nodules" });
    expect(repo.getModelJob(third.modelJobId!)?.input).toMatchObject({
      nodules: [
        {
          nodule_id: target.id,
          nodule_index: 2,
          bbox: [120, 80, 168, 140],
          mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_2.png",
        },
      ],
    });
  });

  it("auto queues nnU-Net segmentation and measurement when downstream tasks are not explicit", () => {
    const { sessionId, tasks } = seedAgentTaskChain(["detect_nodules"]);
    const studyId = String(tasks[0].input.study_id);

    const first = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3100 });
    expect(first).toMatchObject({ status: "waiting_model", taskType: "detect_nodules" });

    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({ nodules: [{ nodule_index: 1, bbox: [10, 20, 30, 50], confidence: 0.91 }] }),
      3200,
      3200,
      first.modelJobId
    );

    const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3300 });
    expect(second).toMatchObject({
      status: "succeeded",
      taskType: "detect_nodules",
      output: {
        auto_queued_task: {
          task_type: "segment_nodules",
          parent_task_id: tasks[0].id,
          input: {
            model: "nnunet-tight-roi-segmenter",
            model_version: "tn3k-tight-roi-5fold-best",
          },
        },
      },
    });

    const segmentTask = repo
      .getStudyBundle(studyId)
      ?.agentTasks.find((task) => task.taskType === "segment_nodules");
    expect(segmentTask).toMatchObject({ parentTaskId: tasks[0].id, status: "queued" });

    const third = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3400 });
    expect(third).toMatchObject({ status: "waiting_model", taskType: "segment_nodules" });
    const segmentJob = repo.getModelJob(third.modelJobId!);
    expect(segmentJob).toMatchObject({
      jobType: "thyroid.segment_nodule",
      modelName: "nnunet-tight-roi-segmenter",
      input: {
        nodules: [
          {
            nodule_index: 1,
            bbox: [10, 20, 30, 50],
          },
        ],
      },
    });

    const nodule = repo.listNodulesByStudy(studyId)[0];
    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, artifact_uri = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({
        segmentations: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            bbox: [10, 20, 30, 50],
            mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png",
            confidence: 0.9,
            segmentation_source: "nnunet_tight_roi",
            requires_doctor_review: false,
            metadata: { crop_box_xyxy: [8, 18, 32, 52], roi_size: [384, 384] },
          },
        ],
      }),
      "artifact://model-output/thyroid-segment-nodule/S/IMG/J/segmentation.json",
      3500,
      3500,
      third.modelJobId
    );

    const fourth = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3600 });
    expect(fourth).toMatchObject({
      status: "succeeded",
      taskType: "segment_nodules",
      output: {
        auto_queued_task: {
          task_type: "measure_nodules",
          parent_task_id: segmentTask?.id,
        },
      },
    });

    const fifth = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3700 });
    expect(fifth).toMatchObject({ status: "waiting_model", taskType: "measure_nodules" });
    expect(repo.getModelJob(fifth.modelJobId!)?.input).toMatchObject({
      nodules: [
        {
          nodule_id: nodule.id,
          mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png",
        },
      ],
    });
    expect(repo.getAnalysisSession(sessionId)?.status).toBe("running");
  });

  it("defaults automatic segmentation to strict real GPU mode when enabled", () => {
    const previous = process.env.JZX_MEDICAL_REAL_INFERENCE;
    process.env.JZX_MEDICAL_REAL_INFERENCE = "1";
    try {
      const { tasks } = seedAgentTaskChain(["detect_nodules"]);
      const first = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3100 });
      expect(first).toMatchObject({ status: "waiting_model", taskType: "detect_nodules" });

      db.prepare(
        `UPDATE model_job
         SET status = 'succeeded', output_json = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        JSON.stringify({ nodules: [{ nodule_index: 1, bbox: [10, 20, 30, 50], confidence: 0.91 }] }),
        3200,
        3200,
        first.modelJobId
      );

      const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3300 });
      expect(second).toMatchObject({
        status: "succeeded",
        taskType: "detect_nodules",
        output: {
          auto_queued_task: {
            task_type: "segment_nodules",
            parent_task_id: tasks[0].id,
            input: {
              allow_bbox_fallback: false,
            },
          },
        },
      });

      const third = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3400 });
      expect(third).toMatchObject({ status: "waiting_model", taskType: "segment_nodules" });
      expect(repo.getModelJob(third.modelJobId!)?.input).toMatchObject({
        allow_bbox_fallback: false,
        metadata: {
          model_pipeline: {
            strict_real_inference: true,
            segmentation: {
              bbox_fallback_allowed: false,
            },
          },
        },
      });
    } finally {
      if (previous === undefined) {
        delete process.env.JZX_MEDICAL_REAL_INFERENCE;
      } else {
        process.env.JZX_MEDICAL_REAL_INFERENCE = previous;
      }
    }
  });

  it("fails the detector task and blocks downstream tasks when model_job fails", () => {
    const { sessionId, tasks } = seedAgentTaskChain(["detect_nodules", "draft_report"]);

    const first = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3000 });
    expect(first.status).toBe("waiting_model");

    db.prepare(
      `UPDATE model_job
       SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(JSON.stringify({ code: "detector_not_configured" }), 3100, 3100, first.modelJobId);

    const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 3200 });
    expect(second).toMatchObject({ status: "failed", claimed: true, taskType: "detect_nodules" });
    expect(repo.getAgentTask(tasks[0].id)?.status).toBe("failed");
    expect(repo.getAgentTask(tasks[1].id)?.status).toBe("blocked");
    expect(repo.getAnalysisSession(sessionId)?.status).toBe("failed");
  });

  it("uses a CodeClaw provider to evaluate detector consensus without changing bboxes", async () => {
    const providerCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const { tasks } = seedAgentTaskChain(["detect_nodules"]);

    const first = await runMedicalAgentWorkerOnceAsync(repo, { workerId: "worker-test", now: () => 3300 });
    expect(first.status).toBe("waiting_model");

    db.prepare(
      `UPDATE model_job
       SET status = 'succeeded', output_json = ?, artifact_uri = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({
        nodules: [{ nodule_index: 1, bbox: [10, 20, 30, 40], confidence: 0.94 }],
        comparison: {
          consensus: {
            status: "matched",
            matched_count: 1,
            primary_only_count: 0,
            comparator_only_count: 0,
            primary_count: 1,
            comparator_count: 1,
          },
        },
        llm_evaluation: {
          status: "pending_llm",
          intended_model: "qwen3.6",
          overall_assessment: "consistent",
          constraints: ["LLM must not create, delete, or move bbox coordinates."],
        },
      }),
      "artifact://model-output/S1/IMG1/MJ1/detections.json",
      3400,
      3400,
      first.modelJobId
    );

    const second = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 3500,
      llmProvider: qwenProvider(),
      llmFetchImpl: async (url, init) => {
        providerCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return openAiSseResponse({
          status: "reviewed",
          overall_assessment: "consistent",
          summary_zh: "RF-DETR 与 YOLO 检测框一致，医生可常规复核。",
          doctor_review_focus: ["核对 overlay 与原图中的结节边界。"],
          warnings: [],
          bbox_policy: "must_not_modify_bbox",
        });
      },
    });

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({
      url: "http://qwen.test/v1/chat/completions",
      body: {
        model: "qwen3.6",
        stream: true,
      },
    });
    expect(JSON.stringify(providerCalls[0].body)).toContain("must_not_modify_bbox");
    expect(second).toMatchObject({
      status: "succeeded",
      taskType: "detect_nodules",
      output: {
        persisted_nodules: [{ bbox: [10, 20, 30, 40], detection_confidence: 0.94 }],
        result: {
          llm_provider_evaluation: {
            status: "reviewed",
            overall_assessment: "consistent",
            bbox_policy: "must_not_modify_bbox",
            provider: {
              instance_id: "openai:qwen36",
              model: "qwen3.6",
            },
          },
        },
      },
    });
    expect(repo.listNodulesByStudy(String(tasks[0].input.study_id))[0]).toMatchObject({
      bbox: [10, 20, 30, 40],
    });
    expect(repo.listAuditLogsByStudy(String(tasks[0].input.study_id))).toMatchObject([
      {
        actorType: "agent",
        actorId: "worker-test",
        action: "medical.detector.llm_evaluation",
        targetType: "model_job",
        targetId: first.modelJobId,
        detail: {
          provider: {
            instance_id: "openai:qwen36",
            model: "qwen3.6",
          },
          result: {
            overall_assessment: "consistent",
          },
        },
      },
    ]);
  });

  it("calls image-worker for image_qc through the async worker", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const { tasks } = seedAgentTaskChain(["image_qc"]);

    const first = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 4000,
      imageWorkerUrl: "http://worker.test/",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return jsonResponse({
          status: "ok",
          result: {
            quality_score: 0.88,
            is_analyzable: true,
            issues: ["low_contrast"],
            width: 640,
            height: 480,
          },
          warnings: ["mild_probe_shadow"],
          trace_id: tasks[0].id,
        });
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "http://worker.test/image/v1/image-quality-check",
      body: {
        image_uri: "artifact://raw/ACC-AGENT/IMG1.png",
        trace_id: tasks[0].id,
        metadata: {
          file_type: "png",
          width: 640,
          height: 480,
        },
      },
    });
    expect(first).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "image_qc",
      output: {
        validation_mode: false,
        result: {
          image_worker_status: "ok",
          image_quality: "analyzable",
          quality_score: 0.88,
          is_analyzable: true,
          issues: ["low_contrast"],
        },
        warnings: ["mild_probe_shadow"],
      },
    });

    const image = repo.getImage(String(tasks[0].input.image_id));
    expect(image).toMatchObject({
      imageQuality: "analyzable",
      qualityScore: 0.88,
      processingStatus: "qc_completed",
    });
    expect(repo.getAnalysisSession(String(tasks[0].analysisSessionId))?.status).toBe("succeeded");
  });

  it("keeps image_qc non-blocking when image-worker is unreachable", async () => {
    const { tasks } = seedAgentTaskChain(["image_qc", "detect_nodules"]);

    const first = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 5000,
      imageWorkerUrl: "http://worker.test",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    expect(first).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "image_qc",
      output: {
        validation_mode: true,
        result: {
          image_worker_status: "error",
          image_quality: "unchecked",
          quality_score: null,
          processing_status: "uploaded",
          image_worker_error: { code: "image_worker_unreachable", message: "offline" },
        },
        warnings: ["image_worker_qc_unavailable", "image_worker_unreachable"],
      },
    });
    expect(repo.getImage(String(tasks[0].input.image_id))?.processingStatus).toBe("uploaded");

    const second = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 5100 });
    expect(second).toMatchObject({ status: "waiting_model", claimed: true, taskType: "detect_nodules" });
  });

  it("queues and syncs model tasks through a remote model-gateway", async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const { tasks } = seedAgentTaskChain(["detect_nodules", "classify_tirads_features"]);
    const remoteUrl = "http://5090.test";
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url: String(url), method, body });
      if (method === "POST") {
        return jsonResponse({
          status: "ok",
          result: {
            job: {
              id: "remote-detect-1",
              status: "queued",
              job_type: "thyroid.detect_nodules",
              model_name: "rf-detr-medium-thyroid-detector",
              model_version: "tn5000-rfdetr-medium-ema",
              attempts: 0,
              max_attempts: 1,
              input: body,
            },
          },
          warnings: ["queued_on_5090"],
        });
      }
      return jsonResponse({
        status: "ok",
        result: {
          job: {
            id: "remote-detect-1",
            status: "succeeded",
            job_type: "thyroid.detect_nodules",
            model_name: "rf-detr-medium-thyroid-detector",
            model_version: "tn5000-rfdetr-medium-ema",
            attempts: 1,
            max_attempts: 1,
            artifact_uri: "artifact://model-output/remote/detections.json",
            input: {
              study_id: tasks[0].input.study_id,
              image_id: tasks[0].input.image_id,
              image_uri: "artifact://raw/ACC-AGENT/IMG1.png",
            },
            output: {
              nodules: [{ nodule_index: 1, bbox: [12, 18, 42, 58], confidence: 0.88 }],
              comparison: { consensus: { status: "matched" } },
            },
            error: null,
            started_at: 6100,
            completed_at: 6200,
          },
        },
      });
    };

    const first = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 6000,
      remoteModelGatewayUrl: remoteUrl,
      modelGatewayFetchImpl: fetchImpl,
    });

    expect(first).toMatchObject({
      status: "waiting_model",
      claimed: true,
      taskType: "detect_nodules",
      modelJobId: "remote-detect-1",
      output: {
        remote_model_gateway_url: remoteUrl,
        remote_job_id: "remote-detect-1",
      },
    });
    expect(calls[0]).toMatchObject({
      url: "http://5090.test/model/v1/infer/thyroid/detect-nodules",
      method: "POST",
      body: {
        study_id: tasks[0].input.study_id,
        image_id: tasks[0].input.image_id,
        image_uri: "artifact://raw/ACC-AGENT/IMG1.png",
        model: "rf-detr-medium-thyroid-detector",
        model_version: "tn5000-rfdetr-medium-ema",
      },
    });
    expect(repo.getModelJob("remote-detect-1")).toMatchObject({
      status: "queued",
      input: {
        remote_model_gateway: {
          url: remoteUrl,
          job_id: "remote-detect-1",
        },
      },
    });

    const second = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 6300,
      remoteModelGatewayUrl: remoteUrl,
      modelGatewayFetchImpl: fetchImpl,
    });

    expect(calls[1]).toMatchObject({
      url: "http://5090.test/model/v1/jobs/remote-detect-1",
      method: "GET",
    });
    expect(second).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "detect_nodules",
      modelJobId: "remote-detect-1",
      output: {
        artifact_uri: "artifact://model-output/remote/detections.json",
        persisted_nodules: [
          {
            nodule_index: 1,
            bbox: [12, 18, 42, 58],
            detection_confidence: 0.88,
          },
        ],
      },
    });
    expect(repo.getModelJob("remote-detect-1")).toMatchObject({
      status: "succeeded",
      artifactUri: "artifact://model-output/remote/detections.json",
      output: {
        nodules: [{ nodule_index: 1, bbox: [12, 18, 42, 58], confidence: 0.88 }],
      },
    });
  });

  it("calculates ACR TI-RADS from persisted structured features", () => {
    const { tasks } = seedAgentTaskChain(["calculate_tirads"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.91,
      now: 6000,
    });
    const feature = repo.createTiradsFeature({
      noduleId: nodule.id,
      features: {
        composition: "solid",
        echogenicity: "hypoechoic",
        shape: "taller_than_wide",
        margin: "irregular",
        echogenic_foci: ["punctate_echogenic_foci"],
        size_mm: { long_axis: 12, short_axis: 8, ap_axis: 10 },
      },
      confidence: { composition: 0.93 },
      sourceModel: "tc-vit-validation",
      now: 6100,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 6200 });

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "calculate_tirads",
      output: {
        validation_mode: false,
        result: {
          rule_status: "calculated",
          system_name: "ACR_TI_RADS",
          system_version: "2017",
          tirads_results: [
            {
              nodule_id: nodule.id,
              nodule_index: 1,
              feature_id: feature.id,
              score: 12,
              category: "TR5",
              recommendation_code: "fna",
            },
          ],
        },
      },
    });
    expect(repo.listTiradsResultsByStudy(studyId)).toMatchObject([
      {
        noduleId: nodule.id,
        systemName: "ACR_TI_RADS",
        systemVersion: "2017",
        score: 12,
        category: "TR5",
      },
    ]);
  });

  it("persists a draft report from structured TI-RADS results", () => {
    const { tasks } = seedAgentTaskChain(["draft_report"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.91,
      now: 8000,
    });
    const tiradsResult = repo.createTiradsResult({
      noduleId: nodule.id,
      score: 4,
      category: "TR4",
      recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
      evidenceRules: [{ rule_code: "ACR_2017_category_TR4" }],
      warnings: [],
      now: 8100,
    });
    repo.updateNoduleMask(nodule.id, "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png", 8110);
    repo.createModelJob({
      studyId,
      imageId,
      jobType: "thyroid.segment_nodule",
      status: "succeeded",
      modelName: "nnunet-tight-roi-segmenter",
      modelVersion: "tn3k-tight-roi-5fold-best",
      artifactUri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/segmentation.json",
      output: {
        segmentations: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            mask_uri: "artifact://model-output/thyroid-segment-nodule/S/IMG/J/mask_nodule_1.png",
            segmentation_source: "nnunet_tight_roi",
            confidence: 0.9,
            requires_doctor_review: false,
            metadata: { crop_box_xyxy: [8, 18, 32, 52], roi_size: [384, 384] },
          },
        ],
      },
      completedAt: 8120,
      now: 8120,
    });
    repo.createModelJob({
      studyId,
      imageId,
      jobType: "thyroid.measure_nodule",
      status: "succeeded",
      modelName: "mask-measurement-worker",
      modelVersion: "validation-measurement-v1",
      artifactUri: "artifact://model-output/thyroid-measure-nodule/S/IMG/J/measurements.json",
      output: {
        measurements: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            long_axis_mm: 11,
            short_axis_mm: 7,
            area_mm2: 63,
            aspect_ratio: 1.57,
            measurement_source: "mask",
            confidence: 0.9,
            pixel_measurements: { long_axis_px: 110, short_axis_px: 70, area_px2: 6300 },
            requires_doctor_review: false,
          },
        ],
      },
      completedAt: 8130,
      now: 8130,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 8200 });

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "draft_report",
      output: {
        validation_mode: false,
        result: {
          report_status: "draft",
          template_id: "tpl-thyroid-ultrasound-draft-v1",
          structured: {
            generator: "structured_template_validation",
            review_required: true,
            model_evidence: {
              segmentation_count: 1,
              measurement_count: 1,
            },
            nodules: [
              {
                nodule_id: nodule.id,
                nodule_index: 1,
                tirads_result_id: tiradsResult.id,
                score: 4,
                category: "TR4",
                segmentation: {
                  segmentation_source: "nnunet_tight_roi",
                },
                measurement: {
                  measurement_source: "mask",
                  long_axis_mm: 11,
                },
              },
            ],
          },
        },
        warnings: ["doctor_review_required"],
      },
    });
    const outputResult = result.output?.result as Record<string, unknown>;
    expect(outputResult.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "tirads_result",
          nodule_id: nodule.id,
          tirads_result_id: tiradsResult.id,
          evidence_rules: [{ rule_code: "ACR_2017_category_TR4" }],
        }),
        expect.objectContaining({ source: "tirads_rule", rule_code: "ACR_2017_category_TR4" }),
        expect.objectContaining({
          source: "segmentation_result",
          nodule_id: nodule.id,
          segmentation_source: "nnunet_tight_roi",
          metadata: { crop_box_xyxy: [8, 18, 32, 52], roi_size: [384, 384] },
        }),
        expect.objectContaining({
          source: "measurement_result",
          nodule_id: nodule.id,
          measurement_source: "mask",
          long_axis_mm: 11,
        }),
      ])
    );
    expect(String(outputResult.draft_text)).toContain("甲状腺超声AI辅助报告（草稿）");
    expect(String(outputResult.draft_text)).toContain("TI-RADS TR4");
    expect(String(outputResult.draft_text)).toContain("模型依据");
    expect(String(outputResult.draft_text)).toContain("nnunet_tight_roi");
    expect(String(outputResult.draft_text)).toContain("需医生审核确认后生效");

    expect(repo.listReportsByStudy(studyId)).toMatchObject([
      {
        studyId,
        analysisSessionId: tasks[0].analysisSessionId,
        status: "draft",
        templateId: "tpl-thyroid-ultrasound-draft-v1",
        createdByAgent: "worker-test",
        structured: {
          nodules: [
            {
              nodule_id: nodule.id,
              tirads_result_id: tiradsResult.id,
              category: "TR4",
            },
          ],
        },
      },
    ]);
  });

  it("retrieves knowledge evidence before drafting a report", () => {
    const ragHandle = openRagDb(tmpRoot, { path: path.join(tmpRoot, "rag.db") });
    try {
      ingestMedicalKnowledgeManifest(db, ragHandle.db, reportKnowledgeManifest(), {
        jobId: "job-agent-report-knowledge-1",
        workspaceRelPath: "examples/medical-knowledge/agent-report-knowledge.md",
        now: 8250,
      });
      const { tasks } = seedAgentTaskChain(["draft_report"]);
      const studyId = String(tasks[0].input.study_id);
      const imageId = String(tasks[0].input.image_id);
      const nodule = repo.upsertNodule({
        studyId,
        imageId,
        noduleIndex: 1,
        bbox: [10, 20, 30, 40],
        detectionConfidence: 0.91,
        now: 8300,
      });
      repo.createTiradsResult({
        noduleId: nodule.id,
        score: 4,
        category: "TR4",
        recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
        evidenceRules: [{ rule_code: "ACR_2017_category_TR4" }],
        warnings: [],
        now: 8400,
      });

      const result = runMedicalAgentWorkerOnce(repo, {
        workerId: "worker-test",
        now: () => 8500,
        dataDbPath: path.join(tmpRoot, "data.db"),
        ragDbPath: ragHandle.path,
        workspace: tmpRoot,
      });

      const outputResult = result.output?.result as Record<string, unknown>;
      expect(outputResult.draft_text).toContain("知识库");
      expect(outputResult.structured).toMatchObject({
        knowledge_evidence: {
          tirads_rule_count: 1,
          guideline_chunk_count: 1,
          warnings: [],
        },
      });
      expect(outputResult.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "tirads_rule", rule_code: "ACR_2017_category_TR4" }),
          expect.objectContaining({
            source: "medical_guideline",
            chunk_id: "medical/doc-agent-report-knowledge-v1/tr4-management",
          }),
        ])
      );

      const report = repo.listReportsByStudy(studyId)[0];
      expect(report.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "tirads_rule", rule_code: "ACR_2017_category_TR4" }),
          expect.objectContaining({ source: "medical_guideline" }),
        ])
      );
    } finally {
      ragHandle.close();
    }
  });

  it("uses a CodeClaw provider to draft reports without bypassing doctor review", async () => {
    const providerCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const { tasks } = seedAgentTaskChain(["draft_report"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.91,
      now: 8300,
    });
    const tiradsResult = repo.createTiradsResult({
      noduleId: nodule.id,
      score: 4,
      category: "TR4",
      recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
      evidenceRules: [{ rule_code: "ACR_2017_category_TR4" }],
      warnings: [],
      now: 8400,
    });

    const result = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 8500,
      llmProvider: qwenProvider(),
      llmFetchImpl: async (url, init) => {
        providerCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return openAiSseResponse({
          status: "drafted",
          draft_text: [
            "甲状腺超声AI辅助报告（草稿）",
            "",
            "检查所见：甲状腺超声图像已完成AI辅助分析。",
            "结节描述：结节1：AI检测结节，TI-RADS TR4，评分4分。",
            "建议：TR4 nodule >=10 mm: ultrasound follow-up.",
            "证据：ACR_2017_category_TR4",
            "提示：本报告为AI辅助草稿，需医生审核确认后生效。",
          ].join("\n"),
          doctor_review_required: true,
          warnings: [],
          limitations: ["仅根据结构化结果生成草稿。"],
        });
      },
    });

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({
      url: "http://qwen.test/v1/chat/completions",
      body: {
        model: "qwen3.6",
        stream: true,
      },
    });
    expect(JSON.stringify(providerCalls[0].body)).toContain("draft_thyroid_ultrasound_report");
    expect(JSON.stringify(providerCalls[0].body)).toContain("doctor_review_required");

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "draft_report",
      output: {
        validation_mode: false,
        result: {
          report_status: "draft",
          structured: {
            generator: "llm_provider_structured_report",
            llm_provider_report: {
              status: "drafted",
              doctor_review_required: true,
            },
            nodules: [
              {
                nodule_id: nodule.id,
                tirads_result_id: tiradsResult.id,
                category: "TR4",
              },
            ],
          },
          llm_provider_report: {
            status: "drafted",
            provider: {
              instance_id: "openai:qwen36",
              model: "qwen3.6",
            },
          },
        },
        warnings: ["doctor_review_required"],
      },
    });
    const outputResult = result.output?.result as Record<string, unknown>;
    expect(String(outputResult.draft_text)).toContain("甲状腺超声AI辅助报告（草稿）");
    expect(String(outputResult.draft_text)).toContain("需医生审核确认后生效");

    expect(repo.listReportsByStudy(studyId)).toMatchObject([
      {
        status: "draft",
        draftText: outputResult.draft_text,
        structured: {
          generator: "llm_provider_structured_report",
          provider: {
            instance_id: "openai:qwen36",
            model: "qwen3.6",
          },
        },
      },
    ]);
    expect(repo.listAuditLogsByStudy(studyId)).toMatchObject([
      {
        actorType: "agent",
        actorId: "worker-test",
        action: "medical.report.llm_draft",
        targetType: "report",
        detail: {
          provider: {
            instance_id: "openai:qwen36",
            model: "qwen3.6",
          },
          result: {
            status: "drafted",
          },
        },
      },
    ]);
  });

  it("uses MedGemma as an auxiliary medical review provider after report drafting", async () => {
    const qwenCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const medGemmaCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const { tasks } = seedAgentTaskChain(["draft_report"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.91,
      now: 8600,
    });
    repo.createTiradsResult({
      noduleId: nodule.id,
      score: 4,
      category: "TR4",
      recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
      evidenceRules: [{ rule_code: "ACR_2017_category_TR4" }],
      warnings: [],
      now: 8700,
    });

    const result = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: "worker-test",
      now: () => 8800,
      llmProvider: qwenProvider(),
      medicalReviewProvider: medGemmaProvider(),
      llmFetchImpl: async (url, init) => {
        qwenCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return openAiSseResponse({
          status: "drafted",
          draft_text: "甲状腺超声AI辅助报告（草稿）\n结节1：TI-RADS TR4。\n提示：本报告为AI辅助草稿，需医生审核确认后生效。",
          doctor_review_required: true,
          warnings: [],
        });
      },
      medicalReviewFetchImpl: async (url, init) => {
        medGemmaCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return openAiSseResponse({
          status: "reviewed",
          medical_expression_assessment: "acceptable",
          safety_assessment: "needs_review",
          summary_zh: "报告草稿表达基本可用，但建议医生核对随访建议依据。",
          doctor_review_focus: ["核对 TR4 随访建议是否与尺寸证据一致。"],
          suggested_edits: ["将英文 follow-up 建议本地化为中文表达。"],
          warnings: ["medgemma_review_requires_doctor_confirmation"],
          limitations: ["仅复核文本和结构化证据，不读取原始超声图像。"],
          role: "medical_review_assistant",
        });
      },
    });

    expect(qwenCalls).toHaveLength(1);
    expect(medGemmaCalls).toHaveLength(1);
    expect(qwenCalls[0].body).toMatchObject({ model: "qwen3.6", stream: true });
    expect(medGemmaCalls[0]).toMatchObject({
      url: "http://medgemma.test/v1/chat/completions",
      body: {
        model: "medgemma-1.5-4b-it",
        stream: true,
      },
    });
    expect(JSON.stringify(medGemmaCalls[0].body)).toContain("review_thyroid_ultrasound_report_draft");
    expect(JSON.stringify(medGemmaCalls[0].body)).toContain("medical_review_assistant");

    expect(result).toMatchObject({
      status: "succeeded",
      taskType: "draft_report",
      output: {
        result: {
          structured: {
            generator: "llm_provider_structured_report",
            medical_review_assistant: {
              status: "reviewed",
              safety_assessment: "needs_review",
              role: "medical_review_assistant",
            },
            medical_review_provider: {
              instance_id: "lmstudio:medgemma-review",
              model: "medgemma-1.5-4b-it",
            },
          },
          medical_review_assistant: {
            status: "reviewed",
            provider: {
              instance_id: "lmstudio:medgemma-review",
              model: "medgemma-1.5-4b-it",
            },
          },
        },
        warnings: ["doctor_review_required", "medgemma_review_requires_doctor_confirmation"],
      },
    });

    const report = repo.listReportsByStudy(studyId)[0];
    expect(report).toMatchObject({
      status: "draft",
      structured: {
        medical_review_assistant: {
          summary_zh: "报告草稿表达基本可用，但建议医生核对随访建议依据。",
        },
      },
    });

    const auditLogs = repo.listAuditLogsByStudy(studyId);
    const qwenAudit = auditLogs.find((log) => log.action === "medical.report.llm_draft");
    const medGemmaAudit = auditLogs.find((log) => log.action === "medical.report.medgemma_review");
    expect(qwenAudit).toMatchObject({
      targetType: "report",
      targetId: report?.id,
      detail: {
        provider: {
          instance_id: "openai:qwen36",
          model: "qwen3.6",
        },
      },
    });
    expect(medGemmaAudit).toMatchObject({
      targetType: "report",
      targetId: report?.id,
      detail: {
        provider: {
          instance_id: "lmstudio:medgemma-review",
          model: "medgemma-1.5-4b-it",
        },
        result: {
          role: "medical_review_assistant",
        },
      },
    });
  });

  it("runs safety review against report drafts and writes audit logs", () => {
    const { tasks } = seedAgentTaskChain(["safety_review"]);
    const studyId = String(tasks[0].input.study_id);
    const report = repo.createReport({
      studyId,
      analysisSessionId: tasks[0].analysisSessionId,
      templateId: "tpl-thyroid-ultrasound-draft-v1",
      draftText: "患者姓名张三，AI确诊恶性结节，建议FNA。",
      structured: { review_required: false },
      evidence: [],
      createdByAgent: "draft-agent",
      now: 9000,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 9100 });

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "safety_review",
      output: {
        validation_mode: false,
        result: {
          safety_status: "needs_doctor_review",
          report_id: report.id,
          rules_checked: 5,
        },
        warnings: ["doctor_review_required", "safety_issues_detected"],
      },
    });
    const outputResult = result.output?.result as Record<string, unknown>;
    const issues = outputResult.issues as Array<Record<string, unknown>>;
    expect(issues.map((issue) => issue.rule_code)).toEqual(
      expect.arrayContaining([
        "NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR",
        "NO_UNSUPPORTED_FNA_RECOMMENDATION",
        "PHI_NOT_ALLOWED_IN_MODEL_LOG",
      ])
    );

    expect(repo.listAuditLogsByStudy(studyId)).toMatchObject([
      {
        actorType: "agent",
        actorId: "worker-test",
        action: "medical.safety_review",
        targetType: "report",
        targetId: report.id,
        traceId: tasks[0].id,
        detail: {
          safety_status: "needs_doctor_review",
          report_id: report.id,
        },
      },
    ]);
  });

  it("persists structured TI-RADS feature candidates from classify task input", () => {
    const { tasks } = seedAgentTaskChain(["classify_tirads_features"], {
      classify_tirads_features: {
        feature_candidates: [
          {
            nodule_index: 1,
            features: {
              composition: "solid",
              echogenicity: "hypoechoic",
              shape: "wider_than_tall",
              margin: "smooth",
              echogenic_foci: ["none"],
              size_mm: { long_axis: 11, short_axis: 7, ap_axis: 8 },
            },
            confidence: { composition: 0.93, echogenicity: 0.87 },
            source_model: "tc-vit-validation",
            requires_review: true,
          },
        ],
      },
    });
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.91,
      now: 7000,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 7100 });

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "classify_tirads_features",
      output: {
        validation_mode: false,
        result: {
          feature_status: "persisted",
          source: "structured_validation_input",
          features: [
            {
              nodule_id: nodule.id,
              nodule_index: 1,
              features: {
                composition: "solid",
                echogenicity: "hypoechoic",
                shape: "wider_than_tall",
                margin: "smooth",
                echogenic_foci: ["none"],
                size_mm: { long_axis: 11, short_axis: 7, ap_axis: 8 },
              },
              confidence: { composition: 0.93, echogenicity: 0.87 },
              source_model: "tc-vit-validation",
              requires_review: true,
            },
          ],
        },
        warnings: [],
      },
    });
    expect(repo.listTiradsFeaturesByStudy(studyId)).toMatchObject([
      {
        noduleId: nodule.id,
        features: {
          composition: "solid",
          echogenicity: "hypoechoic",
          shape: "wider_than_tall",
          margin: "smooth",
          echogenic_foci: ["none"],
          size_mm: { long_axis: 11, short_axis: 7, ap_axis: 8 },
        },
        confidence: { composition: 0.93, echogenicity: 0.87 },
        sourceModel: "tc-vit-validation",
        requiresReview: true,
      },
    ]);
  });

  it("heuristically prefills TI-RADS features when no feature model output is configured", () => {
    const { tasks } = seedAgentTaskChain(["classify_tirads_features"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 34, 58],
      detectionConfidence: 0.91,
      now: 7200,
    });
    repo.createMeasurement({
      noduleId: nodule.id,
      longAxisMm: 12,
      shortAxisMm: 8,
      apAxisMm: 9,
      measurementSource: "mask",
      confidence: 0.88,
      now: 7250,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 7300 });

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: true,
      taskType: "classify_tirads_features",
      output: {
        result: {
          feature_status: "prefilled_requires_review",
          source: "heuristic_prefill_v2",
          features: [
            {
              nodule_id: nodule.id,
              nodule_index: 1,
              features: {
                composition: "solid",
                echogenicity: "isoechoic",
                shape: "taller_than_wide",
                margin: "ill_defined",
                echogenic_foci: ["none"],
                size_mm: { long_axis: 12, short_axis: 8, ap_axis: 9 },
              },
              source_model: "tirads-prefill-heuristic-v2",
              requires_review: true,
            },
          ],
        },
        warnings: ["tirads_feature_prefill_requires_doctor_review"],
      },
    });
    expect(repo.listTiradsFeaturesByStudy(studyId)).toMatchObject([
      {
        noduleId: nodule.id,
        features: {
          composition: "solid",
          echogenicity: "isoechoic",
          shape: "taller_than_wide",
          margin: "ill_defined",
          echogenic_foci: ["none"],
          size_mm: { long_axis: 12, short_axis: 8, ap_axis: 9 },
        },
        sourceModel: "tirads-prefill-heuristic-v2",
        requiresReview: true,
      },
    ]);
  });

  it("uses segmentation, measurement, texture, and boundary cues in TI-RADS prefill v2", () => {
    const { tasks } = seedAgentTaskChain(["classify_tirads_features"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 70, 80],
      maskUri: "artifact://model-output/S/IMG/J/mask_nodule_1.png",
      detectionConfidence: 0.91,
      now: 7350,
    });
    repo.createMeasurement({
      noduleId: nodule.id,
      longAxisMm: 14,
      shortAxisMm: 9,
      apAxisMm: 8,
      measurementSource: "mask",
      confidence: 0.9,
      now: 7360,
    });
    repo.createModelJob({
      studyId,
      imageId,
      jobType: "thyroid.segment_nodule",
      status: "succeeded",
      modelName: "nnunet-tight-roi-segmenter",
      modelVersion: "tn3k-tight-roi-5fold-best",
      artifactUri: "artifact://model-output/S/IMG/J/segmentation.json",
      output: {
        segmentations: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            bbox: [10, 20, 70, 80],
            contour: [[10, 20], [70, 24], [55, 80], [16, 70]],
            mask_uri: "artifact://model-output/S/IMG/J/mask_nodule_1.png",
            segmentation_source: "nnunet_tight_roi",
            confidence: 0.9,
          },
        ],
      },
      completedAt: 7370,
      now: 7370,
    });
    repo.createModelJob({
      studyId,
      imageId,
      jobType: "thyroid.measure_nodule",
      status: "succeeded",
      modelName: "mask-measurement-worker",
      modelVersion: "validation-measurement-v1",
      artifactUri: "artifact://model-output/S/IMG/J/measurements.json",
      output: {
        measurements: [
          {
            nodule_id: nodule.id,
            nodule_index: 1,
            long_axis_mm: 14,
            short_axis_mm: 9,
            ap_axis_mm: 8,
            area_mm2: 98,
            aspect_ratio: 1.55,
            measurement_source: "mask",
            confidence: 0.9,
            pixel_measurements: { width_px: 60, height_px: 56, long_axis_px: 60, short_axis_px: 56, area_px2: 2100 },
            tirads_prefill_metrics: {
              texture: {
                composition_hint: "solid",
                echogenicity_hint: "hypoechoic",
                echogenic_foci_hint: ["punctate_echogenic_foci"],
                bright_foci_fraction: 0.012,
              },
              boundary: {
                compactness: 0.4,
                fill_ratio: 0.6,
              },
            },
          },
        ],
      },
      completedAt: 7380,
      now: 7380,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 7390 });

    expect(result).toMatchObject({
      status: "succeeded",
      taskType: "classify_tirads_features",
      output: {
        result: {
          feature_status: "prefilled_requires_review",
          source: "heuristic_prefill_v2",
          features: [
            {
              nodule_id: nodule.id,
              features: {
                composition: "solid",
                echogenicity: "hypoechoic",
                shape: "wider_than_tall",
                margin: "irregular",
                echogenic_foci: ["punctate_echogenic_foci"],
                prefill_evidence: {
                  method: "mask_measurement_texture_boundary_v2",
                  texture: {
                    echogenicity_hint: "hypoechoic",
                  },
                  boundary: {
                    compactness: 0.4,
                  },
                },
              },
              confidence: {
                composition: 0.42,
                echogenicity: 0.44,
                shape: 0.72,
                margin: 0.48,
                echogenic_foci: 0.38,
              },
              source_model: "tirads-prefill-heuristic-v2",
              requires_review: true,
            },
          ],
        },
      },
    });
  });

  it("waits for doctor confirmation before calculating from heuristic TI-RADS prefill", () => {
    const { tasks } = seedAgentTaskChain(["calculate_tirads"]);
    const studyId = String(tasks[0].input.study_id);
    const imageId = String(tasks[0].input.image_id);
    const nodule = repo.upsertNodule({
      studyId,
      imageId,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.91,
      now: 7400,
    });
    const feature = repo.createTiradsFeature({
      noduleId: nodule.id,
      features: {
        composition: "solid",
        echogenicity: "isoechoic",
        shape: "wider_than_tall",
        margin: "ill_defined",
        echogenic_foci: ["none"],
        size_mm: { long_axis: 12, short_axis: 8, ap_axis: 9 },
      },
      sourceModel: "tirads-prefill-heuristic-v2",
      requiresReview: true,
      now: 7450,
    });

    const result = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 7500 });

    expect(result).toMatchObject({
      status: "waiting_doctor_input",
      claimed: true,
      taskType: "calculate_tirads",
      output: {
        status: "waiting_doctor_tirads_features",
        pending_nodule_ids: [nodule.id],
        pending_feature_ids: [feature.id],
        confirmed_nodule_count: 0,
        total_nodule_count: 1,
      },
    });
    expect(repo.getAgentTask(tasks[0].id)?.status).toBe("queued");
    expect(repo.listTiradsResultsByStudy(studyId)).toEqual([]);
  });
});

function seedAgentTaskChain(
  taskTypes: string[],
  taskInputs: Record<string, Record<string, unknown>> = {}
): { sessionId: string; tasks: AgentTaskRecord[] } {
  const patient = repo.upsertPatient({ externalPatientId: "EXT-AGENT", now: 1000 });
  const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-AGENT", now: 1100 });
  const image = repo.addImage({
    studyId: study.id,
    fileUri: "artifact://raw/ACC-AGENT/IMG1.png",
    fileType: "png",
    width: 640,
    height: 480,
    now: 1200,
  });
  const session = repo.createAnalysisSession({
    studyId: study.id,
    status: "queued",
    triggerSource: "test",
    now: 1300,
  });
  let parentTaskId: string | undefined;
  const tasks = taskTypes.map((taskType, index) => {
    const task = repo.createAgentTask({
      analysisSessionId: session.id,
      parentTaskId,
      agentName: `${taskType}_agent`,
      taskType,
      input: {
        study_id: study.id,
        image_id: image.id,
        ...(taskInputs[taskType] ?? {}),
      },
      now: 1400 + index,
    });
    parentTaskId = task.id;
    return task;
  });
  return { sessionId: session.id, tasks };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openAiSseResponse(content: Record<string, unknown>): Response {
  return new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(content) } }], model: "qwen3.6" })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }
  );
}

function reportKnowledgeManifest(): MedicalKnowledgeManifest {
  return {
    document: {
      id: "doc-agent-report-knowledge-v1",
      title: "Agent Report Knowledge",
      source_type: "guideline",
      source_name: "ACR_TI_RADS_TEST",
      version: "v1",
      language: "zh-CN",
      effective_date: "2026-05-10",
      file_uri: "artifact://test/agent-report-knowledge.md",
      review_status: "approved",
      approved_by: "unit-test",
      approved_at: 8250,
      metadata: { body_part: "thyroid" },
    },
    chunks: [
      {
        id: "tr4-management",
        section_title: "ACR TI-RADS TR4 随访阈值",
        chunk_type: "guideline_rule_summary",
        topic: "tirads_management_thresholds",
        evidence_level: "official_guideline_summary",
        tirads_system: "ACR_TI_RADS",
        body_part: "thyroid",
        text: "ACR TI-RADS TR4 thyroid nodule guideline: follow-up threshold is commonly 1.0 cm, and FNA threshold is commonly 1.5 cm. Doctor review is required before final management.",
        metadata: { source_id: "unit-test" },
      },
    ],
  };
}

function qwenProvider(): ProviderStatus {
  return {
    instanceId: "openai:qwen36",
    type: "openai",
    displayName: "Qwen3.6 local vLLM",
    kind: "local",
    enabled: true,
    requiresApiKey: false,
    baseUrl: "http://qwen.test/v1",
    model: "qwen3.6",
    timeoutMs: 60_000,
    envVars: [],
    fileConfig: { model: "qwen3.6", baseUrl: "http://qwen.test/v1" },
    configured: true,
    available: true,
    reason: "test provider",
  };
}

function medGemmaProvider(): ProviderStatus {
  return {
    instanceId: "lmstudio:medgemma-review",
    type: "lmstudio",
    displayName: "LM Studio · MedGemma review",
    kind: "local",
    enabled: true,
    requiresApiKey: false,
    baseUrl: "http://medgemma.test/v1",
    model: "medgemma-1.5-4b-it",
    timeoutMs: 60_000,
    envVars: [],
    fileConfig: { model: "medgemma-1.5-4b-it", baseUrl: "http://medgemma.test/v1" },
    configured: true,
    available: true,
    reason: "test provider",
  };
}
