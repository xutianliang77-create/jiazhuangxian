/**
 * MessageBubble · 渲染单条消息（B.4）
 *
 * - user：右对齐
 * - assistant + streaming：闪烁光标 + 流式 markdown
 * - tool：折叠卡片
 * - system / error：灰条 / 红条
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import type { ChatMessage } from "@/store/messages";
import ToolCallCard from "./ToolCallCard";

interface Props {
  msg: ChatMessage;
}

function isContextBudgetExceeded(text: string): boolean {
  return text.trimStart().startsWith("[context budget exceeded]");
}

function extractContextBudgetLine(text: string): string | null {
  const line = text.split(/\r?\n/).find((item) => item.startsWith("current context:"));
  return line?.replace(/^current context:\s*/, "") ?? null;
}

function ContextBudgetNotice({ text }: { text: string }) {
  const currentContext = extractContextBudgetLine(text);
  return (
    <div className="max-w-[90%] rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded bg-danger px-2 py-0.5 text-xs font-bold text-white">
          已暂停
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-danger">上下文预算已超限，CodeClaw 已保护性暂停本轮任务。</div>
          <div className="text-fg">
            为了避免模型返回空结果、终端刷屏或 Web 卡死，本轮没有继续把超大上下文发送给 Provider。
          </div>
          {currentContext && (
            <div className="text-xs text-muted">当前估算：{currentContext}</div>
          )}
          <div className="text-xs text-muted">
            建议：新开一个 session 继续，或先发送 <code>/compact</code> 压缩当前会话后再重试。
          </div>
        </div>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none">查看原始保护信息</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded border border-border bg-bg/70 p-2">{text}</pre>
      </details>
    </div>
  );
}

function BubbleInner({ msg }: Props) {
  if (msg.role === "tool" && msg.tool) {
    return <ToolCallCard tool={msg.tool} />;
  }
  if (msg.role === "error") {
    return (
      <div className="rounded px-3 py-2 text-sm bg-danger/10 text-danger border border-danger/30">
        {msg.text}
      </div>
    );
  }
  if (msg.role === "system") {
    return (
      <div className="text-xs text-muted px-2 py-1 italic">{msg.text}</div>
    );
  }
  if (msg.role === "user") {
    return (
      <div className="self-end max-w-[80%] rounded px-3 py-2 text-sm bg-accent/10 whitespace-pre-wrap">
        {msg.text}
      </div>
    );
  }
  // assistant
  if (isContextBudgetExceeded(msg.text)) {
    return <ContextBudgetNotice text={msg.text} />;
  }
  const cursor = msg.streaming ? <span className="animate-pulse text-muted">▋</span> : null;
  return (
    <div className="max-w-[90%] rounded px-3 py-2 text-sm bg-bg/60 border border-border markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      >
        {msg.text || ""}
      </ReactMarkdown>
      {cursor}
    </div>
  );
}

export default memo(BubbleInner, (prev, next) => {
  // 流式中跨更新比较 text；非流式只看 id 是否变
  if (prev.msg.streaming || next.msg.streaming) {
    return prev.msg.id === next.msg.id && prev.msg.text === next.msg.text;
  }
  return prev.msg.id === next.msg.id;
});
