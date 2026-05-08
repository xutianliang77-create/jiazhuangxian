// 剥掉 LLM 输出里的思考过程标签（v0.8.5）。
//
// LM Studio 27B / DeepSeek R1 / Qwen3 reasoning 等模型常用 <think>...</think> 或
// <thinking>...</thinking> 标签把 reasoning 内容混在 content 里。默认 UI 应只显示最终答案；
// 用户传 --show-thinking flag 或设 CODECLAW_SHOW_THINKING=1 时保留原文。
//
// 处理规则：
//   - 大小写不敏感的 <think> / <thinking> 块，含跨行内容
//   - 配对的开闭标签整体移除
//   - 未闭合的标签：保守起见，从开标签到文本末尾视为思考（流式响应中模型可能没来得及闭合）
//   - 多个独立块都剥
//   - 移除后产生的连续多余空行折成一个

const TAG_RE = /<\s*(think|thinking)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
const UNCLOSED_TAG_RE = /<\s*(think|thinking)\s*>[\s\S]*$/i;
const PARTIAL_OPEN_TAG_RE = /<\s*(?:t|th|thi|thin|think|thinki|thinkin|thinking)\s*$/i;
const UNUSED_THOUGHT_RE = /<unused\d+>\s*thought[\s\S]*?(?=<unused\d+>|$)/gi;
const UNUSED_TOKEN_RE = /<unused\d+>/gi;
const NARRATIVE_PREFIX_RE =
  /^\s*(?:here'?s a thinking process:|thinking process:|思考过程[:：]|分析过程[:：])[\s\S]*?(?=\n\s*(?:根据|结论|总结|答案|最终答案|SQL draft:|#+\s)|$)/i;
const SELF_CHECK_LINE_RE =
  /^\s*(?:self-correction|self correction|verification during thought|final check|output generation|ready\.|proceeds\.|\[done\]).*$/gim;

export function shouldShowThinking(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODECLAW_SHOW_THINKING === "1" || env.CHATBI_SHOW_THINKING === "1";
}

export function stripThinking(text: string): string {
  if (!text) return text;
  let out = text.replace(NARRATIVE_PREFIX_RE, "");
  out = out.replace(UNUSED_THOUGHT_RE, "");
  out = out.replace(UNUSED_TOKEN_RE, "");
  out = out.replace(TAG_RE, "");
  out = out.replace(UNCLOSED_TAG_RE, "");
  out = out.replace(PARTIAL_OPEN_TAG_RE, "");
  out = out.replace(SELF_CHECK_LINE_RE, "");
  // 多个连续空行折成一个，trim 首尾
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
