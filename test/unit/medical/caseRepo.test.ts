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
    expect(bundle?.nodules).toEqual([]);
    expect(bundle?.tiradsFeatures).toEqual([]);
    expect(bundle?.tiradsResults).toEqual([]);
    expect(bundle?.reports).toEqual([]);
    expect(bundle?.auditLogs).toEqual([]);
    expect(bundle?.doctorReviews).toEqual([]);
    expect(bundle?.modelJobs).toEqual([]);
    expect(task).toMatchObject({
      agentName: "CaseCoordinatorAgent",
      taskType: "orchestrate",
      status: "queued",
      input: { study_id: study.id },
    });
  });

  it("lists model jobs and artifact URIs in study bundles", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-MJ", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-MJ", now: 1100 });
    const image = repo.addImage({
      studyId: study.id,
      fileUri: "artifact://raw/ACC-MJ/IMG1.png",
      fileType: "png",
      now: 1200,
    });
    const modelJob = repo.createModelJob({
      studyId: study.id,
      imageId: image.id,
      jobType: "thyroid.detect_nodules",
      status: "succeeded",
      output: { artifacts: { detections_json: "artifact://model-output/ACC-MJ/IMG1/MJ1/detections.json" } },
      modelName: "yolov11-thyroid-detector",
      modelVersion: "validation",
      artifactUri: "artifact://model-output/ACC-MJ/IMG1/MJ1/detections.json",
      now: 1300,
    });

    expect(repo.listModelJobsByStudy(study.id)).toEqual([modelJob]);
    expect(repo.getStudyBundle(study.id)?.modelJobs).toEqual([modelJob]);
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

  it("upserts detected nodules by study and index", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-NOD", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-NOD", now: 1100 });
    const image = repo.addImage({
      studyId: study.id,
      fileUri: "artifact://raw/ACC-NOD/IMG-NOD.png",
      fileType: "png",
      now: 1200,
    });

    const first = repo.upsertNodule({
      studyId: study.id,
      imageId: image.id,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.82,
      now: 1300,
    });
    const second = repo.upsertNodule({
      studyId: study.id,
      imageId: image.id,
      noduleIndex: 1,
      bbox: [11, 21, 31, 41],
      detectionConfidence: 0.91,
      now: 1400,
    });

    expect(second.id).toBe(first.id);
    expect(repo.listNodulesByStudy(study.id)).toMatchObject([
      {
        id: first.id,
        noduleIndex: 1,
        bbox: [11, 21, 31, 41],
        detectionConfidence: 0.91,
        source: "ai",
        status: "detected",
        updatedAt: 1400,
      },
    ]);
  });

  it("revises nodule bbox as a doctor correction", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-NOD-REV", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-NOD-REV", now: 1100 });
    const image = repo.addImage({
      studyId: study.id,
      fileUri: "artifact://raw/ACC-NOD-REV/IMG.png",
      fileType: "png",
      now: 1200,
    });
    const nodule = repo.upsertNodule({
      studyId: study.id,
      imageId: image.id,
      noduleIndex: 1,
      bbox: [10, 20, 30, 40],
      detectionConfidence: 0.88,
      now: 1300,
    });

    const revised = repo.reviseNodule({
      noduleId: nodule.id,
      bbox: [12, 22, 32, 42],
      status: "doctor_revised",
      now: 1400,
    });

    expect(revised.before).toMatchObject({ id: nodule.id, bbox: [10, 20, 30, 40], source: "ai" });
    expect(revised.nodule).toMatchObject({
      id: nodule.id,
      bbox: [12, 22, 32, 42],
      source: "doctor",
      status: "doctor_revised",
      updatedAt: 1400,
    });
    expect(repo.getStudyBundle(study.id)?.nodules[0]).toMatchObject({ bbox: [12, 22, 32, 42] });
  });

  it("persists TI-RADS features and calculated results", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-TIRADS", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-TIRADS", now: 1100 });
    const image = repo.addImage({
      studyId: study.id,
      fileUri: "artifact://raw/ACC-TIRADS/IMG.png",
      fileType: "png",
      now: 1200,
    });
    const nodule = repo.upsertNodule({
      studyId: study.id,
      imageId: image.id,
      noduleIndex: 1,
      now: 1300,
    });

    const feature = repo.createTiradsFeature({
      noduleId: nodule.id,
      features: { composition: "solid", size_mm: { long_axis: 12 } },
      confidence: { composition: 0.92 },
      sourceModel: "tc-vit-validation",
      requiresReview: true,
      now: 1400,
    });
    const result = repo.createTiradsResult({
      noduleId: nodule.id,
      score: 4,
      category: "TR4",
      recommendation: "TR4 nodule >=10 mm: ultrasound follow-up.",
      evidenceRules: [{ rule_code: "ACR_2017_composition_solid" }],
      warnings: ["missing_margin"],
      now: 1500,
    });

    expect(repo.listTiradsFeaturesByStudy(study.id)).toMatchObject([
      {
        id: feature.id,
        noduleId: nodule.id,
        features: { composition: "solid", size_mm: { long_axis: 12 } },
        confidence: { composition: 0.92 },
        sourceModel: "tc-vit-validation",
        requiresReview: true,
      },
    ]);
    expect(repo.listTiradsResultsByStudy(study.id)).toMatchObject([
      {
        id: result.id,
        noduleId: nodule.id,
        score: 4,
        category: "TR4",
        evidenceRules: [{ rule_code: "ACR_2017_composition_solid" }],
        warnings: ["missing_margin"],
      },
    ]);
    expect(repo.getStudyBundle(study.id)).toMatchObject({
      nodules: [{ id: nodule.id, noduleIndex: 1 }],
      tiradsFeatures: [{ id: feature.id, noduleId: nodule.id }],
      tiradsResults: [{ id: result.id, noduleId: nodule.id, category: "TR4" }],
    });
  });

  it("persists report drafts with structured evidence", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-REPORT", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-REPORT", now: 1100 });
    const session = repo.createAnalysisSession({ studyId: study.id, status: "running", now: 1200 });

    const report = repo.createReport({
      studyId: study.id,
      analysisSessionId: session.id,
      templateId: "tpl-thyroid-ultrasound-draft-v1",
      draftText: "甲状腺超声AI辅助报告（草稿）",
      structured: {
        nodules: [{ nodule_index: 1, category: "TR4" }],
        review_required: true,
      },
      evidence: [{ source: "tirads_result", rule_code: "ACR_2017_category_TR4" }],
      createdByAgent: "worker-test",
      now: 1300,
    });

    expect(repo.getReport(report.id)).toMatchObject({
      id: report.id,
      studyId: study.id,
      analysisSessionId: session.id,
      reportType: "thyroid_ultrasound",
      status: "draft",
      templateId: "tpl-thyroid-ultrasound-draft-v1",
      draftText: "甲状腺超声AI辅助报告（草稿）",
      structured: {
        nodules: [{ nodule_index: 1, category: "TR4" }],
        review_required: true,
      },
      evidence: [{ source: "tirads_result", rule_code: "ACR_2017_category_TR4" }],
      createdByAgent: "worker-test",
      createdAt: 1300,
      updatedAt: 1300,
    });
    expect(repo.listReportsByStudy(study.id).map((item) => item.id)).toEqual([report.id]);
    expect(repo.getActiveReportTemplateText("tpl-thyroid-ultrasound-draft-v1")).toContain(
      "甲状腺超声AI辅助报告（草稿）"
    );
    expect(repo.getStudyBundle(study.id)?.reports.map((item) => item.id)).toEqual([report.id]);
  });

  it("records doctor review decisions and updates report status", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-REVIEW", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-REVIEW", now: 1100 });
    const report = repo.createReport({
      studyId: study.id,
      draftText: "AI draft report",
      status: "draft",
      now: 1200,
    });

    const reviewed = repo.reviewReport({
      reportId: report.id,
      reviewerName: "doctor-a",
      action: "approve",
      comment: "ok",
      finalText: "doctor confirmed report",
      now: 1300,
    });

    expect(reviewed.report).toMatchObject({
      id: report.id,
      status: "confirmed",
      finalText: "doctor confirmed report",
      confirmedBy: "doctor-a",
      confirmedAt: 1300,
      updatedAt: 1300,
    });
    expect(reviewed.doctorReview).toMatchObject({
      reportId: report.id,
      reviewerName: "doctor-a",
      action: "approve",
      comment: "ok",
      before: { status: "draft" },
      after: { status: "confirmed", final_text: "doctor confirmed report" },
      createdAt: 1300,
    });
    expect(repo.listDoctorReviewsByStudy(study.id).map((item) => item.id)).toEqual([reviewed.doctorReview.id]);
    expect(repo.getStudyBundle(study.id)?.doctorReviews.map((item) => item.id)).toEqual([reviewed.doctorReview.id]);
  });

  it("reads safety rules and persists audit logs", () => {
    const repo = new MedicalCaseRepo(db);
    const patient = repo.upsertPatient({ externalPatientId: "P-AUDIT", now: 1000 });
    const study = repo.createStudy({ patientId: patient.id, accessionNo: "ACC-AUDIT", now: 1100 });

    expect(repo.listActiveSafetyRules().map((rule) => rule.ruleCode)).toEqual(
      expect.arrayContaining(["NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR", "PHI_NOT_ALLOWED_IN_MODEL_LOG"])
    );

    const audit = repo.createAuditLog({
      studyId: study.id,
      actorType: "agent",
      actorId: "worker-test",
      action: "medical.safety_review",
      targetType: "report",
      targetId: "R1",
      detail: {
        safety_status: "needs_doctor_review",
        issues: [{ rule_code: "NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR" }],
      },
      traceId: "TASK1",
      now: 1200,
    });

    expect(repo.getAuditLog(audit.id)).toMatchObject({
      id: audit.id,
      studyId: study.id,
      actorType: "agent",
      actorId: "worker-test",
      action: "medical.safety_review",
      targetType: "report",
      targetId: "R1",
      detail: {
        safety_status: "needs_doctor_review",
        issues: [{ rule_code: "NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR" }],
      },
      traceId: "TASK1",
      createdAt: 1200,
    });
    expect(repo.listAuditLogsByStudy(study.id).map((item) => item.id)).toEqual([audit.id]);
    expect(repo.getStudyBundle(study.id)?.auditLogs.map((item) => item.id)).toEqual([audit.id]);
  });
});
