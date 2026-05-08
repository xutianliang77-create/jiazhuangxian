/**
 * L2 Session Memory · 召回层
 *
 * 显式续接时调用 `recallRecent` 拉最近 N 条摘要，拼成一段 system message
 * 注入到 messages 头部，让 LLM 在 /resume 或"继续上次"时拿到跨 session 上下文。
 *
 * 设计：
 *   - 默认 limit=5：最多覆盖最近 5 个 session 的简要历史，token 预算可控
 *   - 摘要按时间倒序拉（最新在最前），但 system message 里**正序**显示
 *     （让 LLM 按时间线理解上下文进展）
 *   - 空数据返回 systemMessage=null，调用方应跳过注入
 */

import type Database from "better-sqlite3";
import type { ChannelType } from "../../channels/channelAdapter";
import type { EngineMessage } from "../../agent/types";
import { loadRecentDigests, type MemoryDigest } from "./store";

export interface RecallResult {
  digests: MemoryDigest[];
  /** 已构造好的 system message，可直接 prepend 到 engine messages 头部 */
  systemMessage: EngineMessage | null;
}

export interface RecallOptions {
  /** 默认 5；过多会膨胀 input tokens，过少又记不住事 */
  limit?: number;
  /** 当前用户输入。传入后只召回相关摘要；"继续/上次"类请求会保留最近上下文。 */
  query?: string;
  /** 默认 1；query token 命中分数低于该值时不召回。 */
  minScore?: number;
}

/** 把毫秒时间戳格式化为本地易读串（YYYY-MM-DD HH:MM）*/
function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isContinuationRecallQuery(query: string): boolean {
  return /继续|接着|上次|刚才|前面|上一轮|之前|resume|continue|previous/i.test(query);
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_@./()-]{2,}/g) ?? [];
  const chineseRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => {
    if (run.length <= 4) return [run];
    const grams: string[] = [run];
    for (let i = 0; i < run.length - 1; i++) {
      grams.push(run.slice(i, i + 2));
    }
    return grams;
  });
  return [...new Set([...latin, ...chinese])];
}

function relevanceScore(digest: MemoryDigest, queryTokens: string[]): number {
  const haystack = digest.summary.toLowerCase();
  return queryTokens.reduce((score, token) => {
    if (!token || token.length < 2) return score;
    return haystack.includes(token) ? score + (token.length >= 4 ? 2 : 1) : score;
  }, 0);
}

export function isUsableRecallSummary(summaryText: string): boolean {
  const summary = summaryText.trim();
  if (!summary) return false;
  if (summary.startsWith("[LLM 摘要失败]")) return false;
  if (/here'?s a thinking process|thinking process:|self-correction|final polish|output generation/i.test(summary)) {
    return false;
  }
  return true;
}

function isUsableDigest(digest: MemoryDigest): boolean {
  return isUsableRecallSummary(digest.summary);
}

function filterRelevantDigests(digests: MemoryDigest[], options: Required<RecallOptions>): MemoryDigest[] {
  const usableDigests = digests.filter(isUsableDigest);
  const query = options.query.trim();
  if (!query || isContinuationRecallQuery(query)) return usableDigests;
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return usableDigests
    .map((digest) => ({ digest, score: relevanceScore(digest, tokens) }))
    .filter((item) => item.score >= options.minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.digest.createdAt - a.digest.createdAt;
    })
    .map((item) => item.digest)
    .slice(0, options.limit);
}

function normalizeRecallOptions(limitOrOptions: number | RecallOptions | undefined): Required<RecallOptions> {
  if (typeof limitOrOptions === "number") {
    return { limit: limitOrOptions, query: "", minScore: 1 };
  }
  return {
    limit: limitOrOptions?.limit ?? 5,
    query: limitOrOptions?.query ?? "",
    minScore: limitOrOptions?.minScore ?? 1,
  };
}

export function buildRecallSystemMessage(digests: MemoryDigest[]): EngineMessage | null {
  if (digests.length === 0) return null;
  // 倒序拉的（最新在前），systemMessage 里反过来按时间线正序显示
  const sorted = [...digests].sort((a, b) => a.createdAt - b.createdAt);
  const lines = [
    "你和该用户的相关近期对话摘要（用于上下文连续性，按时间从早到晚）：",
    ...sorted.map(
      (d, i) => `${i + 1}. [${formatTimestamp(d.createdAt)}] ${d.summary}`
    ),
    "",
    "请在回答时参考以上历史，但优先回应当前用户输入。如历史与当前问题无关可忽略。",
  ];
  return {
    id: `recall-${digests[0].digestId}`,
    role: "system",
    text: lines.join("\n"),
    source: "model",
  };
}

/**
 * 主入口：拉最近 N 条 digest 并构造 system message。
 * 兼容旧签名：第 4 参数传 number 时仍表示 limit。
 */
export function recallRecent(
  db: Database.Database,
  channel: ChannelType,
  userId: string,
  limitOrOptions: number | RecallOptions = 5
): RecallResult {
  const options = normalizeRecallOptions(limitOrOptions);
  const recent = loadRecentDigests(db, channel, userId, options.limit);
  const digests = filterRelevantDigests(recent, options);
  return {
    digests,
    systemMessage: buildRecallSystemMessage(digests),
  };
}
