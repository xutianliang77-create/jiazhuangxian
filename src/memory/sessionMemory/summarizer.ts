/**
 * L2 Session Memory · 摘要器
 *
 * 接 LLM 把会话历史压缩成结构化中文摘要，写入 memory_digest 表。
 *
 * 设计：
 *   - SummarizeInvoker 是依赖注入接口，便于测试用 mock 替换。
 *   - createProviderSummarizer 把 streamProviderResponse 包成 SummarizeInvoker。
 *   - summarizeSession 是主入口：拼 system prompt + 调 invoker + 构造 MemoryDigest
 *     （包含 ULID digestId、createdAt、tokenEstimate）。
 *   - LLM 失败时不抛——返回 fallback 摘要（"[LLM 摘要失败]" + 消息计数），
 *     让会话结束流程不被阻断。
 */

import { ulid } from "ulid";
import type { EngineMessage } from "../../agent/types";
import type { ChannelType } from "../../channels/channelAdapter";
import type { ProviderStatus } from "../../provider/types";
import { streamProviderResponse } from "../../provider/client";
import { stripThinking } from "../../lib/stripThinking";
import type { MemoryDigest } from "./store";

const SUMMARY_SYSTEM_PROMPT = `你是 CodeClaw 会话压缩器。把下面经过清洗的多轮对话压缩成结构化中文摘要。

必须按以下字段输出，每个字段一行：
目标: 用户真正要完成什么
已完成: 已经完成的动作和结论
关键证据: 关键命令、工具、queryId、artifact、错误关键词或测试结果
文件/对象: 涉及的文件、表、模块、报告或会话 ID
失败与原因: 失败现象、根因或仍不确定的信息；没有则写无
当前决策: 已确认的设计/取舍；没有则写无
下一步: 下一轮最应该继续做什么
禁止重复: 下一轮不要重复展开的旧工具输出或旧方向

要求：
- 保留具体名词（命令名、文件路径、错误关键词、模块名）
- 不输出思考过程、自检、寒暄、markdown 标题
- 不粘贴原始工具大输出，只保留摘要和可追溯引用
- 总长度尽量控制在 900 个中文字符以内`;

const FALLBACK_SUMMARY_PREFIX = "[LLM 摘要失败]";
const SUMMARY_LABELS = ["目标", "已完成", "关键证据", "文件/对象", "失败与原因", "当前决策", "下一步", "禁止重复"] as const;
const MAX_CLEAN_MESSAGE_CHARS = 900;
const MAX_STRUCTURED_SUMMARY_CHARS = 1400;

export type SummarizeInvoker = (
  messages: EngineMessage[],
  signal?: AbortSignal
) => Promise<string>;

export interface SummarizeMeta {
  sessionId: string;
  channel: ChannelType;
  userId: string;
}

function clipText(value: string, maxLength = MAX_CLEAN_MESSAGE_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractFilePaths(text: string): string[] {
  const matches = text.match(/(?:\.{1,2}\/|\/)?[A-Za-z0-9_@./()%-]+\.[A-Za-z0-9_@()%-]+/g) ?? [];
  return unique(matches.map((match) => match.replace(/[),.:;\]]+$/, ""))).slice(0, 8);
}

function extractArtifactPaths(text: string): string[] {
  const matches = [
    ...text.matchAll(/\bartifact:\s*(\/[^\s)]+)/gi),
    ...text.matchAll(/\bArtifact:\s*(\/[^\s)]+)/g),
    ...text.matchAll(/\bsaved to\s+(\/[^;\]\s]+)/gi),
  ];
  return unique(matches.map((match) => match[1]?.replace(/[),.;\]]+$/, "")).filter(Boolean) as string[]).slice(0, 6);
}

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.slice(-4).join("/") || value;
}

function summarizeItems(items: string[], limit: number): string {
  const values = unique(items);
  const shown = values.slice(0, limit).join(", ");
  return values.length > limit ? `${shown} 等` : shown;
}

