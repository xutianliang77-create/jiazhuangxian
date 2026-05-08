import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { migrateIfNeeded } from "../../../src/storage/migrate";
import { MedicalCaseRepo } from "../../../src/medical/storage";

let tmpRoot: string;
let db: Database.Database;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-medical-"));
  db = new Database(path.join(tmpRoot, "data.db"));
  db.pragma("foreign_keys = ON");
  migrateIfNeeded(db, "data");
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // noop
  }
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("medical validation schema", () => {
  it("creates the verification tables without RBAC tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row: unknown) => (row as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining([
      "patient",
      "study",
      "image",
      "image_import_job",
      "analysis_session",
      "agent_task",
      "tool_call_log",
      "model_job",
      "nodule",
      "measurement",
      "tirads_feature",
      "tirads_result",
      "report",
      "doctor_review",
      "medical_documents",
      "medical_chunk_metadata",
      "medical_terms",
      "tirads_rules",
      "report_templates",
      "evidence_links",
      "safety_rules",
      "knowledge_ingestion_job",
      "case_knowledge",
      "audit_log",
    ]));
    expect(tables).not.toContain("app_user");
    expect(tables).not.toContain("role");
    expect(tables).not.toContain("permission");
    expect(tables).not.toContain("resource_acl");
    expect(tables).not.toContain("service_account");
  });
});

describe("MedicalCaseRepo", () => {
  it("persists a manual patient, study, ultrasound image and agent session", () => {
    const repo = new MedicalCaseRepo(db);

    const patient = repo.upsertPatient({
      externalPatientId: "P-001",
      sex: "female",
      birthYear: 1988,
      meta: { import_source: "csv" },
      now: 1000,
    });
    const study = repo.createStudy({
      patientId: patient.id,
      accessionNo: "ACC-001",
      studyInstanceUid: "1.2.3",
      clinicalContext: "thyroid screening",
      createdBy: "doctor-a",
      now: 1100,
    });
    const image = repo.addImage({
      studyId: study.id,
      sopInstanceUid: "1.2.3.4",
      fileUri: "artifact://raw/ACC-001/IMG-001.dcm",
      fileType: "dicom",
      width: 1024,
      height: 768,
      pixelSpacing: { x_mm: 0.08, y_mm: 0.08 },
      dicomMetadata: { modality: "US" },
      now: 1200,
    });
    const session = repo.createAnalysisSession({
      studyId: study.id,
      status: "running",
      triggerSource: "manual",
      createdBy: "doctor-a",
      now: 1300,
    });
    const task = repo.createAgentTask({
      analysisSessionId: session.id,
      agentName: "CaseCoordinatorAgent",
      taskType: "orchestrate",
      input: { study_id: study.id },
      now: 1400,
    });

    const bundle = repo.getStudyBundle(study.id);
    expect(bundle?.patient?.id).toBe(patient.id);
    expect(bundle?.study.accessionNo).toBe("ACC-001");
    expect(bundle?.images).toHaveLength(1);
    expect(bundle?.images[0]).toMatchObject({
      id: image.id,
      fileUri: "artifact://raw/ACC-001/IMG-001.dcm",
      fileType: "dicom",
      pixelSpacing: { x_mm: 0.08, y_mm: 0.08 },
      dicomMetadata: { modality: "US" },
    });
    expect(bundle?.analysisSessions.map((s) => s.id)).toEqual([session.id]);
    expect(bundle?.agentTasks.map((t) => t.id)).toEqual([task.id]);
    expect(task).toMatchObject({
      agentName: "CaseCoordinatorAgent",
      taskType: "orchestrate",
      status: "queued",
      input: { study_id: study.id },
    });
  });

  it("upserts patient records by external patient id", () => {
    const repo = new MedicalCaseRepo(db);
    const first = repo.upsertPatient({ externalPatientId: "P-002", sex: "unknown", now: 1000 });
    const second = repo.upsertPatient({
      externalPatientId: "P-002",
      sex: "male",
      birthYear: 1975,
      meta: { import_source: "json" },
      now: 2000,
    });

    expect(second.id).toBe(first.id);
    expect(second.sex).toBe("male");
    expect(second.birthYear).toBe(1975);
    expect(second.meta).toEqual({ import_source: "json" });
    expect(second.updatedAt).toBe(2000);
    const count = db.prepare("SELECT COUNT(*) AS c FROM patient").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("enforces study foreign keys for imported images", () => {
    const repo = new MedicalCaseRepo(db);
    expect(() =>
      repo.addImage({
        studyId: "missing-study",
        fileUri: "artifact://raw/missing.dcm",
        fileType: "dicom",
      })
    ).toThrow();
  });

  it("updates image quality metadata after worker QC", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-QC", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-QC", now: 1100 });
    const image = repo.addImage({
      studyId: study.id,
      fileUri: "artifact://raw/ACC-QC/IMG-QC.png",
      fileType: "png",
      now: 1200,
    });

    const updated = repo.updateImageQuality({
      imageId: image.id,
      imageQuality: "analyzable",
      qualityScore: 0.91,
      processingStatus: "qc_completed",
      now: 1300,
    });

    expect(updated).toMatchObject({
      id: image.id,
      imageQuality: "analyzable",
      qualityScore: 0.91,
      processingStatus: "qc_completed",
      updatedAt: 1300,
    });
  });
});
