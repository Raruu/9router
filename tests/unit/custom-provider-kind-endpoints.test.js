// Custom provider per-kind endpoints (kindBaseUrls).
//
// A custom OpenAI-compatible node can host media on a different origin than
// chat (nararouter: chat/embeddings/systemone on router.bynara.id/v1, images +
// videos on api-images.bynara.id/v1). These tests cover the four layers:
//  - open-sse/config/kindEndpoints.js sanitize + URL resolution
//  - nodesRepo persistence (create/update/convert) and connection push-down
//  - per-kind runtime adapters (image, tts, stt, embedding, video, systemone)
//  - video's collection-root → /generations fallback on 404/405 only
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  COMPAT_KIND_ENDPOINTS,
  COMPAT_KIND_IDS,
  isCompatNodeProvider,
  sanitizeKindBaseUrl,
  sanitizeKindBaseUrls,
  resolveCompatKindBaseUrl,
  buildCompatKindUrl,
} from "../../open-sse/config/kindEndpoints.js";
// Static imports: imageGenerationCore pulls in proxyFetch, which patches
// global.fetch at module load — the mock must be installed after that happens
// (the beforeEach below), not before a dynamic import.
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";

const originalFetch = global.fetch;

const LLM_HOST = "https://router.bynara.id/v1";
const MEDIA_HOST = "https://api-images.bynara.id/v1";

const compatCreds = (overrides = {}) => ({
  apiKey: "test-key",
  providerSpecificData: {
    prefix: "nr",
    baseUrl: LLM_HOST,
    kindBaseUrls: { image: MEDIA_HOST, video: MEDIA_HOST },
    ...overrides,
  },
});

describe("kindEndpoints config", () => {
  it("maps the six custom node kinds to their canonical paths", () => {
    expect(COMPAT_KIND_ENDPOINTS).toEqual({
      embedding: "/embeddings",
      image: "/images/generations",
      tts: "/audio/speech",
      stt: "/audio/transcriptions",
      video: "/videos",
      systemone: "/systemone",
    });
    expect(COMPAT_KIND_IDS).toEqual(["embedding", "image", "tts", "stt", "video", "systemone"]);
  });

  it("detects compat node providers by id prefix", () => {
    expect(isCompatNodeProvider("openai-compatible-chat-abc")).toBe(true);
    expect(isCompatNodeProvider("openai")).toBe(false);
    expect(isCompatNodeProvider(null)).toBe(false);
  });

  it("strips trailing slashes and a pasted full endpoint path", () => {
    expect(sanitizeKindBaseUrl("image", " https://x.test/v1/ ")).toBe("https://x.test/v1");
    expect(sanitizeKindBaseUrl("image", "https://x.test/v1/images/generations")).toBe("https://x.test/v1");
    expect(sanitizeKindBaseUrl("tts", "https://x.test/v1/audio/speech/")).toBe("https://x.test/v1");
    expect(sanitizeKindBaseUrl("video", "https://x.test/v1/videos")).toBe("https://x.test/v1");
  });

  it("drops unknown kinds and empty values", () => {
    expect(sanitizeKindBaseUrls({ image: MEDIA_HOST, music: "https://nope", video: "  " })).toEqual({ image: MEDIA_HOST });
    expect(sanitizeKindBaseUrls(null)).toEqual({});
    expect(sanitizeKindBaseUrls(["image"])).toEqual({});
  });

  it("resolves kindBaseUrls first, main baseUrl second, fallback last", () => {
    const creds = compatCreds();
    expect(resolveCompatKindBaseUrl(creds, "image")).toBe(MEDIA_HOST);
    expect(resolveCompatKindBaseUrl(creds, "tts")).toBe(LLM_HOST);
    expect(resolveCompatKindBaseUrl({ providerSpecificData: {} }, "image")).toBe("");
    expect(resolveCompatKindBaseUrl({ providerSpecificData: {} }, "image", { fallback: "https://api.openai.com/v1/" })).toBe("https://api.openai.com/v1");
  });

  it("builds full URLs for the nararouter split", () => {
    const creds = compatCreds();
    expect(buildCompatKindUrl(creds, "image")).toBe(`${MEDIA_HOST}/images/generations`);
    expect(buildCompatKindUrl(creds, "video")).toBe(`${MEDIA_HOST}/videos`);
    expect(buildCompatKindUrl(creds, "systemone")).toBe(`${LLM_HOST}/systemone`);
    expect(buildCompatKindUrl({ providerSpecificData: {} }, "tts")).toBe("");
  });
});

