/**
 * knowledge_search native tool
 *
 * L3 长期知识层统一入口。P0 先统一 RAG + CodebaseGraph 的检索输出，
 * 不替换旧 rag_search / graph_query，避免破坏兼容。
 */

import { searchKnowledge } from "../../knowledge/search";
import type { ToolDefinition, ToolRegistry } from "./registry";

export interface RegisterKnowledgeToolDeps {
  workspace: string;
}

export function registerKnowledgeSearchTool(
  registry: ToolRegistry,
  deps: RegisterKnowledgeToolDeps
): void {
  if (registry.has("knowledge_search")) return;
  registry.register(buildToolDefinition(deps));
}

function buildToolDefinition(deps: RegisterKnowledgeToolDeps): ToolDefinition {
  return {
    name: "knowledge_search",
    description:
      "Search the workspace L3 knowledge layer. " +
      "Unifies RAG code chunks and CodebaseGraph evidence into short, provenance-rich hits. " +
      "Does not mutate state; indexes must be built via /rag index and/or /graph build first.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language question, symbol name, or file/symbol lookup query",
        },
        topK: {
          type: "number",
          description: "Max hits to return (default 8, max 20)",
        },
        mode: {
          type: "string",
          enum: ["auto", "rag", "graph", "beelink"],
          description: "Search mode. auto searches available local L3 sources.",
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: ["rag", "graph", "beelink"],
          },
          description: "Optional source filter for auto mode. Use ['rag'], ['graph'], ['beelink'], or a combination.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async invoke(args) {
      const parsed = parseArgs(args);
      if (!parsed.query) {
        return {
          ok: false,
          content: "[knowledge_search] missing 'query'",
          isError: true,
          errorCode: "invalid_args",
        };
      }
      const result = searchKnowledge(deps.workspace, parsed.query, {
        ...(parsed.topK !== undefined ? { topK: parsed.topK } : {}),
        ...(parsed.mode ? { mode: parsed.mode } : {}),
        ...(parsed.sources ? { sources: parsed.sources } : {}),
      });
      return {
        ok: result.hits.length > 0,
        content: result.text,
        ...(result.hits.length === 0 ? { isError: true, errorCode: "no_matches" } : {}),
      };
    },
  };
}

function parseArgs(args: unknown): {
  query?: string;
  topK?: number;
  mode?: "auto" | "rag" | "graph" | "beelink";
  sources?: Array<"rag" | "graph" | "beelink">;
} {
  if (!args || typeof args !== "object") return {};
  const a = args as Record<string, unknown>;
  const mode = a.mode;
  const sources = Array.isArray(a.sources)
    ? [...new Set(a.sources.filter((source): source is "rag" | "graph" | "beelink" =>
      source === "rag" || source === "graph" || source === "beelink"
    ))]
    : undefined;
  return {
    query: typeof a.query === "string" ? a.query.trim() : undefined,
    topK: typeof a.topK === "number" ? a.topK : undefined,
    mode: mode === "auto" || mode === "rag" || mode === "graph" || mode === "beelink" ? mode : undefined,
    ...(sources && sources.length > 0 ? { sources } : {}),
  };
}
