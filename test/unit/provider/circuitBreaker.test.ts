import { afterEach, describe, expect, it } from "vitest";
import {
  ProviderCircuitBreaker,
  ProviderCircuitOpenError,
  getProviderCooldownMs,
  getProviderMaxConcurrency,
  getProviderStuckThreshold,
  getProviderTransientCooldownMs,
  getProviderTransientThreshold,
  isProviderTransientError,
} from "../../../src/provider/circuitBreaker";
import type { ProviderStatus } from "../../../src/provider/types";

const provider: ProviderStatus = {
  instanceId: "lmstudio:default",
  type: "lmstudio",
  displayName: "LM Studio",
  kind: "local",
  enabled: true,
  requiresApiKey: false,
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "qwen",
  timeoutMs: 30_000,
  envVars: [],
  fileConfig: {},
  configured: true,
  available: true,
  reason: "configured",
};

afterEach(() => {
  delete process.env.CHATBI_PROVIDER_MAX_CONCURRENCY;
  delete process.env.CODECLAW_PROVIDER_MAX_CONCURRENCY;
  delete process.env.CHATBI_PROVIDER_COOLDOWN_MS;
  delete process.env.CODECLAW_PROVIDER_COOLDOWN_MS;
  delete process.env.CHATBI_PROVIDER_STUCK_THRESHOLD;
  delete process.env.CODECLAW_PROVIDER_STUCK_THRESHOLD;
  delete process.env.CHATBI_PROVIDER_TRANSIENT_COOLDOWN_MS;
  delete process.env.CODECLAW_PROVIDER_TRANSIENT_COOLDOWN_MS;
  delete process.env.CHATBI_PROVIDER_TRANSIENT_THRESHOLD;
  delete process.env.CODECLAW_PROVIDER_TRANSIENT_THRESHOLD;
});

describe("ProviderCircuitBreaker", () => {
  it("reads CodeClaw env limits before legacy env limits", () => {
    process.env.CODECLAW_PROVIDER_MAX_CONCURRENCY = "4";
    process.env.CHATBI_PROVIDER_MAX_CONCURRENCY = "1";
    process.env.CHATBI_PROVIDER_COOLDOWN_MS = "123";
    process.env.CHATBI_PROVIDER_STUCK_THRESHOLD = "4";
    process.env.CHATBI_PROVIDER_TRANSIENT_COOLDOWN_MS = "456";
    process.env.CHATBI_PROVIDER_TRANSIENT_THRESHOLD = "5";

    expect(getProviderMaxConcurrency()).toBe(4);
    expect(getProviderCooldownMs()).toBe(123);
    expect(getProviderStuckThreshold()).toBe(4);
    expect(getProviderTransientCooldownMs()).toBe(456);
    expect(getProviderTransientThreshold()).toBe(5);
  });

  it("blocks acquire when concurrency is full", () => {
    const breaker = new ProviderCircuitBreaker({ maxConcurrency: 1, cooldownMs: 1000 });

    const token = breaker.acquire(provider);

    expect(() => breaker.acquire(provider)).toThrow(ProviderCircuitOpenError);
    breaker.release(token, "success");
    expect(() => breaker.acquire(provider)).not.toThrow();
  });

  it("opens cooldown after a stuck outcome", () => {
    let now = 1000;
    const breaker = new ProviderCircuitBreaker({
      maxConcurrency: 1,
      cooldownMs: 5000,
      stuckThreshold: 1,
      now: () => now,
    });

    const token = breaker.acquire(provider);
    breaker.release(token, "stuck", "assistant output exceeded 8 bytes");

    expect(() => breaker.acquire(provider)).toThrow(/cooling down/);
    now = 7000;
    expect(() => breaker.acquire(provider)).not.toThrow();
  });

  it("opens a short cooldown after repeated transient failures", () => {
    let now = 1000;
    const breaker = new ProviderCircuitBreaker({
      maxConcurrency: 1,
      transientCooldownMs: 2000,
      transientThreshold: 2,
      now: () => now,
    });

    const first = breaker.acquire(provider);
    breaker.release(first, "transient_failure", "fetch failed");
    const second = breaker.acquire(provider);
    expect(second.providerLabel).toBe("LM Studio");
    breaker.release(second, "transient_failure", "ECONNRESET");

    expect(() => breaker.acquire(provider)).toThrow(/cooling down/);
    now = 3500;
    expect(() => breaker.acquire(provider)).not.toThrow();
  });

  it("clears transient failures after a successful call", () => {
    const breaker = new ProviderCircuitBreaker({
      maxConcurrency: 1,
      transientThreshold: 2,
    });

    const first = breaker.acquire(provider);
    breaker.release(first, "transient_failure", "fetch failed");
    const second = breaker.acquire(provider);
    breaker.release(second, "success");

    expect(breaker.snapshot()[0]?.transientFailureCount).toBe(0);
  });

  it("classifies network-like provider failures as transient", () => {
    expect(isProviderTransientError(new Error("fetch failed"))).toBe(true);
    expect(isProviderTransientError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isProviderTransientError(Object.assign(new Error("bad gateway"), { statusCode: 502 }))).toBe(true);
    expect(isProviderTransientError(Object.assign(new Error("rate limited"), { statusCode: 429 }))).toBe(true);
    expect(isProviderTransientError(new Error("invalid request"))).toBe(false);
  });

  it("uses relaxed defaults for complex tasks", () => {
    expect(getProviderCooldownMs()).toBe(30_000);
    expect(getProviderStuckThreshold()).toBe(2);
    expect(getProviderTransientCooldownMs()).toBe(10_000);
    expect(getProviderTransientThreshold()).toBe(3);
  });
});
