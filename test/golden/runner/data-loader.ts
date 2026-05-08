/**
 * CodeClaw Data Golden Suite loader.
 *
 * Loads test/golden/data/DATA-100.yaml, validates 100 data-analysis cases,
 * and keeps the suite intentionally separate from the general ASK suite.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type {
  DataGoldenCase,
  DataGoldenDifficulty,
  DataGoldenLayer,
  DataGoldenToolCallSpec,
} from "./data-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, "..", "data", "DATA-100.yaml");

const ALLOWED_LAYERS: DataGoldenLayer[] = [
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

const ALLOWED_DIFFICULTIES: DataGoldenDifficulty[] = ["easy", "medium", "hard"];

export class DataGoldenLoaderError extends Error {}

export function dataGoldenFile(): string {
  return DATA_FILE;
}

export function loadAllDataGolden(options: { skipDeprecated?: boolean } = {}): DataGoldenCase[] {
  const { skipDeprecated = true } = options;
  if (!existsSync(DATA_FILE)) return [];
  const parsed = yaml.load(readFileSync(DATA_FILE, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new DataGoldenLoaderError("DATA-100.yaml: root must be an object");
  }

  const root = parsed as Record<string, unknown>;
  const rawCases = root.cases;
  if (!Array.isArray(rawCases)) {
    throw new DataGoldenLoaderError("DATA-100.yaml: cases must be an array");
  }

  const cases = rawCases.map((item, index) => validateCase(item, index + 1));
  const active = skipDeprecated ? cases.filter((c) => !c.deprecated) : cases;
  validateSuiteShape(active);
  return active;
}

function validateSuiteShape(cases: DataGoldenCase[]): void {
  if (cases.length !== 100) {
    throw new DataGoldenLoaderError(`DATA-100.yaml: expected 100 active cases, got ${cases.length}`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < cases.length; i++) {
    const expectedId = `DATA-${String(i + 1).padStart(3, "0")}`;
    const actual = cases[i].id;
    if (actual !== expectedId) {
      throw new DataGoldenLoaderError(`DATA-100.yaml: case ${i + 1} expected id ${expectedId}, got ${actual}`);
    }
    if (seen.has(actual)) {
      throw new DataGoldenLoaderError(`DATA-100.yaml: duplicate id ${actual}`);
    }
    seen.add(actual);
  }
}

function validateCase(input: unknown, ordinal: number): DataGoldenCase {
  const file = `DATA-100.yaml#${ordinal}`;
  if (!input || typeof input !== "object") {
    throw new DataGoldenLoaderError(`${file}: case must be an object`);
  }
  const obj = input as Record<string, unknown>;
  const id = requireString(obj, "id", file);
  if (!/^DATA-\d{3,}$/i.test(id)) {
    throw new DataGoldenLoaderError(`${file}: id must match DATA-001 style`);
  }
  const version = requireNumber(obj, "version", file);
  const layer = requireString(obj, "layer", file) as DataGoldenLayer;
  if (!ALLOWED_LAYERS.includes(layer)) {
    throw new DataGoldenLoaderError(`${file}: invalid layer ${layer}`);
  }
  const difficulty = requireString(obj, "difficulty", file) as DataGoldenDifficulty;
  if (!ALLOWED_DIFFICULTIES.includes(difficulty)) {
    throw new DataGoldenLoaderError(`${file}: invalid difficulty ${difficulty}`);
  }
  const prompt = requireString(obj, "prompt", file);
  const expected = obj.expected as Record<string, unknown> | undefined;
  if (!expected || typeof expected !== "object") {
    throw new DataGoldenLoaderError(`${file}: expected is required`);
  }

  const mustMention = optionalStringArray(expected, "must_mention");
  const mustNotMention = optionalStringArray(expected, "must_not_mention");
  const toolCalls = parseToolCallsSpec(expected.tool_calls, file);
  if (mustMention.length === 0 && (!toolCalls?.must_invoke || toolCalls.must_invoke.length === 0)) {
    throw new DataGoldenLoaderError(`${file}: must have expected.must_mention or expected.tool_calls.must_invoke`);
  }

  return {
    id,
    version,
    layer,
    difficulty,
    prompt,
    expected: {
      ...(mustMention.length > 0 ? { must_mention: mustMention } : {}),
      ...(mustNotMention.length > 0 ? { must_not_mention: mustNotMention } : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
      ...(typeof expected.rubric === "string" ? { rubric: expected.rubric } : {}),
    },
    deprecated: obj.deprecated === true,
  };
}

function parseToolCallsSpec(input: unknown, file: string): DataGoldenToolCallSpec | undefined {
  if (input == null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new DataGoldenLoaderError(`${file}: expected.tool_calls must be object`);
  }
  const obj = input as Record<string, unknown>;
  const mustInvoke = optionalStringArray(obj, "must_invoke");
  const mustNotInvoke = optionalStringArray(obj, "must_not_invoke");
  if (mustInvoke.length === 0 && mustNotInvoke.length === 0) return undefined;
  return {
    ...(mustInvoke.length > 0 ? { must_invoke: mustInvoke } : {}),
    ...(mustNotInvoke.length > 0 ? { must_not_invoke: mustNotInvoke } : {}),
  };
}

function requireString(obj: Record<string, unknown>, key: string, file: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DataGoldenLoaderError(`${file}: field ${key} required (string)`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string, file: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DataGoldenLoaderError(`${file}: field ${key} required (number)`);
  }
  return value;
}

function optionalStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new DataGoldenLoaderError(`field ${key} must be array if present`);
  }
  return value.filter((item) => typeof item === "string") as string[];
}
