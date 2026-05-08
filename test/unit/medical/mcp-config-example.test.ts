import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseMcpConfig } from "../../../src/mcp/config";

const ROOT = path.resolve(__dirname, "../../..");
const EXAMPLE = path.join(ROOT, "examples", "mcp.medical.validation.json");

describe("medical MCP config example", () => {
  it("is parseable by CodeClaw MCP config loader", () => {
    const config = parseMcpConfig(readFileSync(EXAMPLE, "utf8"), EXAMPLE);
    expect(config.servers.medical).toEqual({
      command: "npm",
      args: ["--silent", "run", "medical:mcp"],
      env: {
        JZX_IMAGE_WORKER_URL: "http://127.0.0.1:8765",
        JZX_MODEL_GATEWAY_URL: "http://127.0.0.1:8766",
      },
      disabled: false,
    });
  });

  it("keeps the MCP server separate from long-running HTTP workers", () => {
    const config = parseMcpConfig(readFileSync(EXAMPLE, "utf8"), EXAMPLE);
    const medical = config.servers.medical;
    expect(medical.command).toBe("npm");
    expect(medical.args).toEqual(["--silent", "run", "medical:mcp"]);
    expect(medical.env?.JZX_IMAGE_WORKER_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(medical.env?.JZX_MODEL_GATEWAY_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});
