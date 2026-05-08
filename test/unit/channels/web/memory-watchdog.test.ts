import { describe, expect, it } from "vitest";

import { formatMemoryMessage, startWebMemoryWatchdog } from "../../../../src/channels/web/memoryWatchdog";

describe("web memory watchdog", () => {
  it("warns, stops cron once, and exits at the hard threshold", () => {
    const timer = { tick: undefined as (() => void) | undefined };
    const warnings: string[] = [];
    const stopped: string[] = [];
    const exits: string[] = [];
    let snapshot = snap(120);

    const watchdog = startWebMemoryWatchdog({
      intervalMs: 10,
      warnBytes: mb(100),
      stopCronBytes: mb(200),
      exitBytes: mb(300),
      memoryUsage: () => snapshot,
      setInterval: ((fn: () => void) => {
        timer.tick = fn;
        return 1 as never;
      }) as typeof setInterval,
      clearInterval: (() => undefined) as typeof clearInterval,
      onWarn: (message) => warnings.push(message),
      onStopCron: (message) => stopped.push(message),
      onExit: (message) => exits.push(message),
    });

    timer.tick?.();
    expect(warnings).toHaveLength(1);
    expect(stopped).toHaveLength(0);
    expect(exits).toHaveLength(0);

    snapshot = snap(250);
    timer.tick?.();
    timer.tick?.();
    expect(stopped).toHaveLength(1);
    expect(exits).toHaveLength(0);

    snapshot = snap(350);
    timer.tick?.();
    expect(exits).toHaveLength(1);

    watchdog.stop();
  });

  it("stops future checks", () => {
    const timer = { tick: undefined as (() => void) | undefined };
    const warnings: string[] = [];
    const watchdog = startWebMemoryWatchdog({
      warnBytes: mb(1),
      stopCronBytes: 0,
      exitBytes: 0,
      memoryUsage: () => snap(2),
      setInterval: ((fn: () => void) => {
        timer.tick = fn;
        return 1 as never;
      }) as typeof setInterval,
      clearInterval: (() => undefined) as typeof clearInterval,
      onWarn: (message) => warnings.push(message),
    });

    watchdog.stop();
    timer.tick?.();
    expect(warnings).toHaveLength(0);
  });

  it("formats memory snapshots", () => {
    expect(formatMemoryMessage("prefix", snap(12))).toContain("prefix: rss=12MB");
  });
});

function snap(rssMb: number) {
  return {
    rss: mb(rssMb),
    heapUsed: mb(4),
    heapTotal: mb(8),
  };
}

function mb(value: number): number {
  return value * 1024 * 1024;
}
