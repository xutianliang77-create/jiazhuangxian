/**
 * CodeClaw Data Golden Suite invokers.
 *
 * Mock is deterministic and CI-safe.
 * Real runs QueryEngine with the configured provider and Beelink MCP tools.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { McpManager } from "../../../src/mcp/manager";
import { loadMcpConfig } from "../../../src/mcp/config";
import { getGlobalProviderCircuitBreaker } from "../../../src/provider/circuitBreaker";
import type { DataGoldenCase } from "./data-types";

const DEFAULT_REAL_CASE_TIMEOUT_MS = 120_000;

export interface DataGoldenInvocation {
  provider?: string;
  modelId?: string;
  answer: string;
  toolsInvoked: string[];
  latencyMs: number;
  hadError?: boolean;
}

export interface DataGoldenInvoker {
  invoke(question: DataGoldenCase): Promise<DataGoldenInvocation>;
  shutdown?(): Promise<void>;
}

export class MockDataGoldenInvoker implements DataGoldenInvoker {
  async invoke(question: DataGoldenCase): Promise<DataGoldenInvocation> {
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const toolsInvoked = (question.expected.tool_calls?.must_invoke ?? []).map((item) =>
      item.split(/\s*(?:或|\/|\bor\b|\|)\s*/i)[0]?.trim() ?? item
    );
    const answer = [
      `[mock data answer for ${question.id}]`,
      ...(question.expected.must_mention ?? []),
    ].join("\n");
    return {
      provider: "mock",
      modelId: "mock-data-deterministic",
      answer,
      toolsInvoked,
      latencyMs: Date.now() - started,
    };
  }
}

async function bootMcpManager(workspace: string): Promise<{ manager: McpManager; shutdown: () => Promise<void> }> {
  const manager = new McpManager();
  await manager.start(loadMcpConfig(workspace));
  return {
    manager,
    shutdown: async () => {
      await manager.closeAll().catch(() => undefined);
    },
  };
}

export class RealDataGoldenInvoker implements DataGoldenInvoker {
  private constructor(
    private readonly manager: McpManager,
    private readonly shutdownFn: () => Promise<void>,
    private readonly workspace: string
  ) {}

  static async create(workspace: string = process.cwd()): Promise<RealDataGoldenInvoker> {
    const { manager, shutdown } = await bootMcpManager(workspace);
    return new RealDataGoldenInvoker(manager, shutdown, workspace);
  }

  serverReady(server = "beelink"): boolean {
    return this.manager.isReady(server);
  }

  listToolNames(server = "beelink"): string[] {
    return this.manager
      .listAllTools()
      .filter((entry) => entry.server === server)
      .map((entry) => entry.tool.name);
  }

  async invoke(question: DataGoldenCase): Promise<DataGoldenInvocation> {
    const started = Date.now();
    const timeoutMs = readRealCaseTimeoutMs();
    const providerCircuit = getGlobalProviderCircuitBreaker();
    providerCircuit.reset();
    const { loadRuntimeSelection } = await import("../../../src/provider/registry");
    const { config, selection } = await loadRuntimeSelection();
    if (!config || !selection || !selection.current) {
      return {
        answer: "[no provider configured; run codeclaw setup first]",
        toolsInvoked: [],
        latencyMs: Date.now() - started,
        hadError: true,
      };
    }

    const provider = selection.current;
    const { createQueryEngine } = await import("../../../src/agent/queryEngine");
    const sessionsTmp = mkdtempSync(path.join(tmpdir(), "golden-data-sess-"));
    const toolsInvoked: string[] = [];
    let lastNonEmptyAnswer = "";
    let hadError = false;
    let timedOut = false;

    let engine: { submitMessage: (prompt: string) => AsyncGenerator<unknown>; interrupt: () => void } | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      hadError = true;
      engine?.interrupt();
    }, timeoutMs);
    try {
      const createdEngine = createQueryEngine({
        currentProvider: provider,
        fallbackProvider: null,
        permissionMode: "auto",
        workspace: this.workspace,
        channel: "cli",
        userId: "golden-data",
        auditDbPath: null,
        dataDbPath: null,
        sessionsDir: sessionsTmp,
        mcpManager: this.manager,
      });
      engine = createdEngine;

      // Physical read-only protection for golden real runs.
      // Keep read-only local tools and all MCP bridge tools; remove shell/write/task tools.
      const reg = (createdEngine as unknown as {
        toolRegistry?: { list(): Array<{ name: string }>; unregister(name: string): boolean };
      }).toolRegistry;
      if (reg) {
        const localReadOnly = new Set(["read", "glob", "symbol", "definition", "references", "read_artifact"]);
        for (const tool of reg.list()) {
          if (localReadOnly.has(tool.name)) continue;
          if (tool.name.startsWith("mcp__")) continue;
          reg.unregister(tool.name);
        }
      }

      for await (const event of createdEngine.submitMessage(question.prompt)) {
        const typed = event as { type?: string; toolName?: string; text?: string };
        if (typed.type === "tool-start" && typed.toolName) {
          toolsInvoked.push(typed.toolName);
        } else if (typed.type === "message-complete" && typed.text?.trim()) {
          lastNonEmptyAnswer = typed.text;
        }
      }
    } catch (err) {
      lastNonEmptyAnswer = `[engine error] ${err instanceof Error ? err.message : String(err)}`;
      hadError = true;
    } finally {
      clearTimeout(timeout);
      providerCircuit.reset();
      try {
        rmSync(sessionsTmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure in golden runs
      }
    }

    return {
      provider: provider.type,
      modelId: provider.model,
      answer:
        lastNonEmptyAnswer ||
        (timedOut ? `[real case timeout after ${timeoutMs}ms]` : hadError ? "[real case failed]" : "[no content produced]"),
      toolsInvoked,
      latencyMs: Date.now() - started,
      ...(hadError ? { hadError: true } : {}),
    };
  }

  async shutdown(): Promise<void> {
    await this.shutdownFn();
  }
}

function readRealCaseTimeoutMs(): number {
  const raw = process.env.DATA_GOLDEN_REAL_TIMEOUT_MS;
  if (!raw) return DEFAULT_REAL_CASE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REAL_CASE_TIMEOUT_MS;
}
