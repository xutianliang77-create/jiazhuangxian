import { describe, expect, it } from "vitest";
import { detectProviderCapabilities } from "../../../src/provider/capabilities";
import type { ProviderStatus } from "../../../src/provider/types";

function provider(model: string): ProviderStatus {
  return {
    instanceId: "lmstudio:test",
    type: "lmstudio",
    displayName: "LM Studio",
    kind: "local",
    enabled: true,
    requiresApiKey: false,
    baseUrl: "http://127.0.0.1:1234/v1",
    model,
    timeoutMs: 30_000,
    envVars: [],
    fileConfig: {},
    configured: true,
    available: true,
    reason: "test",
  };
}

describe("detectProviderCapabilities", () => {
  it("recognizes medgemma as an LM Studio vision-capable model", () => {
    expect(detectProviderCapabilities(provider("medgemma-1.5-4b-it")).vision).toBe("supported");
  });

  it("keeps text-only qwen3 classified as unsupported for image input", () => {
    expect(detectProviderCapabilities(provider("qwen/qwen3.6-27b")).vision).toBe("unsupported");
  });
});
