import { describe, expect, it } from "vitest";
import { legacyBinaryWarning } from "../../../src/cli/legacy";

describe("legacyBinaryWarning", () => {
  it("warns when the process is invoked through the old chatbi binary name", () => {
    expect(legacyBinaryWarning("/usr/local/bin/chatbi")).toContain("renamed to `codeclaw`");
  });

  it("warns for old JavaScript shim names", () => {
    expect(legacyBinaryWarning("/usr/local/bin/chatbi.js")).toContain("npm link");
  });

  it("does not warn for the current codeclaw binary or direct dist entry", () => {
    expect(legacyBinaryWarning("/usr/local/bin/codeclaw")).toBeUndefined();
    expect(legacyBinaryWarning("/repo/dist/cli.js")).toBeUndefined();
  });
});
