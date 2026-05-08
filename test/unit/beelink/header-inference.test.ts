import { describe, expect, it } from "vitest";
import { inferHeaderHints } from "../../../packages/beelink-mcp/src/headerInference";
import type { QueryPreview } from "../../../packages/beelink-mcp/src/types";

describe("beelink header inference", () => {
  it("infers business names from first-row headers and keeps sample values", async () => {
    const client = {
      async runSqlQuery(): Promise<QueryPreview> {
        return {
          queryId: "q-1",
          columns: [
            { name: "A", type: "UNKNOWN" },
            { name: "E", type: "UNKNOWN" },
          ],
          rows: [
            { A: "Customer_id", E: "items" },
            { A: "JXJY167254JK", E: "Pizza:Water" },
            { A: "XVTR474839TP", E: "Banana shake:" },
          ],
          truncated: false,
        };
      },
    };

    const columns = await inferHeaderHints(
      client as never,
      "@x.food_daily",
      [
        { name: "A", type: "UNKNOWN" },
        { name: "E", type: "UNKNOWN" },
      ],
      { timeoutMs: 1000 }
    );

    expect(columns).toEqual([
      expect.objectContaining({
        name: "A",
        businessName: "Customer_id",
        sampleValues: ["JXJY167254JK", "XVTR474839TP"],
        headerConfidence: 0.9,
      }),
      expect.objectContaining({
        name: "E",
        businessName: "items",
        sampleValues: ["Pizza:Water", "Banana shake:"],
        headerConfidence: 0.9,
      }),
    ]);
  });
});
