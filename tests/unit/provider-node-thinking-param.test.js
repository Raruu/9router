// Per-custom-provider thinking-control field: persisted on the node, copied to
// every connection, and preserved through an OpenAI ↔ Anthropic type switch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-thinking-param-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("../../src/lib/modelCatalog/runtime.js", () => ({
    refreshModelCatalogRuntime: vi.fn(async () => null),
  }));
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
});

afterEach(() => {
  vi.doUnmock("../../src/lib/modelCatalog/runtime.js");
  vi.doUnmock("next/server");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function makeNode(db, overrides = {}) {
  return db.createProviderNode({
    id: "openai-compatible-chat-param",
    type: "openai-compatible",
    name: "AMD CN",
    prefix: "amd-cn",
    apiType: "chat",
    baseUrl: "https://developer.amd.com.cn/radeon/api/v1",
    ...overrides,
  });
}

describe("nodesRepo thinkingParam", () => {
  it("updates and clears the node value", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await makeNode(db);

    const updated = await db.updateProviderNode(node.id, { thinkingParam: "reasoning_effort" });
    expect(updated.thinkingParam).toBe("reasoning_effort");
    expect((await db.getProviderNodeById(node.id)).thinkingParam).toBe("reasoning_effort");

    const cleared = await db.updateProviderNode(node.id, { thinkingParam: "" });
    expect(cleared.thinkingParam).toBeUndefined();
    expect((await db.getProviderNodeById(node.id)).thinkingParam).toBeUndefined();
  });

  it("clears the value and connection copy when converting away from Chat Completions", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await makeNode(db, { thinkingParam: "reasoning.effort" });
    const conn = await db.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "key-1",
      providerSpecificData: { prefix: "amd-cn", baseUrl: node.baseUrl, thinkingParam: "reasoning.effort" },
    });

    const converted = await db.convertProviderNodeType(node.id, {
      type: "anthropic-compatible",
      name: "AMD CN",
      prefix: "amd-cn",
      baseUrl: "https://developer.amd.com.cn/radeon/api/v1",
    });
    expect(converted.thinkingParam).toBeUndefined();
    const storedConn = await db.getProviderConnectionById(conn.id);
    expect(storedConn.providerSpecificData.thinkingParam).toBeUndefined();
  });
});

describe("provider-nodes API thinkingParam", () => {
  it("creates a node with a valid value", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const { POST } = await import("../../src/app/api/provider-nodes/route.js");

    const res = await POST(new Request("http://localhost/api/provider-nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "AMD CN",
        prefix: "amd-cn",
        apiType: "chat",
        baseUrl: "https://developer.amd.com.cn/radeon/api/v1",
        type: "openai-compatible",
        thinkingParam: "reasoning_effort",
      }),
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.node.thinkingParam).toBe("reasoning_effort");
    expect((await db.getProviderNodeById(body.node.id)).thinkingParam).toBe("reasoning_effort");
  });

  it("does not store the value on a Responses node", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const { POST } = await import("../../src/app/api/provider-nodes/route.js");

    const res = await POST(new Request("http://localhost/api/provider-nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Responses Node",
        prefix: "resp-node",
        apiType: "responses",
        baseUrl: "https://api.openai.com/v1",
        type: "openai-compatible",
        thinkingParam: "reasoning_effort",
      }),
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.node.thinkingParam).toBeUndefined();
    expect((await db.getProviderNodeById(body.node.id)).thinkingParam).toBeUndefined();
  });

  it("rejects an unknown value", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const { POST } = await import("../../src/app/api/provider-nodes/route.js");

    const res = await POST(new Request("http://localhost/api/provider-nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "AMD CN",
        prefix: "amd-cn",
        apiType: "chat",
        baseUrl: "https://developer.amd.com.cn/radeon/api/v1",
        type: "openai-compatible",
        thinkingParam: "reasoning_effort_nested",
      }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid thinking parameter");
  });

  it("syncs edits and clears across existing connections", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await makeNode(db);
    const conn = await db.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "key-1",
      providerSpecificData: { prefix: "amd-cn", baseUrl: node.baseUrl },
    });
    const { PUT } = await import("../../src/app/api/provider-nodes/[id]/route.js");

    const setRes = await PUT(new Request(`http://localhost/api/provider-nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: node.name,
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        thinkingParam: "reasoning.effort",
      }),
    }), { params: Promise.resolve({ id: node.id }) });
    expect(setRes.status).toBe(200);
    expect((await db.getProviderNodeById(node.id)).thinkingParam).toBe("reasoning.effort");
    expect((await db.getProviderConnectionById(conn.id)).providerSpecificData.thinkingParam).toBe("reasoning.effort");

    const clearRes = await PUT(new Request(`http://localhost/api/provider-nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: node.name,
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        thinkingParam: "",
      }),
    }), { params: Promise.resolve({ id: node.id }) });
    expect(clearRes.status).toBe(200);
    expect((await db.getProviderNodeById(node.id)).thinkingParam).toBeUndefined();
    expect((await db.getProviderConnectionById(conn.id)).providerSpecificData.thinkingParam).toBeUndefined();
  });

  it("clears the value when a chat node switches to Responses", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await makeNode(db, { thinkingParam: "reasoning_effort" });
    const conn = await db.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "key-1",
      providerSpecificData: { prefix: "amd-cn", baseUrl: node.baseUrl, thinkingParam: "reasoning_effort" },
    });
    const { PUT } = await import("../../src/app/api/provider-nodes/[id]/route.js");

    const res = await PUT(new Request(`http://localhost/api/provider-nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: node.name,
        prefix: node.prefix,
        apiType: "responses",
        baseUrl: node.baseUrl,
      }),
    }), { params: Promise.resolve({ id: node.id }) });
    expect(res.status).toBe(200);
    expect((await db.getProviderNodeById(node.id)).thinkingParam).toBeUndefined();
    expect((await db.getProviderConnectionById(conn.id)).providerSpecificData.thinkingParam).toBeUndefined();
  });

  it("clears the value through the real type-conversion route", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await makeNode(db, { thinkingParam: "reasoning_effort" });
    const conn = await db.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "key-1",
      providerSpecificData: { prefix: "amd-cn", baseUrl: node.baseUrl, thinkingParam: "reasoning_effort" },
    });
    const { PUT } = await import("../../src/app/api/provider-nodes/[id]/route.js");

    const res = await PUT(new Request(`http://localhost/api/provider-nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: node.name,
        prefix: node.prefix,
        baseUrl: "https://api.anthropic.com/v1",
        type: "anthropic-compatible",
      }),
    }), { params: Promise.resolve({ id: node.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.converted).toBe(true);
    expect(body.node.thinkingParam).toBeUndefined();
    expect((await db.getProviderConnectionById(conn.id)).providerSpecificData.thinkingParam).toBeUndefined();
  });

  it("copies the node value to a new connection", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await makeNode(db, { thinkingParam: "reasoning_effort" });
    const { POST } = await import("../../src/app/api/providers/route.js");

    const res = await POST(new Request("http://localhost/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: node.id, apiKey: "sk-test", name: "key-1" }),
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.connection.providerSpecificData.thinkingParam).toBe("reasoning_effort");
  });
});
