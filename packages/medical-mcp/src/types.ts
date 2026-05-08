export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface WorkerResponse {
  status: "ok" | "error";
  result?: Record<string, unknown>;
  warnings?: string[];
  trace_id?: string;
  error?: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
