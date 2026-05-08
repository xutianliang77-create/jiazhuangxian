import type { FetchLike, WorkerResponse } from "./types";

export interface ModelGatewayClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class ModelGatewayClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ModelGatewayClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.JZX_MODEL_GATEWAY_URL ?? "http://127.0.0.1:8766").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(path: string, payload: Record<string, unknown>): Promise<WorkerResponse> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      const parsed = parseJson(text);
      if (!isWorkerResponse(parsed)) {
        return {
          status: "error",
          error: {
            code: "invalid_model_gateway_response",
            message: "model-gateway returned a non-standard response",
            detail: { status: response.status, body: text.slice(0, 1000) },
          },
        };
      }
      if (!response.ok && parsed.status === "ok") {
        return {
          status: "error",
          result: parsed.result,
          warnings: parsed.warnings,
          trace_id: parsed.trace_id,
          error: {
            code: "model_gateway_http_error",
            message: `model-gateway returned HTTP ${response.status}`,
          },
        };
      }
      return parsed;
    } catch (err) {
      return {
        status: "error",
        error: {
          code: "model_gateway_unreachable",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.status === "ok" || record.status === "error";
}