function extractErrorSignals(text: string): string[] {
  const signals = [
    ...text.matchAll(/\b(?:Provider request failed|returned an empty final response|context budget exceeded|task_needs_staging|GandivaException|Object not found|FOREIGN KEY constraint failed|out of memory|EADDRINUSE)\b[^\n。]*/gi),
    ...text.matchAll(/\b(?:failed|error|timeout|blocked)\b[^\n。]{0,120}/gi),
  ];
  return unique(signals.map((match) => clipText(match[0], 140))).slice(0, 5);
}

function summarizeToolMessage(message: EngineMessage): string {
  const toolName = message.toolName ?? "unknown";
  const text = message.text ?? "";
  const artifacts = extractArtifactPaths(text);
  const files = extractFilePaths(text).map(shortPath);
  const errors = extractErrorSignals(text);
  const queryId = /\bQuery id:\s*([^\s]+)/i.exec(text)?.[1];
  const rows = /\bQuery preview rows:\s*(\d+)/i.exec(text)?.[1];
  const rowCount = /\bRow count:\s*([^\s]+)/i.exec(text)?.[1];
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;

  const parts = [`${toolName}`];
  if (queryId || rows || rowCount) {
    parts.push(`queryId=${queryId ?? "unknown"}`);
    if (rows) parts.push(`previewRows=${rows}`);
    if (rowCount) parts.push(`rowCount=${rowCount}`);
  } else if (toolName === "glob") {
    parts.push(files.length ? `匹配路径=${summarizeItems(files, 6)}` : "完成文件匹配");
  } else if (toolName === "read") {
    parts.push(files.length ? `读取文件=${summarizeItems(files, 5)}` : "读取完成");
  } else if (toolName === "bash" || toolName === "find" || toolName === "ls") {
    parts.push(files.length ? `扫描路径=${summarizeItems(files, 5)}` : `输出约${lineCount}行`);
  } else if (toolName === "Task") {
    const calls = /(\d+)\s+tool call\(s\)/i.exec(text)?.[1];
    parts.push(calls ? `子代理工具调用=${calls}次` : "子代理结果已记录");
  } else if (toolName.startsWith("mcp__")) {
    parts.push("MCP 调用完成");
  } else {
    parts.push(clipText(text, 180) || "工具完成");
  }

  if (errors.length) parts.push(`错误=${summarizeItems(errors, 2)}`);
  if (artifacts.length) parts.push(`artifact=${summarizeItems(artifacts.map(shortPath), 3)}`);
  return parts.join("；");
}

/** 把多条消息拼成给 LLM 的"对话原文"段（去除 system/hidden 消息，压缩 tool 原文避免污染摘要）*/
function formatConversation(messages: EngineMessage[]): string {
  return messages
    .filter((m) => m.role !== "system" && !m.hiddenFromUi)
    .map((m) => {
      if (m.role === "tool") {
        return `Tool: ${summarizeToolMessage(m)}`;
      }
      const role = m.role === "user" ? "User" : "Assistant";
      return `${role}: ${clipText(m.text)}`;
    })
    .filter((line) => line.trim())
    .join("\n\n");
}

