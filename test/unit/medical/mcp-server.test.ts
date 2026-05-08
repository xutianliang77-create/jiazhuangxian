import { describe, expect, it } from "vitest";

import { MedicalMcpServer } from "../../../packages/medical-mcp/src/server";
import { calculateAcrTirads } from "../../../packages/medical-mcp/src/tirads";

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

  it("returns explicit not-configured responses for model-gateway tools", async () => {
    const server = new MedicalMcpServer();
    const result = await server.callTool("thyroid.DetectNodules", {
      study_id: "S1",
      image_id: "IMG1",
      image_uri: "artifact://raw/S1/IMG1.png",
    });
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "error",
      error: { code: "model_gateway_not_configured" },
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
