#!/usr/bin/env node
import readline from "node:readline";
import { BeelinkMcpServer } from "./server";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
}

const server = new BeelinkMcpServer();
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    return;
  }

  if (msg.method === "notifications/initialized" || msg.method === "notifications/shutdown") return;
  if (msg.id === undefined) return;

  try {
    if (msg.method === "initialize") {
      send(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "beelink-mcp", version: "0.1.0" },
      });
      return;
    }
    if (msg.method === "tools/list") {
      send(msg.id, { tools: server.listTools() });
      return;
    }
    if (msg.method === "tools/call") {
      const params = asRecord(msg.params);
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments ?? {};
      send(msg.id, await server.callTool(name, args));
      return;
    }
    sendError(msg.id, -32601, `method not found: ${msg.method ?? "unknown"}`);
  } catch (err) {
    sendError(msg.id, -32000, err instanceof Error ? err.message : String(err));
  }
}

function send(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id: number | string, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
