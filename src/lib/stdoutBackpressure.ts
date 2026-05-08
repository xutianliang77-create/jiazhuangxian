// stdout backpressure 检测（v0.8.5 Phase 3）
//
// 背景：codex 用 Rust 同步 io::Write 写终端，buffer 满了 write 系统调用阻塞调用方，反压
// 自动传到 LLM stream 消费层。codeclaw 用 Node 异步 stream，buffer 满时 write 不阻塞，
// 字节会持续在 Node 内部 buffer 累积 → 终端 GUI 处理不过来 → 反向 hang。
//
// 治法：每个 yield 之前检测 process.stdout.writableNeedDrain，反压时短暂 await drain；
// 等不到就审计后 fail-open。不能无限等待：终端/pty 卡死但没抛 EIO 时，永久等 drain 会让
// Ctrl+C 也难以打断，反而造成“CodeClaw 卡住”。

export interface BackpressureAuditEvent {
  actor: "engine";
  action:
    | "stream.backpressure-stalled"
    | "stream.backpressure-cleared"
    | "stream.backpressure-timeout"
    | "stream.backpressure-aborted";
  waitedMs: number;
  reason?: string;
}

export interface WaitOptions {
  /** 注入 stdout 接口便于测试 */
  stream?: NodeJS.WriteStream;
  /** stall 警告间隔；默认 5 秒 */
  stallWarnIntervalMs?: number;
  /** 最长等待 drain；默认 10 秒。超时后 fail-open，避免终端卡死拖住 agent。 */
  maxWaitMs?: number;
  /** 父 turn abort 时立即停止等待。 */
  abortSignal?: AbortSignal;
  /** audit 回调，stall / cleared 时发送 */
  onAudit?: (event: BackpressureAuditEvent) => void;
  /** 测试用注入 setTimeout / setInterval / Date.now */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  nowFn?: () => number;
}

export async function waitForStdoutDrain(opts: WaitOptions = {}): Promise<void> {
  const stream = opts.stream ?? process.stdout;
  // Node 22+ 才有 writableNeedDrain；老版本无此字段视为始终无反压
  const needDrain = (stream as NodeJS.WriteStream & { writableNeedDrain?: boolean })
    .writableNeedDrain;
  if (!needDrain) return;

  const stallInterval = opts.stallWarnIntervalMs ?? 5_000;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  const nowFn = opts.nowFn ?? Date.now;
  const startedAt = nowFn();

  return new Promise<void>((resolve) => {
    let stallTimer: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    const cleanup = (): void => {
      if (stallTimer !== null) clearIntervalFn(stallTimer);
      if (maxTimer !== null) clearTimeoutFn(maxTimer);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      stream.off?.("drain", onDrain);
    };
    const finish = (action?: BackpressureAuditEvent["action"], reason?: string): void => {
      if (resolved) return;
      resolved = true;
      const waitedMs = nowFn() - startedAt;
      cleanup();
      if (action && opts.onAudit) {
        opts.onAudit({
          actor: "engine",
          action,
          waitedMs,
          ...(reason ? { reason } : {}),
        });
      }
      resolve();
    };
    const onDrain = (): void => {
      const waitedMs = nowFn() - startedAt;
      if (waitedMs > 1_000 && opts.onAudit) {
        opts.onAudit({
          actor: "engine",
          action: "stream.backpressure-cleared",
          waitedMs,
        });
      }
      finish();
    };
    const onAbort = (): void => {
      finish("stream.backpressure-aborted", "turn aborted while waiting for stdout drain");
    };
    if (opts.abortSignal?.aborted) {
      finish("stream.backpressure-aborted", "turn already aborted before waiting for stdout drain");
      return;
    }
    stream.once("drain", onDrain);
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
    maxTimer = setTimeoutFn(() => {
      finish(
        "stream.backpressure-timeout",
        `stdout drain not fired in ${maxWaitMs}ms; continuing to keep agent responsive`
      );
    }, maxWaitMs);
    stallTimer = setIntervalFn(() => {
      const waitedMs = nowFn() - startedAt;
      if (opts.onAudit) {
        opts.onAudit({
          actor: "engine",
          action: "stream.backpressure-stalled",
          waitedMs,
          reason: `stdout drain not fired in ${waitedMs}ms; terminal may be hung`,
        });
      }
    }, stallInterval);
  });
}
