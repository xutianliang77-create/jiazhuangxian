#!/usr/bin/env tsx
/**
 * Golden JSONL report viewer.
 *
 * JSONL reports are append-only by design. This viewer defaults to the latest
 * batch so old failed runs do not get confused with the current result.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

interface Config {
  report?: string;
  all?: boolean;
  failures?: boolean;
  json?: boolean;
  strict?: boolean;
  markdownPath?: string;
}

interface JsonlRow {
  type?: string;
  id?: string;
  category?: string;
  difficulty?: string;
  factId?: string;
  variant?: string;
  score?: {
    pass?: boolean;
    reason?: string;
    missed?: string[];
    triggered?: string[];
  };
  answerExcerpt?: string;
  [key: string]: unknown;
}

function parseArgs(argv: string[]): Config {
  const cfg: Config = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--report":
        cfg.report = argv[++i];
        break;
      case "--all":
        cfg.all = true;
        break;
      case "--failures":
        cfg.failures = true;
        break;
      case "--json":
        cfg.json = true;
        break;
      case "--strict":
        cfg.strict = true;
        break;
      case "--markdown":
        cfg.markdownPath = argv[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }
  return cfg;
}

function printHelp(): void {
  console.log(`
Golden JSONL report viewer

Options:
  --report <path>   JSONL report path.
  --all             Show all records in the latest batch.
  --failures        Show failed records only (default when failures exist).
  --json            Print latest batch as JSON.
  --markdown <path> Write latest batch as a Markdown report artifact.
  --strict          Exit 1 when the latest batch has failures.
  --help, -h        Show this help.
`);
}

function readRows(reportPath: string): JsonlRow[] {
  if (!existsSync(reportPath)) throw new Error(`report not found: ${reportPath}`);
  return readFileSync(reportPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as JsonlRow;
      } catch (err) {
        throw new Error(`${reportPath}:${index + 1}: invalid JSONL row: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
}

function latestBatch(rows: JsonlRow[]): { records: JsonlRow[]; summary: JsonlRow | null; batchStart: number; batchEnd: number } {
  const summaries = rows.map((row, index) => row.type === "summary" ? index : -1).filter((index) => index >= 0);
  if (summaries.length === 0) {
    return { records: rows.filter((row) => row.type === "record"), summary: null, batchStart: 0, batchEnd: rows.length - 1 };
  }
  const lastSummary = summaries.at(-1) ?? rows.length - 1;
  const previousSummary = summaries.length >= 2 ? summaries.at(-2) ?? -1 : -1;
  return {
    records: rows.slice(previousSummary + 1, lastSummary).filter((row) => row.type === "record"),
    summary: rows[lastSummary] ?? null,
    batchStart: previousSummary + 2,
    batchEnd: lastSummary + 1,
  };
}

function printHuman(reportPath: string, rows: JsonlRow[], cfg: Config): void {
  const batch = latestBatch(rows);
  const records = batch.records;
  const failures = records.filter((row) => row.score?.pass === false);
  const shown = cfg.all ? records : (cfg.failures || failures.length > 0 ? failures : []);
  const summary = batch.summary;
  const total = numberField(summary, "total", records.length);
  const passed = numberField(summary, "passed", records.filter((row) => row.score?.pass === true).length);
  const failed = numberField(summary, "failed", failures.length);
  const overallRate = numberField(summary, "overallRate", total === 0 ? 0 : passed / total);

  console.log(`Report: ${path.resolve(reportPath)}`);
  console.log(`Latest batch rows: ${batch.batchStart}-${batch.batchEnd}`);
  console.log(`Summary: total=${total} passed=${passed} failed=${failed} overall=${(overallRate * 100).toFixed(1)}%`);
  console.log(`Showing: ${cfg.all ? "all records" : failures.length > 0 ? "failures" : "summary only (no failures)"}`);
  console.log("");

  for (const row of shown) {
    const marker = row.score?.pass === false ? "FAIL" : "PASS";
    const label = [row.id, row.factId, row.category, row.difficulty, row.variant].filter(Boolean).join(" · ");
    console.log(`${marker} ${label}`);
    if (row.score?.reason) console.log(`  reason: ${row.score.reason}`);
    if (row.score?.missed?.length) console.log(`  missed: ${row.score.missed.slice(0, 5).join(" | ")}`);
    if (row.score?.triggered?.length) console.log(`  triggered: ${row.score.triggered.join(" | ")}`);
    if (row.answerExcerpt) console.log(`  answer: ${String(row.answerExcerpt).replace(/\s+/g, " ").slice(0, 220)}`);
  }
}

function buildMarkdown(reportPath: string, rows: JsonlRow[], cfg: Config): string {
  const batch = latestBatch(rows);
  const records = batch.records;
  const failures = records.filter((row) => row.score?.pass === false);
  const shown = cfg.all ? records : (cfg.failures || failures.length > 0 ? failures : []);
  const summary = batch.summary;
  const total = numberField(summary, "total", records.length);
  const passed = numberField(summary, "passed", records.filter((row) => row.score?.pass === true).length);
  const failed = numberField(summary, "failed", failures.length);
  const overallRate = numberField(summary, "overallRate", total === 0 ? 0 : passed / total);
  const lines: string[] = [];
  lines.push("# Golden Report");
  lines.push("");
  lines.push(`- Source: \`${path.resolve(reportPath)}\``);
  lines.push(`- Latest batch rows: ${batch.batchStart}-${batch.batchEnd}`);
  lines.push(`- Total: ${total}`);
  lines.push(`- Passed: ${passed}`);
  lines.push(`- Failed: ${failed}`);
  lines.push(`- Overall: ${(overallRate * 100).toFixed(1)}%`);
  lines.push(`- Showing: ${cfg.all ? "all records" : failures.length > 0 ? "failures" : "summary only"}`);
  lines.push("");
  if (shown.length === 0) {
    lines.push("No failed records in the latest batch.");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Result | ID | Fact | Category | Difficulty | Variant | Reason |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of shown) {
    lines.push([
      row.score?.pass === false ? "FAIL" : "PASS",
      mdCell(row.id),
      mdCell(row.factId),
      mdCell(row.category),
      mdCell(row.difficulty),
      mdCell(row.variant),
      mdCell(row.score?.reason),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  for (const row of shown) {
    const label = [row.id, row.factId, row.category, row.difficulty, row.variant].filter(Boolean).join(" · ");
    lines.push(`## ${row.score?.pass === false ? "FAIL" : "PASS"} ${label}`);
    lines.push("");
    if (row.score?.reason) lines.push(`- Reason: ${row.score.reason}`);
    if (row.score?.missed?.length) lines.push(`- Missed: ${row.score.missed.slice(0, 10).join(" | ")}`);
    if (row.score?.triggered?.length) lines.push(`- Triggered: ${row.score.triggered.join(" | ")}`);
    if (row.answerExcerpt) {
      lines.push("");
      lines.push("```text");
      lines.push(String(row.answerExcerpt).trim());
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function writeMarkdownReport(reportPath: string, rows: JsonlRow[], cfg: Config): void {
  if (!cfg.markdownPath) return;
  const outPath = path.resolve(cfg.markdownPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildMarkdown(reportPath, rows, cfg), "utf8");
  console.log(`Markdown: ${outPath}`);
}

function mdCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function numberField(row: JsonlRow | null, key: string, fallback: number): number {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function main(): number {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.report) {
    printHelp();
    return 2;
  }
  const rows = readRows(cfg.report);
  const batch = latestBatch(rows);
  if (cfg.json) {
    console.log(JSON.stringify(batch, null, 2));
  } else {
    printHuman(cfg.report, rows, cfg);
  }
  writeMarkdownReport(cfg.report, rows, cfg);
  return cfg.strict && batch.records.some((row) => row.score?.pass === false) ? 1 : 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`golden report viewer fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