// ── Persistence + API layers ────────────────────────────────────────────────
const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setupDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-kind-endpoints-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("../../src/lib/modelCatalog/runtime.js", () => ({
    refreshModelCatalogRuntime: vi.fn(async () => null),
  }));
  return import("../../src/lib/db/index.js");
}

describe("nodesRepo kindBaseUrls", () => {
  beforeEach(async () => { await setupDb(); });

  afterEach(() => {
    vi.doUnmock("../../src/lib/modelCatalog/runtime.js");
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("creates a node with sanitized per-kind URLs", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await db.createProviderNode({
      id: "openai-compatible-chat-k1",
      type: "openai-compatible",
      name: "Nara",
      prefix: "nr",
      apiType: "chat",
      baseUrl: LLM_HOST,
      kindBaseUrls: { image: `${MEDIA_HOST}/images/generations`, video: MEDIA_HOST, bogus: "https://nope" },
    });
    expect(node.kindBaseUrls).toEqual({ image: MEDIA_HOST, video: MEDIA_HOST });

    const stored = await db.getProviderNodeById(node.id);
    expect(stored.kindBaseUrls).toEqual({ image: MEDIA_HOST, video: MEDIA_HOST });
  });

  it("omits kindBaseUrls entirely when nothing valid is given", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await db.createProviderNode({
      id: "openai-compatible-chat-k2",
      type: "openai-compatible",
      name: "Plain",
      prefix: "pl",
      apiType: "chat",
      baseUrl: LLM_HOST,
      kindBaseUrls: {},
    });
    expect(node.kindBaseUrls).toBeUndefined();
  });

  it("keeps stored overrides when an update omits the field, clears on empty map", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    await db.createProviderNode({
      id: "openai-compatible-chat-k3",
      type: "openai-compatible",
      name: "Nara",
      prefix: "nr",
      apiType: "chat",
      baseUrl: LLM_HOST,
      kindBaseUrls: { image: MEDIA_HOST },
    });

    const renamed = await db.updateProviderNode("openai-compatible-chat-k3", { name: "Renamed" });
    expect(renamed.kindBaseUrls).toEqual({ image: MEDIA_HOST });

    const cleared = await db.updateProviderNode("openai-compatible-chat-k3", { kindBaseUrls: {} });
    expect(cleared.kindBaseUrls).toBeUndefined();

    const restored = await db.updateProviderNode("openai-compatible-chat-k3", { kindBaseUrls: { video: MEDIA_HOST } });
    expect(restored.kindBaseUrls).toEqual({ video: MEDIA_HOST });
  });

  it("carries overrides to the converted node and its connections", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const node = await db.createProviderNode({
      id: "openai-compatible-chat-k4",
      type: "openai-compatible",
      name: "Nara",
      prefix: "nr",
      apiType: "chat",
      baseUrl: LLM_HOST,
      kindBaseUrls: { image: MEDIA_HOST },
    });
    await db.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "key-1",
      providerSpecificData: { prefix: "nr", apiType: "chat", baseUrl: LLM_HOST, kindBaseUrls: { image: MEDIA_HOST } },
    });

    const converted = await db.convertProviderNodeType(node.id, {
      type: "anthropic-compatible",
      name: "Nara",
      prefix: "nr",
      baseUrl: "https://api.anthropic.com/v1",
    });
    expect(converted.kindBaseUrls).toEqual({ image: MEDIA_HOST });

    const connections = await db.getProviderConnections({ provider: converted.id });
    expect(connections[0].providerSpecificData.kindBaseUrls).toEqual({ image: MEDIA_HOST });
  });
});

