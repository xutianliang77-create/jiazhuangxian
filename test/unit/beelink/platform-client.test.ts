import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BeelinkPlatformClient } from "../../../packages/beelink-mcp/src/platformClient";
import type { BeelinkConfig } from "../../../packages/beelink-mcp/src/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("BeelinkPlatformClient SQL artifact export", () => {
  it("pages SQL results into a bounded JSON artifact", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "beelink-platform-client-"));
    tempDirs.push(dir);
    const config = testConfig(dir);
    const client = new BeelinkPlatformClient(config, fakeFetch() as typeof fetch);

    const exported = await client.exportSqlArtifact({
      sql: "select item_name from sales order by item_name",
      previewRows: 1,
      maxRows: 2,
      pageRows: 1,
      timeoutMs: 1000,
      artifactsRoot: config.artifactsRoot,
    });

    expect(exported).toMatchObject({
      queryId: "query-1",
      exportedRows: 2,
      rowCount: 3,
      truncated: true,
      previewRows: [{ item_name: "Bread" }],
    });
    const artifact = JSON.parse(await readFile(exported.artifact.path, "utf8"));
    expect(artifact).toMatchObject({
      kind: "beelink-sql-result",
      queryId: "query-1",
      exportedRows: 2,
      rowCount: 3,
      truncated: true,
    });
    expect(artifact.rows).toEqual([{ item_name: "Bread" }, { item_name: "Noodles" }]);
  });
});

function fakeFetch(): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const requestUrl = new URL(String(input));
    const pathName = requestUrl.pathname;
    if (pathName === "/apiv2/login") return json({ token: "token-1" });
    if (pathName === "/api/v3/sql" && init?.method === "POST") return json({ id: "query-1" });
    if (pathName === "/api/v3/job/query-1") return json({ id: "query-1", jobState: "COMPLETED", rowCount: 3 });
    if (pathName === "/api/v3/job/query-1/results") {
      const offset = Number(requestUrl.searchParams.get("offset") ?? "0");
      const limit = Number(requestUrl.searchParams.get("limit") ?? "1");
      const rows = [{ item_name: "Bread" }, { item_name: "Noodles" }, { item_name: "Coffee" }];
      return json({
        rowCount: rows.length,
        columns: [{ name: "item_name", type: "VARCHAR" }],
        rows: rows.slice(offset, offset + limit),
      });
    }
    return json({ message: `unexpected path ${pathName}` }, 404);
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function testConfig(dir: string): BeelinkConfig {
  return {
    baseUrl: "http://localhost:9047",
    username: "x",
    password: "x",
    timeoutMs: 1000,
    previewRows: 5,
    maxPreviewRows: 50,
    artifactsRoot: path.join(dir, "artifacts"),
    exportMaxRows: 5000,
    exportPageRows: 500,
    metadataDbPath: path.join(dir, "metadata.db"),
    semanticLayerPath: path.join(dir, "semantic-layer.json"),
    glossaryPath: path.join(dir, "glossary.md"),
  };
}
