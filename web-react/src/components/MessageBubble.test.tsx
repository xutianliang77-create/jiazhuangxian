import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageBubble from "./MessageBubble";
import type { ChatMessage } from "@/store/messages";

function assistant(text: string): ChatMessage {
  return {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    text,
    ts: Date.now(),
  };
}

describe("MessageBubble", () => {
  it("renders context-budget pauses as a clear protective notice", () => {
    render(
      <MessageBubble
        msg={assistant(
          [
            "[context budget exceeded]",
            "current context: 45241/50000 tokens (90.5%)",
            "auto-compact attempts: 1",
            "",
            "The current task is paused before calling the model.",
          ].join("\n")
        )}
      />
    );

    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByText(/上下文预算已超限/)).toBeInTheDocument();
    expect(screen.getAllByText(/45241\/50000 tokens/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/新开一个 session/)).toBeInTheDocument();
  });
});
