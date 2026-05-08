import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineMessage } from "../src/agent/types";
import { streamProviderResponse } from "../src/provider/client";
import type { ProviderStatus } from "../src/provider/types";

const tempDirs: string[] = [];

function createResponse(body: string): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }));
}

const baseProvider: ProviderStatus = {
  instanceId: "openai:default",
  type: "openai",
  displayName: "OpenAI",
  kind: "cloud",
  enabled: true,
  requiresApiKey: true,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutMs: 30_000,
  apiKey: "test-key",
  apiKeyEnvVar: "OPENAI_API_KEY",
  envVars: ["OPENAI_API_KEY"],
  fileConfig: {},
  configured: true,
  available: true,
  reason: "configured"
};

const messages: EngineMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "hello"
  }
];

afterEach(async () => {
  delete process.env.CHATBI_MAX_UNDELIMITED_STREAM_BUFFER_BYTES;
  delete process.env.CODECLAW_MAX_UNDELIMITED_STREAM_BUFFER_BYTES;
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider client", () => {
  it("parses openai-compatible sse deltas", async () => {
    const fetchImpl = async () =>
      createResponse(
        [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}',
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          "data: [DONE]"
        ].join("\n")
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(baseProvider, messages, { fetchImpl: fetchImpl as typeof fetch })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
  });

  it("parses ollama ndjson deltas", async () => {
    const fetchImpl = async () =>
      createResponse(
        [
          '{"message":{"content":"Hel"},"done":false}',
          '{"message":{"content":"lo"},"done":false}',
          '{"done":true}'
        ].join("\n")
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(
      {
        ...baseProvider,
        instanceId: "ollama:default",
        type: "ollama",
        displayName: "Ollama",
        kind: "local",
        requiresApiKey: false,
        baseUrl: "http://127.0.0.1:11434",
        apiKey: undefined,
        apiKeyEnvVar: undefined
      },
      messages,
      { fetchImpl: fetchImpl as typeof fetch }
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
  });

  it("does not abort an already-started local stream when timeoutMs is very small", async () => {
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n'));
            }, 10);
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n'));
              controller.close();
            }, 20);
          }
        })
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(
      {
        ...baseProvider,
        instanceId: "lmstudio:default",
        type: "lmstudio",
        displayName: "LM Studio",
        kind: "local",
        requiresApiKey: false,
        baseUrl: "http://127.0.0.1:1234/v1",
        timeoutMs: 1,
        apiKey: undefined,
        apiKeyEnvVar: undefined
      },
      messages,
      { fetchImpl: fetchImpl as typeof fetch }
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
  });

  it("sends image_url parts for openai-compatible image messages", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codeclaw-provider-image-"));
    tempDirs.push(dir);
    const imagePath = path.join(dir, "sample.png");
    await writeFile(imagePath, Buffer.from("hello-image"));

    let requestBody = "";
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return createResponse(
        [
          'data: {"choices":[{"delta":{"content":"Seen"}}]}',
          "data: [DONE]"
        ].join("\n")
      );
    };

    const multimodalMessages: EngineMessage[] = [
      {
        id: "u1",
        role: "user",
        text: "请看这张图",
        attachments: [
          {
            kind: "image",
            localPath: imagePath,
            mimeType: "image/png",
            fileName: "sample.png"
          }
        ]
      }
    ];

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(baseProvider, multimodalMessages, { fetchImpl: fetchImpl as typeof fetch })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Seen");
    expect(requestBody).toContain("\"type\":\"image_url\"");
    expect(requestBody).toContain("\"url\":\"data:image/png;base64,");
    expect(requestBody).toContain("\"text\":\"请看这张图\"");
  });

  // v0.8.3/v0.8.7：防 OOM。这里限制的是“未分隔单帧”，不是完整回答长度；
  // 正常长回答应由 TurnGuard + artifact + recovery 处理。
  it("aborts SSE stream when undelimited buffer exceeds the protocol guard", async () => {
    // 默认 2MB；3MB 不含换行的 payload → 必触发未分隔 buffer 保护。
    const huge = "data: " + "x".repeat(3 * 1024 * 1024);
    const fetchImpl = async () => createResponse(huge);

    await expect(async () => {
      for await (const _chunk of streamProviderResponse(baseProvider, messages, {
        fetchImpl: fetchImpl as typeof fetch
      })) {
        // 仅消费，等抛错
      }
    }).rejects.toThrow(/Undelimited stream buffer exceeded/);
  });

  it("hides delta.reasoning_content by default and still streams content", async () => {
    const fetchImpl = async () =>
      createResponse(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"Thinking step 1..."}}]}',
          'data: {"choices":[{"delta":{"reasoning_content":" answer is"}}]}',
          'data: {"choices":[{"delta":{"content":" 42"}}]}',
          "data: [DONE]",
        ].join("\n")
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(baseProvider, messages, { fetchImpl: fetchImpl as typeof fetch })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe(" 42");
  });

  it("can show delta.reasoning_content when explicitly enabled", async () => {
    const fetchImpl = async () =>
      createResponse(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"Thinking step 1..."}}]}',
          'data: {"choices":[{"delta":{"reasoning_content":" answer is"}}]}',
          'data: {"choices":[{"delta":{"content":" 42"}}]}',
          "data: [DONE]",
        ].join("\n")
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(baseProvider, messages, {
      fetchImpl: fetchImpl as typeof fetch,
      showThinking: true,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe("Thinking step 1... answer is 42");
  });

  it("hides delta.reasoning by default (OpenRouter / generic alias)", async () => {
    const fetchImpl = async () =>
      createResponse(
        [
          'data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}',
          'data: {"choices":[{"delta":{"content":" final"}}]}',
          "data: [DONE]",
        ].join("\n")
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(baseProvider, messages, { fetchImpl: fetchImpl as typeof fetch })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe(" final");
  });

  it("when content and reasoning both present in same frame, content wins (no double-yield)", async () => {
    const fetchImpl = async () =>
      createResponse(
        [
          'data: {"choices":[{"delta":{"content":"actual","reasoning_content":"thought"}}]}',
          "data: [DONE]",
        ].join("\n")
      );

    const chunks: string[] = [];
    for await (const chunk of streamProviderResponse(baseProvider, messages, { fetchImpl: fetchImpl as typeof fetch })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe("actual"); // 不应包含 "thought"
  });
});
