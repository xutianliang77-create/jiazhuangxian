export interface WebMemorySnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
}

export interface WebMemoryWatchdog {
  stop(): void;
}

export interface WebMemoryWatchdogOptions {
  intervalMs?: number;
  warnBytes?: number;
  stopCronBytes?: number;
  exitBytes?: number;
  memoryUsage?: () => WebMemorySnapshot;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  onWarn?: (message: string, snapshot: WebMemorySnapshot) => void;
  onStopCron?: (message: string, snapshot: WebMemorySnapshot) => void;
  onExit?: (message: string, snapshot: WebMemorySnapshot) => void;
}

const MB = 1024 * 1024;
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_WARN_MB = 1024;
const DEFAULT_STOP_CRON_MB = 1536;
const DEFAULT_EXIT_MB = 3072;
const WARN_THROTTLE_MS = 5 * 60_000;

export function startWebMemoryWatchdog(options: WebMemoryWatchdogOptions = {}): WebMemoryWatchdog {
  const intervalMs = options.intervalMs ?? readNumberEnv("CODECLAW_WEB_MEMORY_CHECK_MS", DEFAULT_INTERVAL_MS, 1);
  const warnBytes = options.warnBytes ?? readNumberEnv("CODECLAW_WEB_MEMORY_WARN_MB", DEFAULT_WARN_MB, MB);
  const stopCronBytes =
    options.stopCronBytes ?? readNumberEnv("CODECLAW_WEB_MEMORY_STOP_CRON_MB", DEFAULT_STOP_CRON_MB, MB);
  const exitBytes = options.exitBytes ?? readNumberEnv("CODECLAW_WEB_MEMORY_EXIT_MB", DEFAULT_EXIT_MB, MB);
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;
  const onWarn = options.onWarn ?? ((message) => console.warn(message));
  const onStopCron = options.onStopCron ?? ((message) => console.error(message));
  const onExit = options.onExit ?? ((message) => {
    console.error(message);
    process.exit(1);
  });

  let stopped = false;
  let cronStopped = false;
  let lastWarnAt = 0;

  const check = () => {
    if (stopped) return;
    const snapshot = memoryUsage();
    const now = Date.now();
    if (warnBytes > 0 && snapshot.rss >= warnBytes && now - lastWarnAt > WARN_THROTTLE_MS) {
      lastWarnAt = now;
      onWarn(formatMemoryMessage("[web-memory] warning", snapshot), snapshot);
    }
    if (!cronStopped && stopCronBytes > 0 && snapshot.rss >= stopCronBytes) {
      cronStopped = true;
      onStopCron(formatMemoryMessage("[web-memory] stopping cron scheduler", snapshot), snapshot);
    }
    if (exitBytes > 0 && snapshot.rss >= exitBytes) {
      onExit(formatMemoryMessage("[web-memory] hard limit exceeded; exiting web process", snapshot), snapshot);
    }
  };

  const timer = setIntervalFn(check, intervalMs);
  return {
    stop() {
      stopped = true;
      clearIntervalFn(timer);
    },
  };
}

export function formatMemoryMessage(prefix: string, snapshot: WebMemorySnapshot): string {
  return `${prefix}: rss=${formatMb(snapshot.rss)}, heapUsed=${formatMb(snapshot.heapUsed)}, heapTotal=${formatMb(snapshot.heapTotal)}`;
}

function readNumberEnv(name: string, fallback: number, multiplier: number): number {
  const raw = process.env[name];
  if (!raw) return fallback * multiplier;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback * multiplier;
  return parsed * multiplier;
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)}MB`;
}
