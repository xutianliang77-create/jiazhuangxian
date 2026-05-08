import { inspectDicomFile, prepareDicomForVision, renderDicomPreview } from "./dicom";
import type { ToolCallResult, ToolDescriptor } from "./types";

const TOOLS: ToolDescriptor[] = [
  {
    name: "InspectDicomFile",
    description:
      "Inspect a local DICOM Part 10 .dcm file, redact common PHI tags, and report whether CodeClaw can render it locally.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute local path to a .dcm file." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "RenderDicomPreview",
    description:
      "Render an uncompressed grayscale DICOM file to a PNG preview and write deidentified metadata JSON. Compressed transfer syntaxes return a clear unsupported error.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute local path to a .dcm file." },
        outputDir: { type: "string", description: "Optional output directory for PNG and metadata JSON." },
        windowCenter: { type: "number", description: "Optional window center override." },
        windowWidth: { type: "number", description: "Optional window width override." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "PrepareDicomForVision",
    description:
      "Render a DICOM preview PNG and return a safe prompt context for sending the PNG plus deidentified metadata to a vision model.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute local path to a .dcm file." },
        outputDir: { type: "string", description: "Optional output directory for PNG and metadata JSON." },
        windowCenter: { type: "number", description: "Optional window center override." },
        windowWidth: { type: "number", description: "Optional window width override." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

export class DicomMcpServer {
  listTools(): ToolDescriptor[] {
    return TOOLS;
  }

  async callTool(name: string, args: unknown): Promise<ToolCallResult> {
    try {
      const input = asRecord(args);
      switch (name) {
        case "InspectDicomFile": {
          const metadata = await inspectDicomFile(requiredString(input.path, "path"));
          return text(formatJson(metadata));
        }
        case "RenderDicomPreview": {
          const rendered = await renderDicomPreview({
            filePath: requiredString(input.path, "path"),
            outputDir: optionalString(input.outputDir),
            windowCenter: optionalNumber(input.windowCenter),
            windowWidth: optionalNumber(input.windowWidth),
          });
          return text(formatJson(rendered));
        }
        case "PrepareDicomForVision": {
          const prepared = await prepareDicomForVision({
            filePath: requiredString(input.path, "path"),
            outputDir: optionalString(input.outputDir),
            windowCenter: optionalNumber(input.windowCenter),
            windowWidth: optionalNumber(input.windowWidth),
          });
          return text(formatJson(prepared));
        }
        default:
          return text(`unknown tool: ${name}`, true);
      }
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }
}

function text(value: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
