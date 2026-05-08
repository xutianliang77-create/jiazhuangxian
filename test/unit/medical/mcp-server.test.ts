import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { MedicalKnowledgeStore } from "../../../packages/medical-mcp/src/knowledgeStore";
import { MedicalMcpServer } from "../../../packages/medical-mcp/src/server";
import { calculateAcrTirads } from "../../../packages/medical-mcp/src/tirads";
import { migrateIfNeeded } from "../../../src/storage/migrate";

describe("medical MCP tool surface", () => {
  it("lists image-worker wrappers and thyroid tools", () => {
    const server = new MedicalMcpServer();
    const names = server.listTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "image.ParseDicom",
      "image.DeidentifyDicom",
      "image.RenderPreview",
      "image.PreprocessUltrasound",
      "image.ExtractCalibration",
      "image.ImageQualityCheck",
      "thyroid.ImageQC",
      "thyroid.DetectNodules",
      "thyroid.ClassifyTiradsFeatures",
      "thyroid.CalculateTirads",
      "medical.GetTiradsRule",
      "medical.GetReportTemplate",
      "medical.NormalizeTerm",
    ]));
  });

  it("forwards image.ParseDicom to the image-worker HTTP endpoint", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const server = new MedicalMcpServer({
      baseUrl: "http://worker.test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown });
        return jsonResponse({
          status: "ok",
          result: { metadata: { modality: "US" } },
          warnings: [],
        });
      },
    });

    const result = await server.callTool("image.ParseDicom", {
      study_id: "S1",
      image_id: "IMG1",
      image_uri: "artifact://raw/S1/IMG1.dcm",
      trace_id: "T1",
    });

    expect(result.isError).toBeUndefined();
    expect(calls).toEqual([
      {
        url: "http://worker.test/image/v1/parse-dicom",
        body: {
          study_id: "S1",
          image_id: "IMG1",
          image_uri: "artifact://raw/S1/IMG1.dcm",
          trace_id: "T1",
        },
      },
    ]);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "ok",
      result: { metadata: { modality: "US" } },
    });
  });

  it("maps thyroid.ImageQC to image quality check", async () => {
    let calledUrl = "";
    const server = new MedicalMcpServer({
      baseUrl: "http://worker.test/",
      fetchImpl: async (url) => {
        calledUrl = String(url);
        return jsonResponse({
          status: "ok",
          result: { quality_score: 0.91, is_analyzable: true, issues: [] },
          warnings: [],
        });
      },
    });

    const result = await server.callTool("thyroid.ImageQC", {
      study_id: "S1",
      image_id: "IMG1",
      image_uri: "artifact://raw/S1/IMG1.png",
    });

    expect(calledUrl).toBe("http://worker.test/image/v1/image-quality-check");
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "ok",
      result: { quality_score: 0.91, is_analyzable: true },
    });
  });

  it("forwards thyroid.DetectNodules to the model-gateway HTTP endpoint", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const server = new MedicalMcpServer({
      modelGatewayUrl: "http://model.test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown });
        return jsonResponse({
          status: "ok",
          result: {
            job_id: "mj_1",
            status: "queued",
            job_type: "thyroid.detect_nodules",
            model: { name: "yolov11-thyroid-detector", version: "validation-placeholder" },
          },
          warnings: ["detector worker is not configured yet; job is queued for validation flow only"],
        });
      },
    });
    const result = await server.callTool("thyroid.DetectNodules", {
      study_id: "S1",
      image_id: "IMG1",
      image_uri: "artifact://raw/S1/IMG1.png",
      trace_id: "T1",
    });

    expect(calls).toEqual([
      {
        url: "http://model.test/model/v1/infer/thyroid/detect-nodules",
        body: {
          study_id: "S1",
          image_id: "IMG1",
          image_uri: "artifact://raw/S1/IMG1.png",
          trace_id: "T1",
        },
      },
    ]);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "ok",
      result: { job_id: "mj_1", status: "queued", job_type: "thyroid.detect_nodules" },
    });
  });

  it("returns a structured model-gateway error when detection gateway is unreachable", async () => {
    const server = new MedicalMcpServer({
      modelGatewayUrl: "http://model.test",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const result = await server.callTool("thyroid.DetectNodules", {
      study_id: "S1",
      image_id: "IMG1",
      image_uri: "artifact://raw/S1/IMG1.png",
    });

    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "error",
      error: { code: "model_gateway_unreachable" },
    });
  });
});

