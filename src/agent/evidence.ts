import { createHash } from "node:crypto";

export type EvidenceStatus = "succeeded" | "failed" | "blocked";

export interface ToolEvidence {
  id: string;
  sessionId: string;
  toolName: string;
  status: EvidenceStatus;
  createdAt: number;
  argsHash: string;
  argsPreview: string;
  resultSummary: string;
  toolCallId?: string;
  assistantMessageId?: string;
  artifactPath?: string;
  errorCode?: string;
}

export interface RecordToolEvidenceInput {
  sessionId: string;
  toolName: string;
  status: EvidenceStatus;
  args: unknown;
  result: string;
  toolCallId?: string;
  assistantMessageId?: string;
  artifactPath?: string;
  errorCode?: string;
  now?: number;
}

const DEFAULT_MAX_EVIDENCE = 200;
const PREVIEW_CHARS = 500;

export class EvidenceStore {
  private readonly items: ToolEvidence[] = [];

  constructor(private readonly maxItems = DEFAULT_MAX_EVIDENCE) {}

  recordTool(input: RecordToolEvidenceInput): ToolEvidence {
    const createdAt = input.now ?? Date.now();
    const evidence: ToolEvidence = {
      id: `ev-${createdAt}-${this.items.length + 1}`,
      sessionId: input.sessionId,
      toolName: input.toolName,
      status: input.status,
      createdAt,
      argsHash: hashValue(input.args),
      argsPreview: clip(stableStringify(input.args), PREVIEW_CHARS),
      resultSummary: clip(input.result.replace(/\s+/g, " ").trim(), PREVIEW_CHARS),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.assistantMessageId ? { assistantMessageId: input.assistantMessageId } : {}),
      ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    };
    this.items.push(evidence);
    if (this.items.length > this.maxItems) {
      this.items.splice(0, this.items.length - this.maxItems);
    }
    return evidence;
  }

  list(): ToolEvidence[] {
    return this.items.map((item) => ({ ...item }));
  }

  recent(limit = 20): ToolEvidence[] {
    return this.items.slice(-Math.max(1, limit)).map((item) => ({ ...item }));
  }
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}
