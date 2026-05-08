import { describe, expect, it } from "vitest";
import { EvidenceStore } from "../../../src/agent/evidence";

describe("EvidenceStore", () => {
  it("records tool evidence even when args are undefined", () => {
    const store = new EvidenceStore();

    const item = store.recordTool({
      sessionId: "session-1",
      toolName: "NoArgTool",
      status: "succeeded",
      args: undefined,
      result: "ok",
      now: 1,
    });

    expect(item.argsHash).toHaveLength(64);
    expect(item.argsPreview).toBe("undefined");
    expect(store.list()).toHaveLength(1);
  });
});
