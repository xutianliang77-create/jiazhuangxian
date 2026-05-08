import type { FetchLike, WorkerResponse } from "./types";

export interface ImageWorkerClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class ImageWorkerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ImageWorkerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.JZX_IMAGE_WORKER_URL ?? "http://127.0.0.1:8765").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(path: string, payload: Record<string, unknown>): Promise<WorkerResponse> {
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
          code: "invalid_worker_response",
          message: "image-worker returned a non-standard response",
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
          code: "worker_http_error",
          message: `image-worker returned HTTP ${response.status}`,
        },
      };
    }
    return parsed;
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
