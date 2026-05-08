import { describe, expect, it } from "vitest";
import { shouldShowThinking, stripThinking } from "../../../src/lib/stripThinking";

describe("stripThinking", () => {
  it("[v0.8.5] 空字符串原样返回", () => {
    expect(stripThinking("")).toBe("");
  });

  it("[v0.8.5] 无 think 标签的文本原样返回（trim 首尾空白）", () => {
    expect(stripThinking("hello world")).toBe("hello world");
    expect(stripThinking("  hello\n\nworld  ")).toBe("hello\n\nworld");
  });

  it("[v0.8.5] 单个 <think> 块整体剥离", () => {
    const input = "<think>let me reason about this</think>The answer is 42.";
    expect(stripThinking(input)).toBe("The answer is 42.");
  });

  it("[v0.8.5] <thinking> 别名也剥", () => {
    const input = "<thinking>step 1...\nstep 2</thinking>final answer";
    expect(stripThinking(input)).toBe("final answer");
  });

  it("[v0.8.5] 大小写不敏感", () => {
    expect(stripThinking("<THINK>x</THINK>y")).toBe("y");
    expect(stripThinking("<Thinking>x</Thinking>y")).toBe("y");
  });

  it("[v0.8.5] 跨行内容剥得干净", () => {
    const input = `<think>
line 1
line 2
line 3
</think>
SELECT * FROM tables;`;
    expect(stripThinking(input)).toBe("SELECT * FROM tables;");
  });

  it("[v0.8.5] 多个独立块都剥", () => {
    const input = "<think>first thought</think>part A<think>second thought</think>part B";
    expect(stripThinking(input)).toBe("part Apart B");
  });

  it("[v0.8.5] 未闭合的 <think>（流式中断）从开标签到末尾全剥", () => {
    const input = "answer prefix\n<think>halfway through reasoning when stream cut...";
    expect(stripThinking(input)).toBe("answer prefix");
  });

  it("[v0.8.5] 配对块 + 未闭合块同时存在", () => {
    const input = "<think>closed</think>middle text<think>unclosed at end...";
    expect(stripThinking(input)).toBe("middle text");
  });

  it("[v0.8.5] 多余空行折成一个", () => {
    const input = "before\n\n\n<think>x</think>\n\n\nafter";
    expect(stripThinking(input)).toBe("before\n\nafter");
  });

  it("[v0.8.5] 标签内含 < > 等字符不影响", () => {
    const input = "<think>x < y > z</think>final";
    expect(stripThinking(input)).toBe("final");
  });

  it("[v0.8.5] 标签前后有空格也能匹配", () => {
    const input = "< think >reasoning</ think >answer";
    expect(stripThinking(input)).toBe("answer");
  });

  it("流式半截 <think 标签不提前泄漏", () => {
    expect(stripThinking("<thi")).toBe("");
    expect(stripThinking("answer\n<think")).toBe("answer");
  });

  it("隐藏常见 Thinking Process 前缀叙述", () => {
    const input = [
      "Thinking Process:",
      "1. Analyze input",
      "2. Check constraints",
      "",
      "根据查询结果，Bread 销量最高。",
    ].join("\n");
    expect(stripThinking(input)).toBe("根据查询结果，Bread 销量最高。");
  });

  it("隐藏 Qwen/LM Studio unused thought 标记块", () => {
    const input = [
      "<unused94>thought The user greeted me. I should answer in Chinese.",
      "Plan: say hello.",
      "<unused95>你好，我是小医。请上传影像或报告文本。",
    ].join("\n");
    expect(stripThinking(input)).toBe("你好，我是小医。请上传影像或报告文本。");
  });

  it("流式半截 unused thought 块不泄漏", () => {
    expect(stripThinking("<unused94>thought The user greeted me")).toBe("");
  });

  it("默认不显示 thinking，仅显式环境变量开启", () => {
    expect(shouldShowThinking({} as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldShowThinking({ CODECLAW_SHOW_THINKING: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldShowThinking({ CHATBI_SHOW_THINKING: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