/** 粗略估 token：按字符数 / 2.5（中文混合英文的常见近似），最少 1。 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2.5));
}

function extractNouns(text: string): string {
  const paths = extractFilePaths(text).map(shortPath);
  const ids = unique(text.match(/\b(?:report|session|query|artifact|d)-[A-Za-z0-9_-]{6,}\b/g) ?? []);
  const errors = extractErrorSignals(text);
  return summarizeItems([...paths, ...ids, ...errors], 8) || "未提取";
}

function hasStructuredLabels(text: string): boolean {
  return SUMMARY_LABELS.filter((label) => new RegExp(`(^|\\n)${label}:`, "u").test(text)).length >= 5;
}

function normalizeStructuredSummary(candidate: string, conversation: string): string {
  const compact = candidate.replace(/\r\n/g, "\n").trim();
  if (hasStructuredLabels(compact)) {
    return compact.length > MAX_STRUCTURED_SUMMARY_CHARS
      ? `${compact.slice(0, MAX_STRUCTURED_SUMMARY_CHARS - 3)}...`
      : compact;
  }

  const evidence = extractNouns(`${candidate}\n${conversation}`);
  const firstUser = /^User:\s*(.+)$/m.exec(conversation)?.[1];
  const failure = extractErrorSignals(`${candidate}\n${conversation}`);
  const lines = [
    `目标: ${clipText(firstUser ?? "未明确", 180)}`,
    `已完成: ${clipText(candidate || "已记录当前会话片段", 260)}`,
    `关键证据: ${evidence}`,
    `文件/对象: ${evidence}`,
    `失败与原因: ${failure.length ? summarizeItems(failure, 3) : "无"}`,
    "当前决策: 未记录",
    "下一步: 继续基于最近上下文推进，优先读取相关文件或引用 artifact",
    "禁止重复: 不要重复展开旧工具原始输出",
  ];
  const structured = lines.join("\n");
  return structured.length > MAX_STRUCTURED_SUMMARY_CHARS
    ? `${structured.slice(0, MAX_STRUCTURED_SUMMARY_CHARS - 3)}...`
    : structured;
}

function sanitizeSummary(text: string, conversation: string): string {
  const stripped = stripThinking(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(thinking process|self-correction|final check|output generation|character count check|check nouns)\b/i.test(line)) {
        return false;
      }
      if (/^(let'?s|i will|ready\.|done\.|proceeds\b)/i.test(line)) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();

  const finalPolish = /final polish[:：]\s*([\s\S]+)$/i.exec(stripped);
  const candidate = (finalPolish?.[1] ?? stripped).replace(/\s+/g, " ").trim();
  if (!candidate) return "";
  return normalizeStructuredSummary(candidate, conversation);
}

/**
 * 主入口：把会话压成 MemoryDigest（写库由调用方做）。
 * 空对话或 LLM 失败时返回 fallback digest，永不抛。
 */
export async function summarizeSession(
  invoker: SummarizeInvoker,
  messages: EngineMessage[],
  meta: SummarizeMeta,
  abortSignal?: AbortSignal
): Promise<MemoryDigest> {
  const conversation = formatConversation(messages);
  const messageCount = messages.filter((m) => m.role !== "system").length;
  const now = Date.now();
  const digestId = ulid();

  if (messageCount === 0 || !conversation.trim()) {
    return {
      digestId,
      sessionId: meta.sessionId,
      channel: meta.channel,
      userId: meta.userId,
      summary: `${FALLBACK_SUMMARY_PREFIX} (空对话)`,
      messageCount: 0,
      tokenEstimate: 0,
      createdAt: now,
    };
  }

  const llmMessages: EngineMessage[] = [
    {
      id: "summarize-system",
      role: "system",
      text: SUMMARY_SYSTEM_PROMPT,
      source: "model",
    },
    {
      id: "summarize-user",
      role: "user",
      text: conversation,
      source: "user",
    },
  ];

  let summary: string;
  try {
    summary = sanitizeSummary(await invoker(llmMessages, abortSignal), conversation);
    if (!summary) summary = `${FALLBACK_SUMMARY_PREFIX} (LLM 返回空)`;
  } catch (err) {
    summary = `${FALLBACK_SUMMARY_PREFIX} ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    digestId,
    sessionId: meta.sessionId,
    channel: meta.channel,
    userId: meta.userId,
    summary,
    messageCount,
    tokenEstimate: estimateTokens(summary),
    createdAt: now,
  };
}

/**
 * 把 streamProviderResponse 包装成 SummarizeInvoker。
 * 把流式 chunk 收集成完整字符串后返回。
 */
export function createProviderSummarizer(provider: ProviderStatus, fetchImpl?: typeof fetch): SummarizeInvoker {
  return async (messages, signal) => {
    let out = "";
    for await (const chunk of streamProviderResponse(provider, messages, {
      abortSignal: signal,
      ...(fetchImpl ? { fetchImpl } : {}),
    })) {
      out += chunk;
    }
    return out;
  };
}
