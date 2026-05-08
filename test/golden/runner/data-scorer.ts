/**
 * CodeClaw Data Golden Suite scorer.
 *
 * Scores both answer content and required tool-use route. This catches the
 * failure mode where a model "sounds right" but bypasses Beelink metadata/SQL.
 */

import { matchesAny, matchesSubstring } from "./normalize";
import type { DataGoldenCase, DataGoldenScoreResult } from "./data-types";

const PASS_THRESHOLD = 0.8;

function splitAlternatives(needle: string): string[] {
  return needle
    .split(/\s*(?:或|\/|\bor\b|\|)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function scoreDataGolden(
  question: DataGoldenCase,
  answer: string,
  toolsInvoked: string[]
): DataGoldenScoreResult {
  const mustMention = question.expected.must_mention ?? [];
  const mustNotMention = question.expected.must_not_mention ?? [];
  const toolSpec = question.expected.tool_calls;

  const matched: string[] = [];
  const missed: string[] = [];
  const triggered: string[] = [];

  for (const item of mustMention) {
    const alternatives = splitAlternatives(item);
    if (matchesAny(answer, alternatives)) matched.push(item);
    else missed.push(item);
  }

  for (const item of mustNotMention) {
    const alternatives = splitAlternatives(item);
    if (alternatives.some((needle) => matchesSubstring(answer, needle))) {
      triggered.push(item);
    }
  }

  const invokedOk: string[] = [];
  const invokedMissing: string[] = [];
  const invokedForbidden: string[] = [];

  for (const item of toolSpec?.must_invoke ?? []) {
    const alternatives = splitAlternatives(item);
    const hit = toolsInvoked.some((tool) =>
      alternatives.some((alt) => tool.includes(alt) || alt.includes(tool))
    );
    if (hit) invokedOk.push(item);
    else invokedMissing.push(item);
  }

  for (const item of toolSpec?.must_not_invoke ?? []) {
    const alternatives = splitAlternatives(item);
    const hit = toolsInvoked.some((tool) =>
      alternatives.some((alt) => tool.includes(alt) || alt.includes(tool))
    );
    if (hit) invokedForbidden.push(item);
  }

  const mentionThreshold = mustMention.length === 0 ? 0 : mustMention.length * PASS_THRESHOLD;
  const invokeThreshold = (toolSpec?.must_invoke?.length ?? 0) * PASS_THRESHOLD;
  const mentionOk = matched.length >= mentionThreshold && triggered.length === 0;
  const invokeOk = invokedOk.length >= invokeThreshold && invokedForbidden.length === 0;
  const pass = mentionOk && invokeOk;

  const parts: string[] = [];
  if (mustMention.length > 0) parts.push(`mention=${matched.length}/${mustMention.length}`);
  if (toolSpec?.must_invoke?.length) parts.push(`tool=${invokedOk.length}/${toolSpec.must_invoke.length}`);
  if (missed.length > 0) parts.push(`missed=[${missed.slice(0, 3).join(",")}${missed.length > 3 ? "..." : ""}]`);
  if (invokedMissing.length > 0) parts.push(`tool-missing=[${invokedMissing.join(",")}]`);
  if (triggered.length > 0) parts.push(`triggered=[${triggered.join(",")}]`);
  if (invokedForbidden.length > 0) parts.push(`tool-forbidden=[${invokedForbidden.join(",")}]`);
  if (parts.length === 0) parts.push("nothing to score");

  return {
    pass,
    matched,
    missed,
    triggered,
    invokedOk,
    invokedMissing,
    invokedForbidden,
    reason: parts.join(" "),
  };
}
