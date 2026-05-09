import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMedicalAgentWorkerOnce, runMedicalAgentWorkerOnceAsync } from "../../../src/medical/agentWorker";
import { MedicalCaseRepo, type AgentTaskRecord } from "../../../src/medical/storage";
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
    });
    expect(modelJob?.input.image_uri).toBe("artifact://raw/ACC-AGENT/IMG1.png");

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
            nodules: [
              {
                nodule_id: nodule.id,
                nodule_index: 1,
                tirads_result_id: tiradsResult.id,
                score: 4,
                category: "TR4",
              },
            ],
          },
          evidence: [
            {
              source: "tirads_result",
              nodule_id: nodule.id,
              tirads_result_id: tiradsResult.id,
              evidence_rules: [{ rule_code: "ACR_2017_category_TR4" }],
            },
          ],
        },
        warnings: ["doctor_review_required"],
      },
    });
    const outputResult = result.output?.result as Record<string, unknown>;
    expect(String(outputResult.draft_text)).toContain("甲状腺超声AI辅助报告（草稿）");
    expect(String(outputResult.draft_text)).toContain("TI-RADS TR4");
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
