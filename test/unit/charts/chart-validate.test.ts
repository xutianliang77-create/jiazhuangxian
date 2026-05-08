import { describe, expect, it } from "vitest";

import { validateChartSpec } from "../../../src/charts/validate";
import type { ChartColumn, ChartSpec } from "../../../src/charts/types";

const columns: ChartColumn[] = [
  { name: "item_name", type: "VARCHAR", semanticRole: "dimension" },
  { name: "sold_at", type: "DATE", semanticRole: "time" },
  { name: "quantity", type: "INTEGER", semanticRole: "measure" },
  { name: "sales_amount", type: "DECIMAL", semanticRole: "measure" },
];

describe("validateChartSpec", () => {
  it("accepts bar, line, pie, and scatter charts with valid fields", () => {
    expect(valid({ kind: "bar", x: "item_name", y: "quantity" })).toBe(true);
    expect(valid({ kind: "line", x: "sold_at", y: "sales_amount" })).toBe(true);
    expect(valid({ kind: "pie", x: "item_name", y: "quantity" })).toBe(true);
    expect(valid({ kind: "scatter", x: "quantity", y: "sales_amount" })).toBe(true);
  });

  it("rejects missing and unknown fields", () => {
    const result = validateChartSpec({ kind: "bar", x: "missing", y: "quantity" }, columns);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("x field does not exist: missing");
  });

  it("rejects non-numeric measure fields", () => {
    const result = validateChartSpec({ kind: "bar", x: "sold_at", y: "item_name" }, columns);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("y field must be numeric: item_name");
  });

  it("warns for high limits and line charts with non-time x fields", () => {
    const result = validateChartSpec({ kind: "line", x: "item_name", y: "quantity", limit: 5000 }, columns);
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("chart limit is high");
    expect(result.warnings.join("\n")).toContain("line/area charts usually work best");
  });

  it("warns when pivot falls back to table", () => {
    const result = validateChartSpec({ kind: "pivot" }, columns);
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("pivot rendering falls back");
  });
});

function valid(spec: ChartSpec): boolean {
  return validateChartSpec(spec, columns).valid;
}
