#!/usr/bin/env tsx
/**
 * CodeClaw Dialect Traps Golden runner.
 *
 * Usage:
 *   npm run golden:dialect -- --dry-run
 *   npm run golden:dialect -- --mock
 *   npm run golden:dialect -- --id dq02 --verbose
 *   npm run golden:dialect -- --trap T11
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { matchesSubstring } from "./normalize";
import { createRealInvoker, type LlmInvoker } from "./provider";
import type { AskQuestion } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.resolve(__dirname, "..", "dialect", "DIALECT-TRAPS.json");
const REPORTS_DIR = path.resolve(__dirname, "..", "reports");

type Difficulty = "easy" | "medium" | "hard";

interface DialectTrapCase {
  id: string;
  category: string;
  dialect_trap_id: string[];
  question: string;
  expected_must_contain: string[];
  expected_must_not_contain: string[];
  expected_outcome?: string | null;
  difficulty: Difficulty;
  notes?: string;
}

interface DialectSource {
  version: string;
  total: number;
  items: DialectTrapCase[];
}

interface RunnerConfig {
  source: string;
  dryRun?: boolean;
  verbose?: boolean;
  useMock: boolean;
  ids?: string[];
  categories?: string[];
  difficulties?: Difficulty[];
  traps?: string[];
  reportPath?: string;
}

interface Invocation {
  provider?: string;
  modelId?: string;
  answer: string;
  latencyMs: number;
}

interface ScoreResult {
  pass: boolean;
  matched: string[];
  missed: string[];
  triggered: string[];
  reason: string;
}

interface RunRecord {
  id: string;
  version: string;
  category: string;
  difficulty: Difficulty;
  traps: string[];
  provider?: string;
  modelId?: string;
  promptChars: number;
  answerChars: number;
  answerExcerpt: string;
  latencyMs: number;
  score: ScoreResult;
  timestamp: number;
}

function parseArgs(argv: string[]): RunnerConfig {
  const cfg: RunnerConfig = { source: DEFAULT_SOURCE, useMock: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--source":
        cfg.source = argv[++i] ?? cfg.source;
        break;
      case "--dry-run":
        cfg.dryRun = true;
        break;
      case "--mock":
        cfg.useMock = true;
        break;
      case "--real":
        cfg.useMock = false;
        break;
      case "--verbose":
      case "-v":
        cfg.verbose = true;
        break;
      case "--id":
        cfg.ids = (cfg.ids ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--category":
        cfg.categories = (cfg.categories ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--difficulty":
        cfg.difficulties = (cfg.difficulties ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean) as Difficulty[]);
        break;
      case "--trap":
        cfg.traps = (cfg.traps ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--report":
        cfg.reportPath = argv[++i];
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
Golden Set · SQL dialect traps

Options:
  --dry-run                Load and validate cases only.
  --mock                   Use deterministic mock SQL output (default).
  --real                   Use configured provider to generate SQL text.
  --source <path>          Override source JSON path.
  --id <id,...>            Run selected ids, e.g. dq02,cq04.
  --category <cat,...>     Filter category.
  --difficulty <d,...>     Filter easy|medium|hard.
  --trap <T11,...>         Filter by dialect trap id.
  --report <path>          Write JSONL report.
  --verbose, -v            Print each case.
`);
}

function loadDialectCases(filePath: string): { version: string; cases: DialectTrapCase[] } {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as DialectSource;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) {
    throw new Error(`${filePath}: root.items must be an array`);
  }
  const cases = raw.items.map(validateCase);
  if (raw.total !== cases.length) {
    throw new Error(`${filePath}: total=${raw.total} but items=${cases.length}`);
  }
  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) throw new Error(`${filePath}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return { version: raw.version, cases };
}

function validateCase(item: unknown, index: number): DialectTrapCase {
  const file = `dialect#${index + 1}`;
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${file}: case must be object`);
  const obj = item as Record<string, unknown>;
  const id = requiredString(obj, "id", file);
  const category = requiredString(obj, "category", file);
  const question = requiredString(obj, "question", file);
  const difficulty = requiredString(obj, "difficulty", file) as Difficulty;
  if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error(`${file}: invalid difficulty ${difficulty}`);
  const dialectTrapId = requiredStringArray(obj, "dialect_trap_id", file);
  const mustContain = requiredStringArray(obj, "expected_must_contain", file);
  const mustNotContain = optionalStringArray(obj, "expected_must_not_contain");
  if (mustContain.length === 0) throw new Error(`${file}: expected_must_contain must not be empty`);
  return {
    id,
    category,
    dialect_trap_id: dialectTrapId,
    question,
    expected_must_contain: mustContain,
    expected_must_not_contain: mustNotContain,
    expected_outcome: typeof obj.expected_outcome === "string" ? obj.expected_outcome : null,
    difficulty,
    ...(typeof obj.notes === "string" ? { notes: obj.notes } : {}),
  };
}

function requiredString(obj: Record<string, unknown>, key: string, file: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${file}: ${key} required`);
  return value;
}

function requiredStringArray(obj: Record<string, unknown>, key: string, file: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${file}: ${key} must be string[]`);
  }
  return value as string[];
}

function optionalStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${key} must be string[]`);
  }
  return value as string[];
}

async function invokeMock(item: DialectTrapCase): Promise<Invocation> {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 2));
  return {
    provider: "mock",
    modelId: "mock-dialect",
    answer: [
      `-- mock SQL for ${item.id}`,
      "SELECT",
      ...item.expected_must_contain.map((part) => `  ${part}`),
      ";",
    ].join("\n"),
    latencyMs: Date.now() - start,
  };
}

async function invokeReal(invoker: LlmInvoker, item: DialectTrapCase): Promise<Invocation> {
  return invoker.invoke(toAskQuestion(item));
}

function toAskQuestion(item: DialectTrapCase): AskQuestion {
  return {
    id: item.id,
    version: 1,
    category: "code-understanding",
    difficulty: item.difficulty,
    requires: {},
    prompt: [
      "你正在参加 CodeClaw SQL 方言 golden 测试。",
      "请为下面的问题生成 Dremio 兼容 SQL。",
      "只输出 SQL；不要解释；不要使用 Markdown 代码围栏。",
      "必须避免不兼容方言、错误引用和未限定表名。",
      "",
      `问题：${item.question}`,
    ].join("\n"),
    expected: {
      must_mention: item.expected_must_contain,
      must_not_mention: item.expected_must_not_contain,
      rubric: item.notes,
    },
  };
}

function scoreDialect(item: DialectTrapCase, answer: string): ScoreResult {
  const matched: string[] = [];
  const missed: string[] = [];
  const triggered: string[] = [];
  for (const needle of item.expected_must_contain) {
    if (matchesSubstring(answer, needle)) matched.push(needle);
    else missed.push(needle);
  }
  for (const needle of item.expected_must_not_contain) {
    if (matchesForbiddenDialect(answer, needle)) triggered.push(needle);
  }
  const pass = missed.length === 0 && triggered.length === 0;
  const parts = [`must=${matched.length}/${item.expected_must_contain.length}`];
  if (missed.length) parts.push(`missed=[${missed.slice(0, 3).join(",")}${missed.length > 3 ? "..." : ""}]`);
  if (triggered.length) parts.push(`triggered=[${triggered.join(",")}]`);
  if (item.expected_outcome) parts.push(`expected_outcome=${item.expected_outcome}`);
  return { pass, matched, missed, triggered, reason: parts.join(" ") };
}

function matchesForbiddenDialect(answer: string, needle: string): boolean {
  if (!matchesSubstring(answer, needle)) return false;
  const normalizedNeedle = needle.normalize("NFKC").toLowerCase();
  const normalizedAnswer = answer.normalize("NFKC").toLowerCase();
  let index = normalizedAnswer.indexOf(normalizedNeedle);
  while (index >= 0) {
    const previous = index > 0 ? normalizedAnswer[index - 1] : "";
    // A forbidden unqualified suffix such as "wenshu_demo.sales_orders\n"
    // should not fire on the valid fully qualified "mysql.wenshu_demo.sales_orders\n".
    if (previous !== ".") return true;
    index = normalizedAnswer.indexOf(normalizedNeedle, index + 1);
  }
  return false;
}

function filterCases(cases: DialectTrapCase[], cfg: RunnerConfig): DialectTrapCase[] {
  let out = cases;
  if (cfg.ids?.length) {
    const wanted = new Set(cfg.ids);
    out = out.filter((item) => wanted.has(item.id));
  }
  if (cfg.categories?.length) {
    const wanted = new Set(cfg.categories);
    out = out.filter((item) => wanted.has(item.category));
  }
  if (cfg.difficulties?.length) {
    const wanted = new Set(cfg.difficulties);
    out = out.filter((item) => wanted.has(item.difficulty));
  }
  if (cfg.traps?.length) {
    const wanted = new Set(cfg.traps);
    out = out.filter((item) => item.dialect_trap_id.some((trap) => wanted.has(trap)));
  }
  return out;
}

async function main(): Promise<number> {
  const cfg = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const { version, cases: loaded } = loadDialectCases(cfg.source);
  const cases = filterCases(loaded, cfg);
  console.log(`Loaded ${cases.length} dialect trap cases from ${path.relative(process.cwd(), cfg.source) || cfg.source}.`);
  if (cfg.dryRun) {
    console.log("[dry-run] schema valid; no model invocation.");
    return 0;
  }
  const realInvoker = cfg.useMock ? null : await createRealRunnerInvoker("dialect");
  if (!cfg.useMock && !realInvoker) return 2;

  const records: RunRecord[] = [];
  for (const item of cases) {
    const timestamp = Date.now();
    const invocation = realInvoker ? await invokeReal(realInvoker, item) : await invokeMock(item);
    const score = scoreDialect(item, invocation.answer);
    const record: RunRecord = {
      id: item.id,
      version,
      category: item.category,
      difficulty: item.difficulty,
      traps: item.dialect_trap_id,
      provider: invocation.provider,
      modelId: invocation.modelId,
      promptChars: item.question.length,
      answerChars: invocation.answer.length,
      answerExcerpt: invocation.answer.slice(0, 300),
      latencyMs: invocation.latencyMs,
      score,
      timestamp,
    };
    records.push(record);
    if (cfg.verbose || !score.pass) {
      console.log(`${score.pass ? "✓" : "✗"} ${item.id} [${item.difficulty}/${item.dialect_trap_id.join(",")}] ${score.reason}`);
    }
  }

  const summary = summarize(records, startedAt);
  const reportPath = cfg.reportPath ?? defaultReportPath("dialect");
  writeJsonlReport(records, summary, reportPath);
  console.log(`\nReport: ${reportPath}`);
  printSummary(summary);
  return summary.meetsGate ? 0 : 1;
}

async function createRealRunnerInvoker(name: string): Promise<LlmInvoker | null> {
  try {
    const invoker = await createRealInvoker();
    console.log(`[real] ${name} runner using configured provider from ~/.codeclaw/`);
    return invoker;
  } catch (err) {
    console.error(`[real] failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
    return null;
  }
}

function summarize(records: RunRecord[], startedAt: number): {
  total: number;
  passed: number;
  failed: number;
  overallRate: number;
  byDifficulty: Record<string, { total: number; passed: number; rate: number }>;
  byCategory: Record<string, { total: number; passed: number; rate: number }>;
  byTrap: Record<string, { total: number; passed: number; rate: number }>;
  meetsGate: boolean;
  startedAt: number;
  durationMs: number;
} {
  const total = records.length;
  const passed = records.filter((record) => record.score.pass).length;
  const summary = {
    total,
    passed,
    failed: total - passed,
    overallRate: total === 0 ? 0 : passed / total,
    byDifficulty: group(records, (record) => record.difficulty),
    byCategory: group(records, (record) => record.category),
    byTrap: group(records.flatMap((record) => record.traps.map((trap) => ({ ...record, trap }))), (record) => record.trap),
    meetsGate: false,
    startedAt,
    durationMs: Date.now() - startedAt,
  };
  summary.meetsGate = summary.overallRate >= 0.9;
  return summary;
}

function group<T extends { score: ScoreResult }>(
  records: T[],
  keyFn: (record: T) => string
): Record<string, { total: number; passed: number; rate: number }> {
  const out: Record<string, { total: number; passed: number; rate: number }> = {};
  for (const record of records) {
    const key = keyFn(record);
    out[key] ??= { total: 0, passed: 0, rate: 0 };
    out[key].total += 1;
    if (record.score.pass) out[key].passed += 1;
  }
  for (const value of Object.values(out)) {
    value.rate = value.total === 0 ? 0 : value.passed / value.total;
  }
  return out;
}

function writeJsonlReport(records: RunRecord[], summary: object, outPath: string): void {
  ensureDir(path.dirname(outPath));
  for (const record of records) appendFileSync(outPath, JSON.stringify({ type: "record", ...record }) + "\n");
  appendFileSync(outPath, JSON.stringify({ type: "summary", ...summary }) + "\n");
}

function printSummary(summary: ReturnType<typeof summarize>): void {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  console.log("");
  console.log("─".repeat(64));
  console.log("Golden Set · Dialect Traps 汇总");
  console.log("─".repeat(64));
  console.log(`  total:    ${summary.total}`);
  console.log(`  passed:   ${summary.passed}`);
  console.log(`  failed:   ${summary.failed}`);
  console.log(`  overall:  ${pct(summary.overallRate)}  (gate 90.0%)`);
  console.log(`  duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log("");
  console.log(summary.meetsGate ? "  RESULT: PASS · 方言陷阱黄金集达标" : "  RESULT: FAIL · 方言陷阱黄金集未达标");
  console.log("─".repeat(64));
}

function defaultReportPath(kind: string, now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return path.join(REPORTS_DIR, `${yyyy}-${mm}-${dd}-${kind}.jsonl`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("dialect golden runner fatal:", err);
    process.exit(2);
  });
