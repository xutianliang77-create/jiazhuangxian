#!/usr/bin/env tsx
/**
 * CodeClaw Data Golden Suite runner.
 *
 * Usage:
 *   npm run golden:data -- --dry-run
 *   npm run golden:data -- --mock
 *   npm run golden:data -- --layer sql
 *   npm run golden:data -- --id DATA-001
 */

import process from "node:process";
import { DataGoldenLoaderError, loadAllDataGolden } from "./data-loader";
import { printSummaryDataGolden, defaultDataGoldenReportPath, summarizeDataGolden, writeJsonlReportDataGolden } from "./data-report";
import { scoreDataGolden } from "./data-scorer";
import { MockDataGoldenInvoker, RealDataGoldenInvoker, type DataGoldenInvoker } from "./data-invoker";
import type { DataGoldenCase, DataGoldenLayer, DataGoldenRunRecord, DataGoldenRunnerConfig } from "./data-types";

function parseArgs(argv: string[]): DataGoldenRunnerConfig {
  const cfg: DataGoldenRunnerConfig = { useMock: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        cfg.dryRun = true;
        break;
      case "--mock":
        cfg.useMock = true;
        break;
      case "--real":
        cfg.useMock = false;
        break;
      case "--verbose":
      case "-v":
        cfg.verbose = true;
        break;
      case "--id": {
        const value = argv[++i];
        if (value) cfg.ids = (cfg.ids ?? []).concat(value.split(","));
        break;
      }
      case "--layer": {
        const value = argv[++i];
        if (value) {
          cfg.layerFilter = (cfg.layerFilter ?? []).concat(
            value.split(",").map((part) => part.trim() as DataGoldenLayer)
          );
        }
        break;
      }
      case "--report":
        cfg.reportPath = argv[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }
  return cfg;
}

function printHelp(): void {
  console.log(`
Golden Set · CodeClaw Data runner

Options:
  --dry-run              Load + validate the 100 data cases only.
  --mock                 Use deterministic mock invoker (default).
  --real                 Reserved for future real QueryEngine + Beelink execution.
  --id <DATA-001,...>    Run selected case ids.
  --layer <layer>        Filter layer: metadata|semantic|sql|execution|repair|chart|report|security|workflow|runtime.
  --report <path>        Write jsonl report to path.
  --verbose, -v          Print each case result.
`);
}

async function main(): Promise<number> {
  const cfg = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  let cases: DataGoldenCase[];
  try {
    cases = loadAllDataGolden();
  } catch (err) {
    if (err instanceof DataGoldenLoaderError) console.error(`[loader] ${err.message}`);
    else console.error("[loader] unexpected error:", err);
    return 2;
  }

  if (cfg.ids?.length) {
    const wanted = new Set(cfg.ids);
    cases = cases.filter((item) => wanted.has(item.id));
  }
  if (cfg.layerFilter?.length) {
    const wanted = new Set(cfg.layerFilter);
    cases = cases.filter((item) => wanted.has(item.layer));
  }

  console.log(`Loaded ${cases.length} data golden cases.`);
  if (cases.length === 0) return 0;
  if (cfg.dryRun) {
    console.log("[dry-run] Skipping invocation; schema valid.");
    return 0;
  }
  let invoker: DataGoldenInvoker;
  if (cfg.useMock) {
    invoker = new MockDataGoldenInvoker();
    console.log("[mock] using deterministic data invoker");
  } else {
    try {
      invoker = await RealDataGoldenInvoker.create();
      const real = invoker as RealDataGoldenInvoker;
      const ready = real.serverReady("beelink");
      const tools = real.listToolNames("beelink");
      if (!ready) {
        console.error("[real] beelink MCP server not ready. Check ~/.codeclaw/mcp.json and env BEELINK_*.");
      } else {
        console.log(`[real] beelink MCP ready · ${tools.length} tools available`);
      }
    } catch (err) {
      console.error(`[real] failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }
  const records: DataGoldenRunRecord[] = [];
  try {
    for (const item of cases) {
      const callStart = Date.now();
      const response = await invoker.invoke(item);
      const score = scoreDataGolden(item, response.answer, response.toolsInvoked);
      const record: DataGoldenRunRecord = {
        id: item.id,
        version: item.version,
        layer: item.layer,
        difficulty: item.difficulty,
        provider: response.provider,
        modelId: response.modelId,
        promptChars: item.prompt.length,
        answerChars: response.answer.length,
        answerExcerpt: response.answer.slice(0, 300),
        toolsInvoked: response.toolsInvoked,
        latencyMs: response.latencyMs,
        score,
        timestamp: callStart,
      };
      records.push(record);
      if (cfg.verbose || !score.pass) {
        const marker = score.pass ? "✓" : "✗";
        console.log(`  ${marker} ${item.id} [${item.layer}/${item.difficulty}] ${score.reason}`);
      }
    }
  } finally {
    await invoker.shutdown?.().catch(() => undefined);
  }

  const summary = summarizeDataGolden(records, startedAt);
  const reportPath = cfg.reportPath ?? defaultDataGoldenReportPath();
  writeJsonlReportDataGolden(records, summary, reportPath);
  console.log(`\nReport: ${reportPath}`);
  printSummaryDataGolden(summary);
  return summary.meetsGate ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("data golden runner fatal:", err);
    process.exit(2);
  });
