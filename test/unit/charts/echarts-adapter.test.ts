import { describe, expect, it } from "vitest";

import { toEChartsOption } from "../../../src/charts/echartsAdapter";
import { renderEChartsRuntimeScript } from "../../../src/charts/htmlRuntime";
import type { ChartColumn, ChartRenderInput, ChartSpec } from "../../../src/charts/types";

const columns: ChartColumn[] = [
  { name: "item_name", type: "VARCHAR", semanticRole: "dimension" },
  { name: "sold_at", type: "DATE", semanticRole: "time" },
  { name: "quantity", type: "INTEGER", semanticRole: "measure" },
  { name: "sales_amount", type: "DECIMAL", semanticRole: "measure" },
];

const rows = [
  { item_name: "Bread", sold_at: "2026-05-01", quantity: 10, sales_amount: 50 },
  { item_name: "Steak", sold_at: "2026-05-02", quantity: "3", sales_amount: "120" },
];

describe("toEChartsOption", () => {
  it("converts a bar ChartSpec into an ECharts axis option", () => {
    const { option, warnings } = toEChartsOption(input({ kind: "bar", title: "Top items", x: "item_name", y: "quantity" }));

    expect(warnings).toEqual([]);
    expect(option).toMatchObject({
      title: { text: "Top items" },
      xAxis: { type: "category", data: ["Bread", "Steak"] },
      yAxis: { type: "value" },
      series: [{ name: "quantity", type: "bar", data: [10, 3] }],
    });
    expect(JSON.stringify(option)).not.toContain("function");
  });

  it("converts line, area, pie, scatter, and combo specs", () => {
    expect(toEChartsOption(input({ kind: "line", x: "sold_at", y: "sales_amount" })).option).toMatchObject({
      series: [{ type: "line", data: [50, 120] }],
    });
    expect(toEChartsOption(input({ kind: "area", x: "sold_at", y: "quantity" })).option).toMatchObject({
      series: [{ type: "line", areaStyle: {} }],
    });
    expect(toEChartsOption(input({ kind: "pie", x: "item_name", y: "quantity" })).option).toMatchObject({
      series: [{ type: "pie", data: [{ name: "Bread", value: 10 }, { name: "Steak", value: 3 }] }],
    });
    expect(toEChartsOption(input({ kind: "scatter", x: "quantity", y: "sales_amount" })).option).toMatchObject({
      series: [{ type: "scatter", data: [[10, 50], [3, 120]] }],
    });
    expect(
      toEChartsOption(input({ kind: "combo", x: "item_name", y: ["quantity", "sales_amount"] })).option
    ).toMatchObject({
      series: [
        { type: "bar", data: [10, 3] },
        { type: "line", data: [50, 120] },
      ],
    });
  });

  it("throws on invalid specs and falls back for first-slice unsupported charts", () => {
    expect(() => toEChartsOption(input({ kind: "bar", x: "item_name", y: "missing" }))).toThrow(/invalid chart spec/);

    const result = toEChartsOption(input({ kind: "pivot" }));
    expect(result.option).toMatchObject({ dataset: { source: rows } });
    expect(result.warnings.join("\n")).toContain("table fallback");
  });

  it("renders ECharts runtime script in cdn, local, and none modes", () => {
    expect(renderEChartsRuntimeScript({ mode: "cdn", cdnUrl: "https://example.com/echarts.js" })).toContain(
      "https://example.com/echarts.js"
    );
    expect(renderEChartsRuntimeScript({ mode: "local", localPath: "/assets/echarts.js" })).toBe(
      '<script src="/assets/echarts.js"></script>'
    );
    expect(renderEChartsRuntimeScript({ mode: "none" })).toBe("");
  });
});

function input(spec: ChartSpec): ChartRenderInput {
  return { spec, rows, columns };
}
