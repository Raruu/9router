// A local Antigravity admission refusal must survive chatCore as a typed result
// (no upstream quota parsing, no account-lock semantics).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (mimeType, base64) => `data:${mimeType};base64,${base64}`,
  parseDataUri: (url) => {
    const match = /^data:([^;]+);base64,(.*)$/.exec(url);
    return match ? { mimeType: match[1], base64: match[2] } : null;
  },
  fetchImageAsBase64: async () => null,
}));

vi.mock("uuid", () => ({
  v4: () => "00000000-0000-4000-8000-000000000000",
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function blockedResult(status, kind, message) {
  return {
    response: new Response(JSON.stringify({ error: { message, type: kind, code: status } }), {
      status,
      headers: { "content-type": "application/json", "retry-after": "1" },
    }),
    url: "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent",
    headers: {},
    transformedBody: null,
    admission: kind,
  };
}

function callCore() {
  return handleChatCore({
    body: {
      model: "antigravity/claude-sonnet-4-6",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    },
    modelInfo: { provider: "antigravity", model: "claude-sonnet-4-6" },
    credentials: {
      accessToken: "tok",
      projectId: "project-1",
      connectionId: "conn-1",
      providerSpecificData: {},
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() },
    connectionId: "conn-1",
    rtkEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
    sourceFormatOverride: "openai",
  });
}

beforeEach(() => {
  executeMock.mockReset();
});

describe("chatCore — admission result propagation", () => {
  it("surfaces a local concurrency refusal without treating it as an upstream quota error", async () => {
    executeMock.mockResolvedValue(blockedResult(
      429,
      "connection_limit",
      "connection concurrency limit reached: connection conn-1 has 3 in-flight upstream requests (limit 3)",
    ));

    const result = await callCore();

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.admission).toBe("connection_limit");
    expect(result.error).toContain("concurrency limit reached");
    expect(result.response.headers.get("retry-after")).toBe("1");
  });

  it("keeps the breaker kind on a 503", async () => {
    executeMock.mockResolvedValue(blockedResult(
      503,
      "circuit_breaker_open",
      "antigravity circuit breaker open for connection conn-1 — retry in 30s",
    ));

    const result = await callCore();
    expect(result.status).toBe(503);
    expect(result.admission).toBe("circuit_breaker_open");
    expect(result.error).toContain("circuit breaker open");
  });
});