describe("medical knowledge MCP tools", () => {
  it("returns seeded TI-RADS rules with version and evidence metadata", async () => {
    await withKnowledgeServer(async (server) => {
      const result = await server.callTool("medical.GetTiradsRule", {
        rule_code: "ACR_2017_composition_solid",
      });

      expect(JSON.parse(result.content[0]!.text)).toMatchObject({
        status: "ok",
        result: {
          count: 1,
          system_name: "ACR_TI_RADS",
          system_version: "2017",
          rules: [
            {
              rule_code: "ACR_2017_composition_solid",
              feature_group: "composition",
              feature_name: "solid",
              points: 2,
              evidence_document_id: "doc-acr-tirads-2017",
            },
          ],
        },
      });
    });
  });

  it("returns active report templates by scene", async () => {
    await withKnowledgeServer(async (server) => {
      const result = await server.callTool("medical.GetReportTemplate", {
        scene: "thyroid_ultrasound_report",
      });

      expect(JSON.parse(result.content[0]!.text)).toMatchObject({
        status: "ok",
        result: {
          template: {
            id: "tpl-thyroid-ultrasound-draft-v1",
            scene: "thyroid_ultrasound_report",
            version: "v1",
            required_fields: [
              "thyroid_description",
              "nodule_descriptions",
              "tirads_summary",
              "recommendation",
              "evidence_summary",
            ],
          },
        },
      });
    });
  });

  it("normalizes Chinese free text to seeded medical terms", async () => {
    await withKnowledgeServer(async (server) => {
      const result = await server.callTool("medical.NormalizeTerm", {
        text: "甲状腺结节呈低回声实性，建议细针穿刺",
      });
      const names = JSON.parse(result.content[0]!.text).result.normalized_terms.map(
        (term: { canonical_name: string }) => term.canonical_name
      );

      expect(names).toEqual(expect.arrayContaining(["thyroid_nodule", "hypoechoic", "solid", "fna"]));
    });
  });

  it("returns a structured error when the knowledge database is missing", async () => {
    const server = new MedicalMcpServer({ knowledgeDbPath: "/definitely/missing/jiazhuangxian.db" });
    const result = await server.callTool("medical.GetTiradsRule", {
      rule_code: "ACR_2017_composition_solid",
    });

    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "error",
      error: { code: "knowledge_db_unavailable" },
    });
  });
});

describe("thyroid.CalculateTirads", () => {
  it("calculates ACR TI-RADS 2017 score and recommendation", async () => {
    const server = new MedicalMcpServer();
    const result = await server.callTool("thyroid.CalculateTirads", {
      features: {
        composition: "solid",
        echogenicity: "hypoechoic",
        shape: "taller_than_wide",
        margin: "irregular",
        echogenic_foci: ["punctate_echogenic_foci"],
      },
      size_mm: { long_axis: 12 },
    });

    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "ok",
      result: {
        system_name: "ACR_TI_RADS",
        system_version: "2017",
        score: 12,
        category: "TR5",
        recommendation_code: "fna",
      },
      warnings: [],
    });
  });

  it("warns about missing feature groups but still returns a deterministic score", () => {
    expect(calculateAcrTirads({ features: { composition: "spongiform" } })).toMatchObject({
      status: "ok",
      result: { score: 0, category: "TR1" },
      warnings: ["missing_echogenicity", "missing_shape", "missing_margin", "missing_echogenic_foci"],
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function withKnowledgeServer(callback: (server: MedicalMcpServer) => void | Promise<void>): Promise<void> {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-mcp-knowledge-"));
  const db = new Database(path.join(tmpRoot, "data.db"));
  try {
    db.pragma("foreign_keys = ON");
    migrateIfNeeded(db, "data");
    const server = new MedicalMcpServer({
      knowledgeStore: new MedicalKnowledgeStore({ db }),
    });
    await callback(server);
  } finally {
    db.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
