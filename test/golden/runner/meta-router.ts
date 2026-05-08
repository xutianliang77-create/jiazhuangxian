#!/usr/bin/env tsx
/**
 * CodeClaw Meta Router Facts Golden runner.
 *
 * Usage:
 *   npm run golden:meta-router -- --dry-run
 *   npm run golden:meta-router -- --mock
 *   npm run golden:meta-router -- --variants --fact context_window
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { matchesSubstring, normalize } from "./normalize";
import { createRealInvoker, type LlmInvoker } from "./provider";
import type { AskQuestion } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.resolve(__dirname, "..", "meta-router", "META-ROUTER-FACTS.json");
const REPORTS_DIR = path.resolve(__dirname, "..", "reports");

interface DynamicField {
  placeholder: string;
  source: string;
  current_baseline_value: string | number | boolean;
}

interface MetaFactItem {
  ordinal: number;
  fact_id: string;
  category: string;
  trigger_keywords: string[];
  sample_question: string;
  answer_dynamic_fields: DynamicField[];
  answer_template?: string;
  answer_branches?: unknown;
  answer: string;
  design_note?: string;
}

interface MetaSource {
  version: string;
  total: number;
  items: MetaFactItem[];
}

interface MetaCase {
  id: string;
  sourceFactId: string;
  category: string;
  prompt: string;
  answer: string;
  dynamicFields: DynamicField[];
  variant: "sample" | "keyword";
}

interface RunnerConfig {
  source: string;
  dryRun?: boolean;
  verbose?: boolean;
  variants?: boolean;
  useMock: boolean;
  facts?: string[];
  categories?: string[];
  ids?: string[];
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
  coverage: number;
  reason: string;
}

interface RunRecord {
  id: string;
  version: string;
  factId: string;
  category: string;
  variant: string;
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
      case "--variants":
        cfg.variants = true;
        break;
      case "--verbose":
      case "-v":
        cfg.verbose = true;
        break;
      case "--id":
        cfg.ids = (cfg.ids ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--fact":
        cfg.facts = (cfg.facts ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--category":
        cfg.categories = (cfg.categories ?? []).concat((argv[++i] ?? "").split(",").filter(Boolean));
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
Golden Set · Meta Router Facts

Options:
  --dry-run              Load and validate facts only.
  --mock                 Use deterministic answers from source JSON (default).
  --real                 Use configured provider to answer fact prompts.
  --variants             Also generate keyword-trigger prompt variants.
  --source <path>        Override source JSON path.
  --id <id,...>          Run selected generated case ids.
  --fact <fact_id,...>   Filter fact ids.
  --category <cat,...>   Filter category.
  --report <path>        Write JSONL report.
  --verbose, -v          Print each case.
`);
}

function loadMetaCases(filePath: string, includeVariants: boolean): { version: string; cases: MetaCase[] } {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as MetaSource;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) {
    throw new Error(`${filePath}: root.items must be an array`);
  }
  const facts = raw.items.map(validateFact);
  if (raw.total !== facts.length) throw new Error(`${filePath}: total=${raw.total} but items=${facts.length}`);
  const cases: MetaCase[] = [];
  for (const fact of facts) {
    cases.push(toCase(fact, `META-${String(fact.ordinal).padStart(3, "0")}`, fact.sample_question, "sample"));
    if (includeVariants) {
      for (const [index, keyword] of fact.trigger_keywords.slice(0, 3).entries()) {
        cases.push(toCase(
          fact,
          `META-${String(fact.ordinal).padStart(3, "0")}-K${index + 1}`,
          buildKeywordPrompt(keyword),
          "keyword"
        ));
      }
    }
  }
  return { version: raw.version, cases };
}

function validateFact(input: unknown, index: number): MetaFactItem {
  const file = `meta-router#${index + 1}`;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${file}: fact must be object`);
  const obj = input as Record<string, unknown>;
  const ordinal = obj.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal)) throw new Error(`${file}: ordinal required`);
  const factId = requiredString(obj, "fact_id", file);
  const category = requiredString(obj, "category", file);
  const sampleQuestion = requiredString(obj, "sample_question", file);
  const answer = requiredString(obj, "answer", file);
  const triggerKeywords = requiredStringArray(obj, "trigger_keywords", file);
  const dynamic = Array.isArray(obj.answer_dynamic_fields)
    ? obj.answer_dynamic_fields.filter(isDynamicField)
    : [];
  return {
    ordinal,
    fact_id: factId,
    category,
    trigger_keywords: triggerKeywords,
    sample_question: sampleQuestion,
    answer_dynamic_fields: dynamic,
    answer,
    ...(typeof obj.answer_template === "string" ? { answer_template: obj.answer_template } : {}),
    ...(obj.answer_branches ? { answer_branches: obj.answer_branches } : {}),
    ...(typeof obj.design_note === "string" ? { design_note: obj.design_note } : {}),
  };
}

function toCase(fact: MetaFactItem, id: string, prompt: string, variant: MetaCase["variant"]): MetaCase {
  return {
    id,
    sourceFactId: fact.fact_id,
    category: fact.category,
    prompt,
    answer: fact.answer,
    dynamicFields: fact.answer_dynamic_fields,
    variant,
  };
}

function buildKeywordPrompt(keyword: string): string {
  return `请准确说明 Beelink 智能问数中「${keyword}」相关机制，不要编造不存在的实现。`;
}

function requiredString(obj: Record<string, unknown>, key: string, file: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${file}: ${key} required`);
  return value;
}

function requiredStringArray(obj: Record<string, unknown>, key: string, file: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${file}: ${key} must be string[]`);
  return value as string[];
}

function isDynamicField(input: unknown): input is DynamicField {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const obj = input as Record<string, unknown>;
  return typeof obj.placeholder === "string" && typeof obj.source === "string" && obj.current_baseline_value !== undefined;
}

async function invokeMock(item: MetaCase): Promise<Invocation> {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 2));
  return {
    provider: "mock",
    modelId: "mock-meta-router",
    answer: item.answer,
    latencyMs: Date.now() - start,
  };
}

async function invokeReal(invoker: LlmInvoker, item: MetaCase): Promise<Invocation> {
  return invoker.invoke(toAskQuestion(item));
}

function toAskQuestion(item: MetaCase): AskQuestion {
  return {
    id: item.id,
    version: 1,
    category: "cli-usage",
    difficulty: "easy",
    requires: {},
    prompt: [
      "你正在参加 CodeClaw / Beelink 智能问数系统事实 golden 测试。",
      "请根据当前产品事实准确回答，不要编造不存在的文件、记忆、上下文容量、校验机制或多 agent 流程。",
      "如果问题询问不存在的能力，要直接说明不存在，并给出真实机制。",
      "",
      `问题：${item.prompt}`,
    ].join("\n"),
    expected: {
      answer_key: item.answer,
      rubric: item.category,
    },
  };
}

function scoreMeta(item: MetaCase, answer: string): ScoreResult {
  const needles = deriveNeedles(item);
  const matched: string[] = [];
  const missed: string[] = [];
  const triggered: string[] = [];
  for (const needle of needles) {
    if (matchesSubstring(answer, needle)) matched.push(needle);
    else missed.push(needle);
  }
  for (const forbidden of forbiddenNeedles(item.sourceFactId)) {
    if (isForbiddenTriggered(answer, forbidden)) triggered.push(forbidden);
  }
  const coverage = needles.length === 0 ? 1 : matched.length / needles.length;
  const pass = coverage >= 0.7 && triggered.length === 0;
  const parts = [`coverage=${matched.length}/${needles.length}`];
  if (missed.length) parts.push(`missed=[${missed.slice(0, 3).join(",")}${missed.length > 3 ? "..." : ""}]`);
  if (triggered.length) parts.push(`triggered=[${triggered.join(",")}]`);
  return { pass, matched, missed, triggered, coverage, reason: parts.join(" ") };
}

function deriveNeedles(item: MetaCase): string[] {
  const fromAnswer = significantTerms(item.answer).slice(0, 12);
  const dynamic = item.dynamicFields.map((field) => String(field.current_baseline_value));
  return [...new Set([...dynamic, ...fromAnswer])].filter((needle) => needle.length > 0);
}

function significantTerms(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.replace(/^[\s\d.、\-]+/, "").trim();
    if (!trimmed) continue;
    if (trimmed.length <= 24) {
      out.push(trimmed);
      continue;
    }
    const cjk = trimmed.match(/[\u4e00-\u9fffA-Za-z0-9_.+-]{2,}/g) ?? [];
    out.push(...cjk.filter((part) => !COMMON_TERMS.has(normalize(part))).slice(0, 4));
  }
  return [...new Set(out)].slice(0, 16);
}

const COMMON_TERMS = new Set(["beelink", "智能问数", "当前", "如果", "所以", "实际"]);

function forbiddenNeedles(factId: string): string[] {
  const map: Record<string, string[]> = {
    md_file: ["静态 md 知识库", "我的 md 文件记录", "写在 md 文件"],
    context_window: ["1mb 上限", "1m 上限", "超过 1mb 就无法处理"],
    verifier_mechanism: ["没有校验机制", "只有模型自己判断"],
    history_window: ["永久记住所有历史", "所有会话都会自动继承"],
    agent_flow: ["一定会多 agent", "默认多智能体并行"],
    knowledge_base: ["自动沉淀所有对话", "自动写入知识库"],
    discovery_feature: ["每次都会全量探查", "没有本地元数据"],
  };
  return map[factId] ?? [];
}

function isForbiddenTriggered(answer: string, forbidden: string): boolean {
  if (!matchesSubstring(answer, forbidden)) return false;
  const normalizedAnswer = normalize(answer);
  const normalizedForbidden = normalize(forbidden);
  const index = normalizedAnswer.indexOf(normalizedForbidden);
  const prefix = normalizedAnswer.slice(Math.max(0, index - 12), index).trim();
  return !/(不|没有|不存在|并非|不是|禁止)\s*$/.test(prefix);
}

function filterCases(cases: MetaCase[], cfg: RunnerConfig): MetaCase[] {
  let out = cases;
  if (cfg.ids?.length) {
    const wanted = new Set(cfg.ids);
    out = out.filter((item) => wanted.has(item.id));
  }
  if (cfg.facts?.length) {
    const wanted = new Set(cfg.facts);
    out = out.filter((item) => wanted.has(item.sourceFactId));
  }
  if (cfg.categories?.length) {
    const wanted = new Set(cfg.categories);
    out = out.filter((item) => wanted.has(item.category));
  }
  return out;
}

async function main(): Promise<number> {
  const cfg = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const { version, cases: loaded } = loadMetaCases(cfg.source, cfg.variants === true);
  const cases = filterCases(loaded, cfg);
  console.log(`Loaded ${cases.length} meta-router cases from ${path.relative(process.cwd(), cfg.source) || cfg.source}.`);
  if (cfg.dryRun) {
    console.log("[dry-run] schema valid; no model invocation.");
    return 0;
  }
  const realInvoker = cfg.useMock ? null : await createRealRunnerInvoker("meta-router");
  if (!cfg.useMock && !realInvoker) return 2;

  const records: RunRecord[] = [];
  for (const item of cases) {
    const timestamp = Date.now();
    const invocation = realInvoker ? await invokeReal(realInvoker, item) : await invokeMock(item);
    const score = scoreMeta(item, invocation.answer);
    const record: RunRecord = {
      id: item.id,
      version,
      factId: item.sourceFactId,
      category: item.category,
      variant: item.variant,
      provider: invocation.provider,
      modelId: invocation.modelId,
      promptChars: item.prompt.length,
      answerChars: invocation.answer.length,
      answerExcerpt: invocation.answer.slice(0, 300),
      latencyMs: invocation.latencyMs,
      score,
      timestamp,
    };
    records.push(record);
    if (cfg.verbose || !score.pass) {
      console.log(`${score.pass ? "✓" : "✗"} ${item.id} [${item.sourceFactId}/${item.variant}] ${score.reason}`);
    }
  }

  const summary = summarize(records, startedAt);
  const reportPath = cfg.reportPath ?? defaultReportPath("meta-router");
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
  byFact: Record<string, { total: number; passed: number; rate: number }>;
  byCategory: Record<string, { total: number; passed: number; rate: number }>;
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
    byFact: group(records, (record) => record.factId),
    byCategory: group(records, (record) => record.category),
    meetsGate: false,
    startedAt,
    durationMs: Date.now() - startedAt,
  };
  summary.meetsGate = summary.overallRate >= 1.0;
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
  for (const value of Object.values(out)) value.rate = value.total === 0 ? 0 : value.passed / value.total;
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
  console.log("Golden Set · Meta Router Facts 汇总");
  console.log("─".repeat(64));
  console.log(`  total:    ${summary.total}`);
  console.log(`  passed:   ${summary.passed}`);
  console.log(`  failed:   ${summary.failed}`);
  console.log(`  overall:  ${pct(summary.overallRate)}  (gate 100.0%)`);
  console.log(`  duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log("");
  console.log(summary.meetsGate ? "  RESULT: PASS · 元信息事实黄金集达标" : "  RESULT: FAIL · 元信息事实黄金集未达标");
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
    console.error("meta-router golden runner fatal:", err);
    process.exit(2);
  });
