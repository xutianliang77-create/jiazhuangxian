/**
 * CodeClaw Data Golden Suite reporting.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DataGoldenLayer,
  DataGoldenRunRecord,
  DataGoldenRunSummary,
} from "./data-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_REPORTS_DIR = path.resolve(__dirname, "..", "reports");

const ALL_LAYERS: DataGoldenLayer[] = [
  "metadata",
  "semantic",
  "sql",
  "execution",
  "repair",
  "chart",
  "report",
  "security",
  "workflow",
  "runtime",
];

const LAYER_GATES: Record<DataGoldenLayer, number> = {
  metadata: 0.9,
  semantic: 0.9,
  sql: 0.9,
  execution: 0.9,
  repair: 0.8,
  chart: 0.8,
  report: 0.8,
  security: 1.0,
  workflow: 0.85,
  runtime: 0.85,
};

export function summarizeDataGolden(
  records: DataGoldenRunRecord[],
  startedAt: number
): DataGoldenRunSummary {
  const total = records.length;
  const passed = records.filter((record) => record.score.pass).length;
  const failed = total - passed;

  const byLayer = Object.fromEntries(
    ALL_LAYERS.map((layer) => [layer, { total: 0, passed: 0, rate: 0 }])
  ) as Record<DataGoldenLayer, { total: number; passed: number; rate: number }>;

  for (const record of records) {
    byLayer[record.layer].total += 1;
    if (record.score.pass) byLayer[record.layer].passed += 1;
  }

  for (const layer of ALL_LAYERS) {
    const stats = byLayer[layer];
    stats.rate = stats.total === 0 ? 1 : stats.passed / stats.total;
  }

  const overallRate = total === 0 ? 0 : passed / total;
  const meetsGate =
    overallRate >= 0.9 &&
    ALL_LAYERS.every((layer) => byLayer[layer].total === 0 || byLayer[layer].rate >= LAYER_GATES[layer]);

  return {
    total,
    passed,
    failed,
    byLayer,
    overallRate,
    meetsGate,
    startedAt,
    durationMs: Date.now() - startedAt,
  };
}

export function writeJsonlReportDataGolden(
  records: DataGoldenRunRecord[],
  summary: DataGoldenRunSummary,
  outPath: string
): void {
  ensureDir(path.dirname(outPath));
  for (const record of records) {
    appendFileSync(outPath, JSON.stringify({ type: "record", ...record }) + "\n");
  }
  appendFileSync(outPath, JSON.stringify({ type: "summary", ...summary }) + "\n");
}

export function printSummaryDataGolden(summary: DataGoldenRunSummary): void {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  console.log("");
  console.log("─".repeat(64));
  console.log("Golden Set · CodeClaw Data 汇总");
  console.log("─".repeat(64));
  console.log(`  total:    ${summary.total}`);
  console.log(`  passed:   ${summary.passed}`);
  console.log(`  failed:   ${summary.failed}`);
  console.log(`  overall:  ${pct(summary.overallRate)}  (gate 90.0%)`);
  console.log(`  duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log("");
  console.log("  by layer:");
  for (const layer of ALL_LAYERS) {
    const stats = summary.byLayer[layer];
    if (stats.total === 0) continue;
    const gate = LAYER_GATES[layer];
    const marker = stats.rate >= gate ? "✓" : "✗";
    console.log(
      `    ${marker} ${layer.padEnd(10)} ${stats.passed}/${stats.total}  ${pct(stats.rate)}  (gate ${pct(gate)})`
    );
  }
  console.log("");
  console.log(summary.meetsGate ? "  RESULT: PASS · 数据黄金集达标" : "  RESULT: FAIL · 数据黄金集未达标");
  console.log("─".repeat(64));
}

export function defaultDataGoldenReportPath(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return path.join(DATA_REPORTS_DIR, `${yyyy}-${mm}-${dd}-data.jsonl`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
