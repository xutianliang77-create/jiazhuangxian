import { ImageWorkerClient, type ImageWorkerClientOptions } from "./imageWorkerClient";
import { ModelGatewayClient, type ModelGatewayClientOptions } from "./modelGatewayClient";
import { calculateAcrTirads } from "./tirads";
import type { FetchLike, ToolCallResult, ToolDescriptor } from "./types";

const IMAGE_REQUEST_SCHEMA = {
  type: "object",
  properties: {
    study_id: { type: "string" },
    image_id: { type: "string" },
    image_uri: { type: "string" },
    metadata: { type: "object" },
    trace_id: { type: "string" },
  },
  required: ["study_id", "image_id", "image_uri"],
  additionalProperties: false,
};

const OUTPUT_IMAGE_REQUEST_SCHEMA = {
  ...IMAGE_REQUEST_SCHEMA,
  properties: {
    ...IMAGE_REQUEST_SCHEMA.properties,
    output_uri: { type: "string" },
  },
  required: ["study_id", "image_id", "image_uri", "output_uri"],
};

const TOOLS: ToolDescriptor[] = [
  {
    name: "image.ParseDicom",
    description: "Parse DICOM metadata through the Python image-worker.",
    inputSchema: IMAGE_REQUEST_SCHEMA,
  },
  {
    name: "image.DeidentifyDicom",
    description: "Remove common PHI metadata from a DICOM file through the Python image-worker.",
    inputSchema: OUTPUT_IMAGE_REQUEST_SCHEMA,
  },
  {
    name: "image.RenderPreview",
    description: "Render a PNG/JPEG preview through the Python image-worker.",
    inputSchema: {
      ...OUTPUT_IMAGE_REQUEST_SCHEMA,
      properties: {
        ...OUTPUT_IMAGE_REQUEST_SCHEMA.properties,
        max_size: { type: "number", minimum: 128, maximum: 4096 },
      },
    },
  },
  {
    name: "image.PreprocessUltrasound",
    description: "Generate a grayscale normalized model-ready ultrasound image through the Python image-worker.",
    inputSchema: {
      ...OUTPUT_IMAGE_REQUEST_SCHEMA,
      properties: {
        ...OUTPUT_IMAGE_REQUEST_SCHEMA.properties,
        target_size: { type: "number", minimum: 128, maximum: 4096 },
        normalize: { type: "boolean" },
      },
    },
  },
  {
    name: "image.ExtractCalibration",
    description: "Extract pixel spacing or mark the image as requiring manual calibration.",
    inputSchema: IMAGE_REQUEST_SCHEMA,
  },
  {
    name: "image.ImageQualityCheck",
    description: "Run basic image quality checks through the Python image-worker.",
    inputSchema: IMAGE_REQUEST_SCHEMA,
  },
  {
    name: "thyroid.ImageQC",
    description: "Thyroid image quality tool alias used by the medical Agent Team.",
    inputSchema: IMAGE_REQUEST_SCHEMA,
  },
  {
    name: "thyroid.DetectNodules",
    description: "Create a thyroid nodule detection model_job through the model-gateway.",
    inputSchema: {
      ...IMAGE_REQUEST_SCHEMA,
      properties: {
        ...IMAGE_REQUEST_SCHEMA.properties,
        agent_task_id: { type: "string" },
        model: { type: "string" },
        model_version: { type: "string" },
        weights_hash: { type: "string" },
        return_overlay: { type: "boolean" },
        priority: { type: "number", minimum: 0, maximum: 1000 },
        max_attempts: { type: "number", minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: "thyroid.ClassifyTiradsFeatures",
    description: "Placeholder for TI-RADS feature classification; returns a clear not-configured response until model-gateway is wired.",
    inputSchema: {
      type: "object",
      properties: {
        study_id: { type: "string" },
        image_id: { type: "string" },
        nodule_id: { type: "string" },
        image_uri: { type: "string" },
        crop_uri: { type: "string" },
        metadata: { type: "object" },
        trace_id: { type: "string" },
      },
      required: ["study_id", "image_id", "nodule_id"],
      additionalProperties: false,
    },
  },
  {
    name: "thyroid.CalculateTirads",
    description: "Calculate ACR TI-RADS 2017 score, category, and size-based recommendation from structured features.",
    inputSchema: {
      type: "object",
      properties: {
        system_name: { type: "string" },
        system_version: { type: "string" },
        features: {
          type: "object",
          properties: {
            composition: { type: "string" },
            echogenicity: { type: "string" },
            shape: { type: "string" },
            margin: { type: "string" },
            echogenic_foci: {
              oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
            },
          },
          additionalProperties: false,
        },
        size_mm: {
          type: "object",
          properties: {
            long_axis: { type: "number" },
            short_axis: { type: "number" },
            ap_axis: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      required: ["features"],
      additionalProperties: false,
    },
  },
];

export interface MedicalMcpServerOptions {
  baseUrl?: string;
  imageWorkerUrl?: string;
  modelGatewayUrl?: string;
  fetchImpl?: FetchLike;
}

export class MedicalMcpServer {
  private readonly imageWorker: ImageWorkerClient;
  private readonly modelGateway: ModelGatewayClient;

  constructor(options: MedicalMcpServerOptions = {}) {
    const fetchImpl = options.fetchImpl;
    const imageOptions: ImageWorkerClientOptions = {
      baseUrl: options.imageWorkerUrl ?? options.baseUrl,
      fetchImpl,
    };
    const modelOptions: ModelGatewayClientOptions = {
      baseUrl: options.modelGatewayUrl,
      fetchImpl,
    };
    this.imageWorker = new ImageWorkerClient(imageOptions);
    this.modelGateway = new ModelGatewayClient(modelOptions);
  }

  listTools(): ToolDescriptor[] {
    return TOOLS;
  }

  async callTool(name: string, args: unknown): Promise<ToolCallResult> {
    try {
      const input = asRecord(args);
      switch (name) {
        case "image.ParseDicom":
          return json(await this.imageWorker.call("/image/v1/parse-dicom", input));
        case "image.DeidentifyDicom":
          return json(await this.imageWorker.call("/image/v1/deidentify-dicom", input));
        case "image.RenderPreview":
          return json(await this.imageWorker.call("/image/v1/render-preview", input));
        case "image.PreprocessUltrasound":
          return json(await this.imageWorker.call("/image/v1/preprocess-ultrasound", input));
        case "image.ExtractCalibration":
          return json(await this.imageWorker.call("/image/v1/extract-calibration", input));
        case "image.ImageQualityCheck":
        case "thyroid.ImageQC":
          return json(await this.imageWorker.call("/image/v1/image-quality-check", input));
        case "thyroid.DetectNodules":
          return json(await this.modelGateway.call("/model/v1/infer/thyroid/detect-nodules", input));
        case "thyroid.ClassifyTiradsFeatures":
          return json(notConfigured("model_gateway_not_configured", "TI-RADS feature classification model gateway is not wired yet."));
        case "thyroid.CalculateTirads":
          return json(calculateAcrTirads(asTiradsInput(input)));
        default:
          return text(`unknown tool: ${name}`, true);
      }
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }
}

function json(value: unknown, isError = false): ToolCallResult {
  return text(JSON.stringify(value, null, 2), isError);
}

function text(value: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asTiradsInput(value: Record<string, unknown>) {
  const features = asRecord(value.features);
  if (Object.keys(features).length === 0) throw new Error("features is required");
  return {
    system_name: optionalString(value.system_name),
    system_version: optionalString(value.system_version),
    features: {
      composition: optionalString(features.composition),
      echogenicity: optionalString(features.echogenicity),
      shape: optionalString(features.shape),
      margin: optionalString(features.margin),
      echogenic_foci: optionalStringArray(features.echogenic_foci),
    },
    size_mm: value.size_mm ? asSizeMm(asRecord(value.size_mm)) : undefined,
  };
}

function asSizeMm(value: Record<string, unknown>) {
  return {
    long_axis: optionalNumber(value.long_axis),
    short_axis: optionalNumber(value.short_axis),
    ap_axis: optionalNumber(value.ap_axis),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return optionalString(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function notConfigured(code: string, message: string) {
  return {
    status: "error",
    result: {},
    warnings: [],
    error: { code, message },
  };
}
