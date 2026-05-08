import { describe, expect, it } from "vitest";

import { parseIntent } from "../../../src/orchestration/intentParser";

describe("parseIntent", () => {
  it("keeps common source/config file references", () => {
    const intent = parseIntent("fix src/agent/queryEngine.ts and package.json");

    expect(intent.entities.files).toContain("src/agent/queryEngine.ts");
    expect(intent.entities.files).toContain("package.json");
  });

  it("does not treat dotted prose fields as files", () => {
    const intent = parseIntent("the error.code is 404 in section 3.2");

    expect(intent.entities.files).not.toContain("error.code");
    expect(intent.entities.files).not.toContain("3.2");
  });
});
