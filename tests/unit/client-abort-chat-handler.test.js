// End-to-end (handler-level) client cancellation: an aborted request must not
// rotate accounts or advance combo members, and must never write an account lock.
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  handleAntigravityQuotaError: vi.fn(),
  clearAntigravityStrikes: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  resolveProviderDisplayLabel: vi.fn(async (provider) => provider),
  validateApiKeyWithRules: vi.fn(async () => ({ valid: true })),
}));

vi.mock("../../src/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: mocks.handleAntigravityQuotaError,
  clearAntigravityStrikes: mocks.clearAntigravityStrikes,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(async () => []),
  getProviderNodes: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(),
}));

vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://localhost/compress" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: async () => null }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function chatRequest(model, signal) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
    ...(signal ? { signal } : {}),
  });
}

function cred(connectionId) {
  return {
    connectionId,
    connectionName: connectionId,
    authType: "apikey",
    apiKey: "sk-x",
    providerSpecificData: {},
  };
}

function failure(status = 503) {
  return {
    success: false,
    status,
    error: `[${status}]: boom`,
    retrySignal: { providerId: "p1", status, retryAfterMs: 0 },
    response: new Response(JSON.stringify({ error: { message: "boom" } }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractApiKey.mockReturnValue(null);
  mocks.getSettings.mockResolvedValue({ requireApiKey: false, comboStrategy: "fallback" });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0 });
  mocks.getModelInfo.mockImplementation(async (modelStr) => {
    const [provider, model] = String(modelStr).split("/");
    return provider && model ? { provider, model } : { provider: null, model: null };
  });
  mocks.getComboModels.mockResolvedValue(null);
});

describe("handleChat — client abort", () => {
  it("returns 499 immediately when the request is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    const response = await handleChat(chatRequest("p1/a", ac.signal));
    const body = await response.json();

    expect(response.status).toBe(499);
    expect(body.error.message).toBe("Request aborted");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("stops the account loop when the client aborts during an attempt", async () => {
    const ac = new AbortController();
    let credentialCalls = 0;
    mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
      credentialCalls += 1;
      if (credentialCalls > 3) return null;
      return exclude.has("conn-1") ? cred("conn-2") : cred("conn-1");
    });
    mocks.handleChatCore.mockImplementation(async () => {
      ac.abort();
      return failure(503);
    });

    const response = await handleChat(chatRequest("p1/a", ac.signal));

    expect(response.status).toBe(499);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    // Without the abort guard this would have locked conn-1 and tried conn-2.
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(credentialCalls).toBe(1);
  });

  it("does not advance to the next combo member after an abort", async () => {
    const ac = new AbortController();
    const members = [];

    mocks.getModelInfo.mockImplementation(async (modelStr) => (
      modelStr === "combo-abort"
        ? { provider: null, model: null }
        : { provider: "p1", model: String(modelStr).split("/")[1] }
    ));
    mocks.getComboModels.mockImplementation(async (modelStr) => (
      modelStr === "combo-abort" ? ["p1/a", "p2/b"] : null
    ));
    mocks.getProviderCredentials.mockResolvedValue(cred("conn-1"));
    mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => {
      members.push(`${modelInfo.provider}/${modelInfo.model}`);
      ac.abort();
      return failure(503);
    });

    const response = await handleChat(chatRequest("combo-abort", ac.signal));

    expect(response.status).toBe(499);
    expect(members).toEqual(["p1/a"]);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});

// A real client "gone" event is a socket close, not an explicit AbortController.
// Next 16 derives the route handler's request.signal from the Node response:
// `signalFromNodeResponse` aborts on 'close' unless the response already
// finished. These cases pin that contract and prove handleChat reacts to it.
describe("Next request.signal contract (client disconnect)", () => {
  const loadSignalHelper = () => import(
    "next/dist/server/web/spec-extension/adapters/next-request.js"
  );

  function fakeNodeResponse({ writableFinished = false, destroyed = false, errored = null } = {}) {
    const res = new EventEmitter();
    res.writableFinished = writableFinished;
    res.destroyed = destroyed;
    res.errored = errored;
    return res;
  }

  it("aborts the signal when the socket closes before the response finished", async () => {
    const { signalFromNodeResponse } = await loadSignalHelper();
    const res = fakeNodeResponse({ writableFinished: false });
    const signal = signalFromNodeResponse(res);

    expect(signal.aborted).toBe(false);
    res.emit("close");
    expect(signal.aborted).toBe(true);
  });

  it("does not abort after a normally finished response", async () => {
    const { signalFromNodeResponse } = await loadSignalHelper();
    const res = fakeNodeResponse({ writableFinished: true });
    const signal = signalFromNodeResponse(res);

    res.emit("close");
    expect(signal.aborted).toBe(false);
  });

  it("starts aborted when the connection was already torn down", async () => {
    const { signalFromNodeResponse } = await loadSignalHelper();
    expect(signalFromNodeResponse(fakeNodeResponse({ destroyed: true })).aborted).toBe(true);
    expect(signalFromNodeResponse(fakeNodeResponse({ errored: new Error("EPIPE") })).aborted).toBe(true);
  });

  it("handleChat unwinds with 499 when the client disconnects mid-attempt", async () => {
    const { signalFromNodeResponse } = await loadSignalHelper();
    const res = fakeNodeResponse();
    const signal = signalFromNodeResponse(res);

    let credentialCalls = 0;
    mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
      credentialCalls += 1;
      if (credentialCalls > 3) return null;
      return exclude.has("conn-1") ? cred("conn-2") : cred("conn-1");
    });
    mocks.handleChatCore.mockImplementation(async () => {
      // The client vanishes while the upstream call is in flight.
      res.emit("close");
      return failure(503);
    });

    const response = await handleChat(chatRequest("p1/a", signal));

    expect(response.status).toBe(499);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(credentialCalls).toBe(1);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