describe("connection push-down (POST /api/providers)", () => {
  beforeEach(async () => { await setupDb(); });

  afterEach(() => {
    vi.doUnmock("../../src/lib/modelCatalog/runtime.js");
    vi.doUnmock("next/server");
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("copies the node's per-kind URLs onto a new connection", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json" } });
        },
      },
    }));
    const { POST } = await import("../../src/app/api/providers/route.js");
    const node = await db.createProviderNode({
      id: "openai-compatible-chat-k5",
      type: "openai-compatible",
      name: "Nara",
      prefix: "nr",
      apiType: "chat",
      baseUrl: LLM_HOST,
      kindBaseUrls: { image: MEDIA_HOST, video: MEDIA_HOST },
    });

    const res = await POST(new Request("https://9router.local/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: node.id, apiKey: "k", name: "key-1" }),
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.connection.providerSpecificData.kindBaseUrls).toEqual({ image: MEDIA_HOST, video: MEDIA_HOST });
  });
});

// ── Runtime adapters ────────────────────────────────────────────────────────
describe("runtime adapters", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("image: builds {kindBaseUrls.image}/images/generations", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ created: 1, data: [{ url: "https://img.test/a.png" }] }), { headers: { "Content-Type": "application/json" } }));

    const result = await handleImageGenerationCore({
      body: { model: "img-model", prompt: "a cat" },
      modelInfo: { provider: "openai-compatible-chat-k6", model: "img-model" },
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${MEDIA_HOST}/images/generations`);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
  });

  it("image: falls back to the main baseUrl when no image override is set", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ created: 1, data: [{ url: "https://img.test/a.png" }] }), { headers: { "Content-Type": "application/json" } }));

    await handleImageGenerationCore({
      body: { model: "img-model", prompt: "a cat" },
      modelInfo: { provider: "openai-compatible-chat-k6", model: "img-model" },
      credentials: compatCreds({ kindBaseUrls: {} }),
      log: null,
    });

    expect(global.fetch.mock.calls[0][0]).toBe(`${LLM_HOST}/images/generations`);
  });

  it("tts: posts to {kindBaseUrls.tts or main}/audio/speech", async () => {
    const audio = new Uint8Array(200).fill(1);
    global.fetch.mockResolvedValueOnce(new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }));

    const result = await handleTtsCore({
      provider: "openai-compatible-chat-k7",
      model: "tts-1/alloy",
      input: "hello",
      credentials: compatCreds(),
      responseFormat: "mp3",
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${LLM_HOST}/audio/speech`);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "tts-1", voice: "alloy", input: "hello" });
  });

  it("tts: honors a per-kind TTS host", async () => {
    const audio = new Uint8Array(200).fill(1);
    global.fetch.mockResolvedValueOnce(new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }));

    await handleTtsCore({
      provider: "openai-compatible-chat-k7",
      model: "tts-1",
      input: "hello",
      credentials: compatCreds({ kindBaseUrls: { tts: "https://tts.example.com/v1" } }),
      responseFormat: "mp3",
    });

    expect(global.fetch.mock.calls[0][0]).toBe("https://tts.example.com/v1/audio/speech");
  });

  it("embedding: prefers kindBaseUrls.embedding over the main baseUrl", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 3, total_tokens: 3 } }), { headers: { "Content-Type": "application/json" } }));

    const result = await handleEmbeddingsCore({
      body: { model: "embed-x", input: "hi" },
      modelInfo: { provider: "openai-compatible-chat-k8", model: "embed-x" },
      credentials: compatCreds({ kindBaseUrls: { embedding: "https://embed.example.com/v1" } }),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("https://embed.example.com/v1/embeddings");
  });

  it("stt: sends multipart to {kindBaseUrls.stt or main}/audio/transcriptions", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: "ok" }), { headers: { "Content-Type": "application/json" } }));

    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(64)], "a.wav", { type: "audio/wav" }));
    formData.append("model", "whisper-1");

    const result = await handleSttCore({
      provider: "openai-compatible-chat-k9",
      model: "whisper-1",
      formData,
      credentials: compatCreds(),
      sttConfig: { baseUrl: `${LLM_HOST}/audio/transcriptions`, authType: "apikey", authHeader: "bearer", format: "openai" },
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${LLM_HOST}/audio/transcriptions`);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
  });

  it("stt: a selfhosted-stt connection baseUrl stays a full endpoint (not double-appended)", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: "ok" }), { headers: { "Content-Type": "application/json" } }));

    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(64)], "a.wav", { type: "audio/wav" }));
    formData.append("model", "whisper-1");

    await handleSttCore({
      provider: "selfhosted-stt",
      model: "whisper-1",
      formData,
      credentials: { apiKey: "k", providerSpecificData: { baseUrl: "http://localhost:8080/v1/audio/transcriptions" } },
      sttConfig: { baseUrl: "http://localhost:8080/v1/audio/transcriptions", authType: "apikey", authHeader: "bearer", format: "openai" },
    });

    expect(global.fetch.mock.calls[0][0]).toBe("http://localhost:8080/v1/audio/transcriptions");
  });

  it("systemone: posts to {kindBaseUrls.systemone or main}/systemone", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ answers: {} }), { headers: { "Content-Type": "application/json" } }));

    const result = await handleSystemoneCore({
      body: { model: "jev", state: "s", questions: { q: { type: "noul" } } },
      modelInfo: { provider: "openai-compatible-chat-k10", model: "jev" },
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${LLM_HOST}/systemone`);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
  });
});

