// Client cancellation at the transport/core layer: a scheduled retry must not
// wake up and dial upstream again, and handleChatCore must hand an aborting
// signal to the executor and unwind with 499.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status) {
  return { status, headers: { get: () => "" } };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("BaseExecutor.execute — abort during a retry wait", () => {
  it("rejects with AbortError instead of retrying after the client aborts", async () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController();
      const executor = new BaseExecutor("test", {
        baseUrl: "https://x/api",
        retry: { 502: { attempts: 3, delayMs: 5000 } },
      });
      fetchMock.mockResolvedValue(res(502));

      const pending = executor.execute({
        model: "m",
        body: {},
        stream: false,
        credentials: { apiKey: "k" },
        signal: ac.signal,
      });
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });

      // First attempt answered 502; the retry is now sleeping.
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      ac.abort();
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still retries normally when the signal is live", async () => {
    const ac = new AbortController();
    const executor = new BaseExecutor("test", {
      baseUrl: "https://x/api",
      retry: { 502: { attempts: 2, delayMs: 0 } },
    });
    fetchMock.mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200));

    const out = await executor.execute({
      model: "m",
      body: {},
      stream: false,
      credentials: { apiKey: "k" },
      signal: ac.signal,
    });

    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── handleChatCore ─────────────────────────────────────────────────────────

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

function callCore(signal) {
  return handleChatCore({
    body: {
      model: "antigravity/claude-sonnet-4-6",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    },
    modelInfo: { provider: "antigravity", model: "claude-sonnet-4-6" },
    credentials: { accessToken: "tok", projectId: "project-1", connectionId: "conn-1", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() },
    connectionId: "conn-1",
    rtkEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
    sourceFormatOverride: "openai",
    signal,
  });
}

function okResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("handleChatCore — client abort", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it("returns 499 without calling the executor when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    const result = await callCore(ac.signal);

    expect(result.status).toBe(499);
    expect(result.error).toContain("Request aborted");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("aborts the in-flight upstream call and unwinds with 499", async () => {
    const ac = new AbortController();
    let executorSignal = null;

    executeMock.mockImplementation(({ signal }) => {
      executorSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        }, { once: true });
      });
    });

    const pending = callCore(ac.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    ac.abort();
    const result = await pending;

    expect(executorSignal).not.toBeNull();
    expect(executorSignal.aborted).toBe(true);
    expect(result.status).toBe(499);
  });

  it("behaves normally when the signal is never aborted", async () => {
    const ac = new AbortController();
    executeMock.mockResolvedValue({
      response: okResponse(),
      url: "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent",
      headers: {},
      transformedBody: null,
    });

    const result = await callCore(ac.signal);

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
