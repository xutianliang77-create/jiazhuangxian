import { describe, expect, it } from "vitest";
import { formatTerminalIoLog, isTerminalIoError } from "../../../src/lib/terminalIo";

describe("terminal IO guard", () => {
  it("detects terminal read/write EIO and EPIPE errors", () => {
    expect(isTerminalIoError(Object.assign(new Error("write EIO"), { code: "EIO" }))).toBe(true);
    expect(isTerminalIoError(new Error("read EPIPE"))).toBe(true);
    expect(isTerminalIoError(new Error("provider failed"))).toBe(false);
  });

  it("formats terminal IO failures without a full stack", () => {
    const msg = formatTerminalIoLog(Object.assign(new Error("write EIO\nstack line"), { code: "EIO" }));

    expect(msg).toBe("terminal io closed (EIO): write EIO");
  });
});
