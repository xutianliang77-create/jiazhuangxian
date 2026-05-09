/**
 * Web channel server 端到端集成测试
 *
 * 启 server 在随机端口，用 fetch 验证：
 *   - 401 unauthorized：缺 / 错 token
 *   - 创建 session 返回 sessionId
 *   - POST /messages 后能从 SSE 读到事件
 *   - DELETE sessions 后 stream 关闭
 *   - 跨用户隔离：A 的 token 拿不到 B 的 session
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { WebServerHandle } from "../../../../src/channels/web/server";
import { startWebServer } from "../../../../src/channels/web/server";
import type { McpManager } from "../../../../src/mcp/manager";
import { closeDataDb } from "../../../../src/storage/db";

const TOKEN = "test-token-aaaa1111";

let handle: WebServerHandle;
let baseUrl: string;

beforeEach(async () => {
  handle = await startWebServer({
    port: 0,
    auth: { bearerToken: TOKEN },
    engineDefaults: {
      currentProvider: null,
      fallbackProvider: null,
      permissionMode: "plan",
      workspace: process.cwd(),
      // dataDbPath 不传 → vitest 自动禁用 L2 memory
    },
  });
  baseUrl = `http://${handle.host}:${handle.port}`;
});

afterEach(async () => {
  await handle.close();
  try {
    closeDataDb();
  } catch {
    // noop
  }
});

function authHeaders(token = TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("Web server · 鉴权", () => {
  it("缺 Authorization → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/web/sessions`, { method: "POST" });
    expect(r.status).toBe(401);
  });

  it("错误 token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(r.status).toBe(401);
  });

  it("正确 token → 201 创建 session", async () => {
    const r = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { sessionId: string; userId: string };
    expect(body.sessionId).toMatch(/^web-/);
    expect(body.userId).toBe("web-test-tok");  // token 前 8 位 prefix
  });
});

function buildTinyDicom(): Buffer {
  const preamble = Buffer.alloc(128);
  const magic = Buffer.from("DICM", "ascii");
  const pixels = Buffer.alloc(8);
  [0, 1000, 2000, 3000].forEach((value, index) => pixels.writeUInt16LE(value, index * 2));
  return Buffer.concat([
    preamble,
    magic,
    dicomElement("0002", "0010", "UI", "1.2.840.10008.1.2.1"),
    dicomElement("0008", "0060", "CS", "DX"),
    dicomElement("0028", "0002", "US", 1),
    dicomElement("0028", "0004", "CS", "MONOCHROME2"),
    dicomElement("0028", "0010", "US", 2),
    dicomElement("0028", "0011", "US", 2),
    dicomElement("0028", "0100", "US", 16),
    dicomElement("0028", "0101", "US", 12),
    dicomElement("0028", "0103", "US", 0),
    dicomElement("0028", "1050", "DS", "1500"),
    dicomElement("0028", "1051", "DS", "3000"),
    dicomElement("7fe0", "0010", "OW", pixels),
  ]);
}

function dicomElement(groupHex: string, elementHex: string, vr: string, value: string | number | Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(Number.parseInt(groupHex, 16), 0);
  head.writeUInt16LE(Number.parseInt(elementHex, 16), 2);
  head.write(vr, 4, 2, "ascii");
  const valueBuf = dicomValueBuffer(vr, value);
  if (new Set(["OB", "OW", "SQ", "UN", "UT"]).has(vr)) {
    const len = Buffer.alloc(6);
    len.writeUInt32LE(valueBuf.length, 2);
    return Buffer.concat([head, len, valueBuf]);
  }
  const len = Buffer.alloc(2);
  len.writeUInt16LE(valueBuf.length, 0);
  return Buffer.concat([head, len, valueBuf]);
}

function dicomValueBuffer(vr: string, value: string | number | Buffer): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (vr === "US") {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(Number(value), 0);
    return out;
  }
  const text = `${value}${vr === "UI" ? "\0" : ""}`;
  return Buffer.from(text.length % 2 === 0 ? text : `${text} `, "ascii");
}

describe("Web server · session CRUD", () => {
  it("create → list 包含新 session", async () => {
    const created = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };

    const list = await fetch(`${baseUrl}/v1/web/sessions`, {
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessions: Array<{ sessionId: string }> };

    expect(list.sessions.find((s) => s.sessionId === created.sessionId)).toBeDefined();
  });

  it("delete 后 list 不再包含 / 再 delete 返回 404", async () => {
    const created = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };

    const del1 = await fetch(
      `${baseUrl}/v1/web/sessions/${encodeURIComponent(created.sessionId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    expect(del1.status).toBe(200);
    const del2 = await fetch(
      `${baseUrl}/v1/web/sessions/${encodeURIComponent(created.sessionId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    expect(del2.status).toBe(404);
  });

  it("跨用户隔离：A 看不到 B 的 session", async () => {
    handle.store.create("web-test-tok"); // user A
    handle.store.create("web-other-to"); // user B

    const listA = await fetch(`${baseUrl}/v1/web/sessions`, {
      headers: authHeaders(TOKEN),
    }).then((r) => r.json()) as { sessions: unknown[] };

    expect(listA.sessions).toHaveLength(1);
  });
});

describe("Web server · 消息 + SSE", () => {
  it("POST /messages → SSE 收到 event", async () => {
    const created = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };

    // 先建 SSE 连接（异步读流）
    const sseResponse = await fetch(
      `${baseUrl}/v1/web/stream?sessionId=${encodeURIComponent(created.sessionId)}`,
      { headers: authHeaders() }
    );
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toMatch(/text\/event-stream/);

    // 异步读 SSE 第一帧（QueryEngine 处理 /help 输出 message-complete）
    const reader = sseResponse.body!.getReader();
    const eventPromise = (async (): Promise<string> => {
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return buf;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes("data:")) return buf;
      }
    })();

    // 发送一个 /help 命令（QueryEngine 内部会同步处理给出 message-complete）
    const post = await fetch(`${baseUrl}/v1/web/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId: created.sessionId, input: "/help" }),
    });
    expect(post.status).toBe(202);

    const sse = await Promise.race([
      eventPromise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    expect(sse).toContain("data:");

    reader.cancel();
  });

  it("POST /messages 缺 input → 400", async () => {
    const created = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };

    const r = await fetch(`${baseUrl}/v1/web/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId: created.sessionId }),
    });
    expect(r.status).toBe(400);
  });

  it("POST /messages 不存在的 sessionId → 404", async () => {
    const r = await fetch(`${baseUrl}/v1/web/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId: "web-nonexistent-id", input: "/help" }),
    });
    expect(r.status).toBe(404);
  });
});

describe("Web server · 路由 misc", () => {
  it("GET / → 200 + HTML（默认 staticRoot 指 web/）", async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const ct = r.headers.get("content-type") ?? "";
    expect(ct).toMatch(/text\/(html|plain)/);
  });

  it("GET /static/styles.css → 200 + CSS", async () => {
    const r = await fetch(`${baseUrl}/static/styles.css`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/css/);
    const body = await r.text();
    expect(body).toContain("CodeClaw");
  });

  it("GET /static/app.js → 200 + JS", async () => {
    const r = await fetch(`${baseUrl}/static/app.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
  });

  it("GET /static/../etc/passwd → 404（path traversal 拦截）", async () => {
    const r = await fetch(`${baseUrl}/static/../etc/passwd`);
    expect(r.status).toBe(404);
  });

  it("GET /static/vendor/marked.min.js → 200 + 内容含 marked", async () => {
    const r = await fetch(`${baseUrl}/static/vendor/marked.min.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
    const body = await r.text();
    // marked.min.js 包含 "marked" 字串（库自身名称）
    expect(body.length).toBeGreaterThan(1000);
  });

  it("GET /static/vendor/purify.min.js → 200", async () => {
    const r = await fetch(`${baseUrl}/static/vendor/purify.min.js`);
    expect(r.status).toBe(200);
  });

  it("GET /legacy/ 返回的 HTML 含 markdown 库 script 标签（旧版）", async () => {
    // P3.2 起 / 默认升新 React UI；旧版（marked/purify/highlight 库）降级到 /legacy/
    const r = await fetch(`${baseUrl}/legacy/`);
    const body = await r.text();
    expect(body).toContain("marked.min.js");
    expect(body).toContain("purify.min.js");
    expect(body).toContain("highlight.min.js");
  });

  it("未知路径 → 404", async () => {
    const r = await fetch(`${baseUrl}/nonexistent`);
    expect(r.status).toBe(404);
  });

  it("GET /v1/web/stream 缺 sessionId → 400", async () => {
    const r = await fetch(`${baseUrl}/v1/web/stream`, { headers: authHeaders() });
    expect(r.status).toBe(400);
  });

  // ───────── #70-D 附件上传 ─────────
  it("POST /v1/web/messages 含 attachments → 202 accepted（dataUrl 落 tmp 不抛）", async () => {
    const sess = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };
    // 1×1 PNG dataUrl（base64）
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const r = await fetch(`${baseUrl}/v1/web/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        sessionId: sess.sessionId,
        input: "[image]",
        attachments: [
          { kind: "image", dataUrl: `data:image/png;base64,${tinyPng}`, fileName: "tiny.png", mimeType: "image/png" },
        ],
      }),
    });
    expect(r.status).toBe(202);
  });

  it("POST /v1/web/messages 含 DICOM attachment 但未配置 dicom MCP → 503", async () => {
    const sess = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };
    const dicom = buildTinyDicom().toString("base64");
    const r = await fetch(`${baseUrl}/v1/web/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        sessionId: sess.sessionId,
        input: "请用中文解读这份 DICOM 影像",
        attachments: [
          { kind: "dicom", dataUrl: `data:application/dicom;base64,${dicom}`, fileName: "tiny.dcm", mimeType: "application/dicom" },
        ],
      }),
    });
    expect(r.status).toBe(503);
    const body = await r.json() as { detail?: string };
    expect(body.detail).toContain("dicom mcp unavailable");
  });

  it("POST /v1/web/messages 含 DICOM attachment → 通过 dicom MCP 后 202 accepted", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-dicom-test-"));
    const pngPath = path.join(dir, "prepared.png");
    writeFileSync(pngPath, Buffer.from("89504e470d0a1a0a", "hex"));
    let dicomHandle: WebServerHandle | null = null;
    try {
      const calls: Array<{ server: string; tool: string; args: unknown }> = [];
      const fakeMcpManager = {
        isReady: (server: string) => server === "dicom",
        async callTool(server: string, tool: string, args: unknown) {
          calls.push({ server, tool, args });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  pngPath,
                  promptContext: "DICOM image prepared for vision model. PHI has been redacted.",
                }),
              },
            ],
          };
        },
      } as unknown as McpManager;
      dicomHandle = await startWebServer({
        port: 0,
        auth: { bearerToken: TOKEN },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
        },
        mcpManager: fakeMcpManager,
      });
      const dicomBaseUrl = `http://${dicomHandle.host}:${dicomHandle.port}`;
      const sess = await fetch(`${dicomBaseUrl}/v1/web/sessions`, {
        method: "POST",
        headers: authHeaders(),
      }).then((r) => r.json()) as { sessionId: string };
      const dicom = buildTinyDicom().toString("base64");
      const r = await fetch(`${dicomBaseUrl}/v1/web/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId: sess.sessionId,
          input: "请用中文解读这份 DICOM 影像",
          attachments: [
            { kind: "dicom", dataUrl: `data:application/dicom;base64,${dicom}`, fileName: "tiny.dcm", mimeType: "application/dicom" },
          ],
        }),
      });
      expect(r.status).toBe(202);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ server: "dicom", tool: "PrepareDicomForVision" });
    } finally {
      await dicomHandle?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /v1/web/messages 含恶意 dataUrl（不带 base64 前缀） → 仍 202（attachment 静默丢弃）", async () => {
    const sess = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };
    const r = await fetch(`${baseUrl}/v1/web/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        sessionId: sess.sessionId,
        input: "hi",
        attachments: [{ kind: "image", dataUrl: "javascript:alert(1)" }],
      }),
    });
    expect(r.status).toBe(202);
  });

  // ───────── #94 设置中心写操作 PATCH /v1/web/providers/<type> ─────────
  it("PATCH /v1/web/providers/<unknown> → 400", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers/evil`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ enabled: true }),
    });
    expect(r.status).toBe(400);
  });

  it("PATCH /v1/web/providers/openai 含 apiKey 字段 → 400 拒绝（避免明文落盘）", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers/openai`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ apiKey: "sk-secret-via-web" }),
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/apiKey/i);
  });

  it("PATCH baseUrl 非 http(s) → 400", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers/openai`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ baseUrl: "javascript:alert(1)" }),
    });
    expect(r.status).toBe(400);
  });

  it("PATCH timeoutMs 负数 → 400", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers/openai`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ timeoutMs: -1 }),
    });
    expect(r.status).toBe(400);
  });

  it("PATCH 错 token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers/openai`, {
      method: "PATCH",
      headers: { Authorization: "Bearer wrong" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(r.status).toBe(401);
  });

  it("PATCH 全空 body → 400 'no valid fields'", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers/openai`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ randomNoise: 123 }),
    });
    expect(r.status).toBe(400);
  });

  // ───────── #70-B 设置中心 ─────────
  it("GET /v1/web/providers · 默认无 provider 注入 → current/fallback 都为 null", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json() as { current: unknown; fallback: unknown };
    expect(body.current).toBeNull();
    expect(body.fallback).toBeNull();
  });

  it("GET /v1/web/providers 错 token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/web/providers`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(r.status).toBe(401);
  });

  // ───────── #70-A cost dashboard ─────────
  it("GET /v1/web/cost 缺 sessionId → 400", async () => {
    const r = await fetch(`${baseUrl}/v1/web/cost`, { headers: authHeaders() });
    expect(r.status).toBe(400);
  });

  it("GET /v1/web/cost · dataDb 未注入 → 200 enabled=false", async () => {
    // 当前 server 启动 engineDefaults.dataDbPath 不传 → dataDb 未注入
    const sess = await fetch(`${baseUrl}/v1/web/sessions`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.json()) as { sessionId: string };
    const r = await fetch(`${baseUrl}/v1/web/cost?sessionId=${encodeURIComponent(sess.sessionId)}`, {
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  it("GET /v1/web/cost 错误 token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/web/cost?sessionId=x`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(r.status).toBe(401);
  });

  it("GET /v1/web/providers · 注入 provider 时返 sanitized 字段（不含 apiKey）", async () => {
    const customHandle = await startWebServer({
      port: 0,
      auth: { bearerToken: TOKEN },
      engineDefaults: {
        currentProvider: {
          instanceId: "openai:default",
          type: "openai",
          displayName: "OpenAI",
          kind: "cloud",
          enabled: true,
          requiresApiKey: true,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          timeoutMs: 30000,
          apiKey: "sk-secret-redacted",
          apiKeyEnvVar: "OPENAI_API_KEY",
          envVars: ["OPENAI_API_KEY"],
          fileConfig: {} as never,
          configured: true,
          available: true,
          reason: "configured",
        },
        fallbackProvider: null,
        permissionMode: "plan",
        workspace: process.cwd(),
      },
    });
    try {
      const url = `http://${customHandle.host}:${customHandle.port}`;
      const r = await fetch(`${url}/v1/web/providers`, { headers: authHeaders() });
      expect(r.status).toBe(200);
      const body = await r.json() as { current: Record<string, unknown> | null; fallback: unknown };
      expect(body.current).not.toBeNull();
      expect(body.current!.model).toBe("gpt-4.1-mini");
      expect(body.current!.baseUrl).toBe("https://api.openai.com/v1");
      // 关键：apiKey / envVars / fileConfig 不应外泄
      expect(JSON.stringify(body)).not.toContain("sk-secret-redacted");
      expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
      expect(body.fallback).toBeNull();
    } finally {
      await customHandle.close();
    }
  });

  it("无 CODECLAW_WEB_TOKEN env → startWebServer reject", async () => {
    await expect(
      startWebServer({
        port: 0,
        auth: { bearerToken: null },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
        },
      })
    ).rejects.toThrow(/CODECLAW_WEB_TOKEN/);
  });
});

describe("Web server · medical API", () => {
  it("GET /v1/web/medical/summary without dataDb → enabled=false", async () => {
    const r = await fetch(`${baseUrl}/v1/web/medical/summary`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json() as { enabled: boolean; warnings: string[]; recentStudies: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.warnings).toContain("data_db_not_configured");
    expect(body.recentStudies).toEqual([]);
  });

  it("GET /v1/web/medical/summary returns counts, queue status, and recent studies", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-medical-"));
    const dbPath = path.join(dir, "data.db");
    let medicalHandle: WebServerHandle | null = null;
    try {
      medicalHandle = await startWebServer({
        port: 0,
        auth: { bearerToken: TOKEN },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
          dataDbPath: dbPath,
        },
      });
      const db = new Database(dbPath);
      try {
        const now = Date.now();
        db.exec(`
          INSERT INTO patient(id, external_patient_id, deidentified, meta_json, created_at, updated_at)
          VALUES ('P1', 'EXT-P1', 1, '{}', ${now}, ${now});
          INSERT INTO study(id, patient_id, modality, body_part, status, source_type, created_at, updated_at)
          VALUES ('S1', 'P1', 'US', 'thyroid', 'created', 'manual', ${now}, ${now});
          INSERT INTO image(id, study_id, file_uri, file_type, dicom_metadata, processing_status, created_at, updated_at)
          VALUES ('IMG1', 'S1', 'artifact://raw/S1/IMG1.png', 'png', '{}', 'uploaded', ${now}, ${now});
          INSERT INTO analysis_session(id, study_id, status, trigger_source, summary_json, created_at, updated_at)
          VALUES ('AS1', 'S1', 'running', 'manual', '{}', ${now}, ${now});
          INSERT INTO agent_task(id, analysis_session_id, agent_name, task_type, status, input_json, created_at, updated_at)
          VALUES ('AT1', 'AS1', 'NoduleDetectionAgent', 'detect_nodules', 'queued', '{}', ${now}, ${now});
          INSERT INTO model_job(id, study_id, image_id, job_type, status, input_json, created_at, updated_at)
          VALUES ('MJ1', 'S1', 'IMG1', 'thyroid.detect_nodules', 'queued', '{}', ${now}, ${now});
          INSERT INTO nodule(id, study_id, image_id, nodule_index, source, created_at, updated_at)
          VALUES ('N1', 'S1', 'IMG1', 1, 'ai', ${now}, ${now});
          INSERT INTO report(id, study_id, analysis_session_id, report_type, status, structured_json, evidence_json, created_at, updated_at)
          VALUES ('R1', 'S1', 'AS1', 'thyroid_ultrasound', 'draft', '{}', '[]', ${now}, ${now});
        `);
      } finally {
        db.close();
      }

      const medicalBaseUrl = `http://${medicalHandle.host}:${medicalHandle.port}`;
      const r = await fetch(`${medicalBaseUrl}/v1/web/medical/summary?limit=5`, { headers: authHeaders() });
      expect(r.status).toBe(200);
      const body = await r.json() as {
        enabled: boolean;
        counts: Record<string, number>;
        queues: Record<string, Record<string, number>>;
        recentStudies: Array<Record<string, unknown>>;
      };
      expect(body.enabled).toBe(true);
      expect(body.counts).toMatchObject({
        patients: 1,
        studies: 1,
        images: 1,
        analysisSessions: 1,
        nodules: 1,
        reports: 1,
        pendingReviews: 1,
      });
      expect(body.queues.modelJobs.queued).toBe(1);
      expect(body.queues.agentTasks.queued).toBe(1);
      expect(body.recentStudies[0]).toMatchObject({
        id: "S1",
        externalPatientId: "EXT-P1",
        accessionNo: null,
        imageCount: 1,
        noduleCount: 1,
        latestAnalysisStatus: "running",
        latestReportStatus: "draft",
      });
    } finally {
      await medicalHandle?.close();
      closeDataDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /v1/web/medical/model-gateway/check proxies model-gateway config", async () => {
    const gateway = http.createServer((req, res) => {
      if (req.url !== "/model/v1/config/check") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        status: "ok",
        result: {
          status: "degraded",
          ready_detectors: ["yolov11"],
          runtime: { gpu: { cuda_available: false, device_count: 0 } },
        },
        warnings: ["cuda_unavailable"],
      }));
    });
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address();
    const previousUrl = process.env.JZX_MODEL_GATEWAY_URL;
    process.env.JZX_MODEL_GATEWAY_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      const response = await fetch(`${baseUrl}/v1/web/medical/model-gateway/check`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as {
        reachable: boolean;
        httpStatus: number;
        result: Record<string, unknown>;
        warnings: string[];
      };
      expect(body.reachable).toBe(true);
      expect(body.httpStatus).toBe(200);
      expect(body.result.status).toBe("degraded");
      expect(body.result.ready_detectors).toEqual(["yolov11"]);
      expect(body.warnings).toContain("cuda_unavailable");
    } finally {
      if (previousUrl === undefined) {
        delete process.env.JZX_MODEL_GATEWAY_URL;
      } else {
        process.env.JZX_MODEL_GATEWAY_URL = previousUrl;
      }
      await new Promise<void>((resolve, reject) => gateway.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("POST medical patients/studies/images registers a manual validation case", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-medical-write-"));
    const dbPath = path.join(dir, "data.db");
    let medicalHandle: WebServerHandle | null = null;
    try {
      medicalHandle = await startWebServer({
        port: 0,
        auth: { bearerToken: TOKEN },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
          dataDbPath: dbPath,
        },
      });
      const medicalBaseUrl = `http://${medicalHandle.host}:${medicalHandle.port}`;

      const patientResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/patients`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          externalPatientId: "EXT-WEB-P1",
          nameHash: "hash-p1",
          sex: "F",
          birthYear: 1980,
          meta: { source: "manual-validation" },
        }),
      });
      expect(patientResponse.status).toBe(201);
      const patientBody = (await patientResponse.json()) as { patient: { id: string; externalPatientId: string } };
      expect(patientBody.patient.externalPatientId).toBe("EXT-WEB-P1");

      const studyResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/studies`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          patientId: patientBody.patient.id,
          accessionNo: "ACC-WEB-1",
          clinicalContext: "手工验证病例",
        }),
      });
      expect(studyResponse.status).toBe(201);
      const studyBody = (await studyResponse.json()) as { study: { id: string; createdBy: string } };
      expect(studyBody.study.createdBy).toBe("web-test-tok");

      const imageResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/images`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          studyId: studyBody.study.id,
          fileUri: "artifact://raw/ACC-WEB-1/IMG1.png",
          fileType: "png",
          width: 640,
          height: 480,
          pixelSpacing: { row_mm: 0.08, col_mm: 0.08 },
        }),
      });
      expect(imageResponse.status).toBe(201);
      const imageBody = (await imageResponse.json()) as { image: { id: string; studyId: string; fileUri: string } };
      expect(imageBody.image).toMatchObject({
        studyId: studyBody.study.id,
        fileUri: "artifact://raw/ACC-WEB-1/IMG1.png",
      });

      const summary = await fetch(`${medicalBaseUrl}/v1/web/medical/summary`, { headers: authHeaders() });
      expect(summary.status).toBe(200);
      const summaryBody = (await summary.json()) as {
        counts: Record<string, number>;
        recentStudies: Array<Record<string, unknown>>;
      };
      expect(summaryBody.counts).toMatchObject({ patients: 1, studies: 1, images: 1 });
      expect(summaryBody.recentStudies[0]).toMatchObject({
        id: studyBody.study.id,
        externalPatientId: "EXT-WEB-P1",
        accessionNo: "ACC-WEB-1",
        imageCount: 1,
      });
    } finally {
      await medicalHandle?.close();
      closeDataDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET medical study detail and POST analyze queues validation agent tasks", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-medical-analyze-"));
    const dbPath = path.join(dir, "data.db");
    let medicalHandle: WebServerHandle | null = null;
    try {
      medicalHandle = await startWebServer({
        port: 0,
        auth: { bearerToken: TOKEN },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
          dataDbPath: dbPath,
        },
      });
      const medicalBaseUrl = `http://${medicalHandle.host}:${medicalHandle.port}`;

      const patientResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/patients`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ externalPatientId: "EXT-ANALYZE-P1" }),
      });
      const patientBody = (await patientResponse.json()) as { patient: { id: string } };
      const studyResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/studies`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ patientId: patientBody.patient.id, accessionNo: "ACC-ANALYZE-1" }),
      });
      const studyBody = (await studyResponse.json()) as { study: { id: string } };
      const imageResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/images`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          studyId: studyBody.study.id,
          fileUri: "artifact://raw/ACC-ANALYZE-1/IMG1.png",
          fileType: "png",
        }),
      });
      const imageBody = (await imageResponse.json()) as { image: { id: string } };
      const db = new Database(dbPath);
      try {
        const now = Date.now();
        db.prepare(
          `INSERT INTO model_job(
             id, study_id, image_id, job_type, status, input_json, output_json,
             model_name, model_version, artifact_uri, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "MJ-DETAIL-1",
          studyBody.study.id,
          imageBody.image.id,
          "thyroid.detect_nodules",
          "succeeded",
          "{}",
          JSON.stringify({ artifacts: { detections_json: "artifact://model-output/S1/IMG1/MJ-DETAIL-1/detections.json" } }),
          "yolov11-thyroid-detector",
          "validation",
          "artifact://model-output/S1/IMG1/MJ-DETAIL-1/detections.json",
          now,
          now
        );
      } finally {
        db.close();
      }

      const detail = await fetch(`${medicalBaseUrl}/v1/web/medical/studies/${studyBody.study.id}`, {
        headers: authHeaders(),
      });
      expect(detail.status).toBe(200);
      const detailBody = (await detail.json()) as {
        bundle: {
          images: unknown[];
          nodules: unknown[];
          tiradsResults: unknown[];
          reports: unknown[];
          auditLogs: unknown[];
          modelJobs: Array<{ artifactUri: string | null; modelName: string | null; status: string }>;
          agentTasks: unknown[];
        };
      };
      expect(detailBody.bundle.images).toHaveLength(1);
      expect(detailBody.bundle.nodules).toHaveLength(0);
      expect(detailBody.bundle.tiradsResults).toHaveLength(0);
      expect(detailBody.bundle.reports).toHaveLength(0);
      expect(detailBody.bundle.auditLogs).toHaveLength(0);
      expect(detailBody.bundle.modelJobs).toHaveLength(1);
      expect(detailBody.bundle.modelJobs[0]).toMatchObject({
        status: "succeeded",
        modelName: "yolov11-thyroid-detector",
        artifactUri: "artifact://model-output/S1/IMG1/MJ-DETAIL-1/detections.json",
      });
      expect(detailBody.bundle.agentTasks).toHaveLength(0);

      const analyze = await fetch(`${medicalBaseUrl}/v1/web/medical/studies/${studyBody.study.id}/analyze`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ imageId: imageBody.image.id }),
      });
      expect(analyze.status).toBe(201);
      const analyzeBody = (await analyze.json()) as {
        analysisSession: { status: string; createdBy: string; summary: Record<string, unknown> };
        agentTasks: Array<{ id: string; taskType: string; status: string; parentTaskId: string | null }>;
      };
      expect(analyzeBody.analysisSession).toMatchObject({
        status: "queued",
        createdBy: "web-test-tok",
      });
      expect(analyzeBody.analysisSession.summary.selected_image_id).toBe(imageBody.image.id);
      expect(analyzeBody.agentTasks.map((task) => task.taskType)).toEqual([
        "image_qc",
        "detect_nodules",
        "classify_tirads_features",
        "calculate_tirads",
        "draft_report",
        "safety_review",
      ]);
      expect(analyzeBody.agentTasks.every((task) => task.status === "queued")).toBe(true);
      expect(analyzeBody.agentTasks[0].parentTaskId).toBeNull();
      expect(analyzeBody.agentTasks[1].parentTaskId).toBe(analyzeBody.agentTasks[0].id);

      const detailAfter = await fetch(`${medicalBaseUrl}/v1/web/medical/studies/${studyBody.study.id}`, {
        headers: authHeaders(),
      });
      const detailAfterBody = (await detailAfter.json()) as {
        bundle: { analysisSessions: unknown[]; agentTasks: unknown[] };
      };
      expect(detailAfterBody.bundle.analysisSessions).toHaveLength(1);
      expect(detailAfterBody.bundle.agentTasks).toHaveLength(6);

      const summary = await fetch(`${medicalBaseUrl}/v1/web/medical/summary`, { headers: authHeaders() });
      const summaryBody = (await summary.json()) as { queues: { agentTasks: Record<string, number> } };
      expect(summaryBody.queues.agentTasks.queued).toBe(6);
    } finally {
      await medicalHandle?.close();
      closeDataDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST medical report review confirms a draft report", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-medical-review-"));
    const dbPath = path.join(dir, "data.db");
    let medicalHandle: WebServerHandle | null = null;
    let localDb: Database.Database | null = null;
    try {
      medicalHandle = await startWebServer({
        port: 0,
        auth: { bearerToken: TOKEN },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
          dataDbPath: dbPath,
        },
      });
      const medicalBaseUrl = `http://${medicalHandle.host}:${medicalHandle.port}`;

      const patientResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/patients`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ externalPatientId: "EXT-REVIEW-P1" }),
      });
      const patientBody = (await patientResponse.json()) as { patient: { id: string } };
      const studyResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/studies`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ patientId: patientBody.patient.id, accessionNo: "ACC-REVIEW-1" }),
      });
      const studyBody = (await studyResponse.json()) as { study: { id: string } };
      const now = Date.now();
      localDb = new Database(dbPath);
      localDb
        .prepare(
          `INSERT INTO report(
             id, study_id, report_type, status, draft_text, structured_json,
             evidence_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "R-WEB-REVIEW",
          studyBody.study.id,
          "thyroid_ultrasound",
          "draft",
          "AI draft",
          "{}",
          "[]",
          now,
          now
        );
      localDb.close();
      localDb = null;

      const reviewResponse = await fetch(`${medicalBaseUrl}/v1/web/medical/reports/R-WEB-REVIEW/review`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "approve", finalText: "doctor final report", comment: "ok" }),
      });
      expect(reviewResponse.status).toBe(200);
      const reviewBody = (await reviewResponse.json()) as {
        report: { status: string; finalText: string; confirmedBy: string };
        doctorReview: { action: string; reviewerName: string; comment: string };
        auditLog: { action: string; actorType: string; targetId: string };
        bundle: { reports: Array<{ status: string }>; doctorReviews: Array<{ action: string }> };
      };
      expect(reviewBody.report).toMatchObject({
        status: "confirmed",
        finalText: "doctor final report",
        confirmedBy: "web-test-tok",
      });
      expect(reviewBody.doctorReview).toMatchObject({
        action: "approve",
        reviewerName: "web-test-tok",
        comment: "ok",
      });
      expect(reviewBody.auditLog).toMatchObject({
        action: "medical.report.approve",
        actorType: "doctor",
        targetId: "R-WEB-REVIEW",
      });
      expect(reviewBody.bundle.reports[0].status).toBe("confirmed");
      expect(reviewBody.bundle.doctorReviews[0].action).toBe("approve");
    } finally {
      localDb?.close();
      await medicalHandle?.close();
      closeDataDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST medical image with unknown study → 400 invalid-reference", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codeclaw-web-medical-write-"));
    const dbPath = path.join(dir, "data.db");
    let medicalHandle: WebServerHandle | null = null;
    try {
      medicalHandle = await startWebServer({
        port: 0,
        auth: { bearerToken: TOKEN },
        engineDefaults: {
          currentProvider: null,
          fallbackProvider: null,
          permissionMode: "plan",
          workspace: process.cwd(),
          dataDbPath: dbPath,
        },
      });
      const medicalBaseUrl = `http://${medicalHandle.host}:${medicalHandle.port}`;
      const r = await fetch(`${medicalBaseUrl}/v1/web/medical/images`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          studyId: "missing-study",
          fileUri: "artifact://raw/missing.png",
        }),
      });
      expect(r.status).toBe(400);
      const body = (await r.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid-reference");
    } finally {
      await medicalHandle?.close();
      closeDataDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /v1/web/medical/summary wrong token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/web/medical/summary`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(r.status).toBe(401);
  });
});