// ── Video adapter + fallback ────────────────────────────────────────────────
describe("video compat adapter", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("creates at the collection root and polls {base}/videos/{id}", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "pending" }, 202));

    const result = await handleVideoProxyCore({
      provider: "openai-compatible-chat-k11",
      action: "generations",
      rawBody: '{"model":"v-model","prompt":"x"}',
      contentType: "application/json",
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${MEDIA_HOST}/videos`);
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");

    global.fetch.mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "succeeded", url: "https://cdn/v.mp4" }));
    const poll = await handleVideoProxyCore({
      provider: "openai-compatible-chat-k11",
      requestId: "job-1",
      credentials: compatCreds(),
      log: null,
    });
    expect(poll.success).toBe(true);
    expect(global.fetch.mock.calls[1][0]).toBe(`${MEDIA_HOST}/videos/job-1`);
    expect(global.fetch.mock.calls[1][1].method).toBe("GET");
  });

  it("falls back to /videos/generations on 404 without losing the body", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ id: "job-2", status: "pending" }, 202));

    const raw = '{"model":"v-model","prompt":"x"}';
    const result = await handleVideoProxyCore({
      provider: "openai-compatible-chat-k11",
      action: "generations",
      rawBody: raw,
      contentType: "application/json",
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${MEDIA_HOST}/videos`);
    expect(global.fetch.mock.calls[1][0]).toBe(`${MEDIA_HOST}/videos/generations`);
    expect(global.fetch.mock.calls[1][1].body).toBe(raw);
    expect(await result.response.json()).toEqual({ id: "job-2", status: "pending" });
  });

  it("falls back on 405 too", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ error: "method not allowed" }, 405))
      .mockResolvedValueOnce(jsonResponse({ id: "job-3", status: "pending" }, 202));

    const result = await handleVideoProxyCore({
      provider: "openai-compatible-chat-k11",
      action: "generations",
      rawBody: "{}",
      contentType: "application/json",
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe(`${MEDIA_HOST}/videos/generations`);
  });

  it("never re-sends on a 5xx (the job may exist)", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await handleVideoProxyCore({
      provider: "openai-compatible-chat-k11",
      action: "generations",
      rawBody: "{}",
      contentType: "application/json",
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects edits/extensions (nararouter-style roots have no such endpoints)", async () => {
    const result = await handleVideoProxyCore({
      provider: "openai-compatible-chat-k11",
      action: "edits",
      rawBody: "{}",
      contentType: "application/json",
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("generations");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
