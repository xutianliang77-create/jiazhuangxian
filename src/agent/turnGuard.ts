const DEFAULT_MAX_TURN_BYTES = 64 * 1024;
const DEFAULT_TERMINAL_RENDER_BYTES = 24 * 1024;
const DEFAULT_MAX_TOOL_TURNS = 24;
const DEFAULT_REPEATED_TOOL_CALL_LIMIT = 5;
const DEFAULT_MAX_OUTPUT_RECOVERY_TURNS = 2;
const DEFAULT_LOW_PROGRESS_TOOL_TURNS = 4;

function readPositiveInt(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    process.stderr.write(`[turn-guard] invalid ${name}=${raw}; using ${fallback}\n`);
    return fallback;
  }
  return fallback;
}

export function getMaxTurnBytes(): number {
  return readPositiveInt(["CODECLAW_MAX_TURN_BYTES", "CHATBI_MAX_TURN_BYTES"], DEFAULT_MAX_TURN_BYTES);
}

export function getTerminalRenderBytes(): number {
  return readPositiveInt(
    ["CODECLAW_TERMINAL_RENDER_BYTES", "CHATBI_TERMINAL_RENDER_BYTES"],
    DEFAULT_TERMINAL_RENDER_BYTES
  );
}

export function getMaxToolTurns(): number {
  return readPositiveInt(["CODECLAW_MAX_TOOL_TURNS", "CHATBI_MAX_TOOL_TURNS"], DEFAULT_MAX_TOOL_TURNS);
}

export function getRepeatedToolCallLimit(): number {
  return readPositiveInt(
    ["CODECLAW_REPEATED_TOOL_CALL_LIMIT", "CHATBI_REPEATED_TOOL_CALL_LIMIT"],
    DEFAULT_REPEATED_TOOL_CALL_LIMIT
  );
}

export function getMaxOutputRecoveryTurns(): number {
  return readPositiveInt(
    ["CODECLAW_MAX_OUTPUT_RECOVERY_TURNS", "CHATBI_MAX_OUTPUT_RECOVERY_TURNS"],
    DEFAULT_MAX_OUTPUT_RECOVERY_TURNS
  );
}

export function getLowProgressToolTurns(): number {
  return readPositiveInt(
    ["CODECLAW_LOW_PROGRESS_TOOL_TURNS", "CHATBI_LOW_PROGRESS_TOOL_TURNS"],
    DEFAULT_LOW_PROGRESS_TOOL_TURNS
  );
}

export interface TurnGuardStop {
  reason: string;
  message: string;
  outputBytes: number;
  limitBytes: number;
}

export class TurnGuard {
  private outputBytes = 0;

  constructor(private readonly maxTurnBytes = getMaxTurnBytes()) {}

  recordAssistantDelta(delta: string): TurnGuardStop | null {
    this.outputBytes += Buffer.byteLength(delta, "utf8");
    if (this.outputBytes <= this.maxTurnBytes) return null;
    const reason = `assistant output exceeded ${this.maxTurnBytes} bytes`;
    return {
      reason,
      message:
        `[CodeClaw stopped this response: ${reason}. ` +
        `This protects the terminal and keeps the model from occupying the current task indefinitely.]`,
      outputBytes: this.outputBytes,
      limitBytes: this.maxTurnBytes,
    };
  }

  getOutputBytes(): number {
    return this.outputBytes;
  }
}

export interface ToolLoopStop {
  reason: string;
  message: string;
  repeatCount: number;
  signature: string;
}

export interface ToolCallSignatureInput {
  name: string;
  args: unknown;
}

export class ToolLoopGuard {
  private lastSignature: string | null = null;
  private repeatCount = 0;

  constructor(private readonly repeatedToolCallLimit = getRepeatedToolCallLimit()) {}

  recordToolCalls(calls: ToolCallSignatureInput[]): ToolLoopStop | null {
    if (calls.length === 0) return null;
    const signature = calls
      .map((call) => `${call.name}:${stableStringify(call.args)}`)
      .sort()
      .join("|");
    if (signature === this.lastSignature) {
      this.repeatCount += 1;
    } else {
      this.lastSignature = signature;
      this.repeatCount = 1;
    }
    if (this.repeatCount < this.repeatedToolCallLimit) return null;
    const reason = `repeated identical tool calls ${this.repeatCount} times`;
    return {
      reason,
      message:
        `[CodeClaw stopped repeated tool calls: ${reason}. ` +
        `Use the existing tool results and provide the final answer instead.]`,
      repeatCount: this.repeatCount,
      signature,
    };
  }
}

export interface LowProgressInput {
  toolCallCount: number;
  successfulToolCount: number;
}

export interface LowProgressStop {
  reason: string;
  message: string;
  failedTurnCount: number;
}

export class LowProgressGuard {
  private failedToolTurns = 0;

  constructor(private readonly maxFailedToolTurns = getLowProgressToolTurns()) {}

  recordToolTurn(input: LowProgressInput): LowProgressStop | null {
    if (input.toolCallCount <= 0) return null;
    if (input.successfulToolCount > 0) {
      this.failedToolTurns = 0;
      return null;
    }
    this.failedToolTurns += 1;
    if (this.failedToolTurns < this.maxFailedToolTurns) return null;
    const reason = `low progress after ${this.failedToolTurns} failed tool turns`;
    return {
      reason,
      message:
        `[CodeClaw stopped low-progress tool retries: ${reason}. ` +
        `Summarize the failures, explain the best next step, and do not call more tools.]`,
      failedTurnCount: this.failedToolTurns,
    };
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}
