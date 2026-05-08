import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMedicalAgentWorkerOnce } from "../../../src/medical/agentWorker";
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
    ).run(JSON.stringify({ nodules: [{ id: "N1", confidence: 0.91 }] }), 2200, 2200, second.modelJobId);

    const third = runMedicalAgentWorkerOnce(repo, { workerId: "worker-test", now: () => 2300 });
    expect(third).toMatchObject({ status: "succeeded", claimed: true, taskType: "detect_nodules" });
    expect(repo.getAgentTask(tasks[1].id)?.status).toBe("succeeded");

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
});

function seedAgentTaskChain(taskTypes: string[]): { sessionId: string; tasks: AgentTaskRecord[] } {
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
      },
      now: 1400 + index,
    });
    parentTaskId = task.id;
    return task;
  });
  return { sessionId: session.id, tasks };
}
