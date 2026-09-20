import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Per-key combo retry mode: each key gets its own extra attempts before the
// account loop rotates; once every key is exhausted the combo advances without
// a member-level retry.

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
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  resolveProviderDisplayLabel: vi.fn(async (provider) => provider),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

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

function chatRequest(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });
}

const cred = (connectionId) => ({
  connectionId,
  connectionName: connectionId,
  apiKey: "sk-x",
  authType: "apikey",
  providerSpecificData: {},
});

const allLocked = () => ({
  allRateLimited: true,
  retryAfter: new Date(Date.now() + 11000).toISOString(),
  retryAfterHuman: "reset after 11s",
  lastError: "[429]: rate limited",
  lastErrorCode: 429,
  providerSpecificData: {},
});

const fail429 = () => ({
  success: false,
  status: 429,
  error: "rate limited",
  response: new Response(JSON.stringify({ error: { message: "rate limited" } }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  }),
});

const okResponse = () => new Response(
  JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractApiKey.mockReturnValue(null);
  mocks.getSettings.mockResolvedValue({ requireApiKey: false, comboStrategy: "fallback" });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 1000 });
  mocks.getModelInfo.mockImplementation(async (modelStr) => {
    const [provider, model] = String(modelStr).split("/");
    return provider && model ? { provider, model } : { provider: null, model: null };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("per-key combo retries", () => {
  it("retries the same key in place, then rotates to the next key", async () => {
    vi.useFakeTimers();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      providerRetries: { p1: { enabled: true, tries: 2, maxBackoffSeconds: 16, mode: "per-key" } },
    });
    mocks.getComboModels.mockResolvedValue(["p1/m1"]);

    let credentialCalls = 0;
    mocks.getProviderCredentials.mockImplementation(async (provider) => {
      if (provider !== "p1") return null;
      credentialCalls += 1;
      if (credentialCalls === 1) return cred("conn-1");
      if (credentialCalls === 2) return cred("conn-2");
      return allLocked();
    });

    const seen = [];
    mocks.handleChatCore.mockImplementation(async ({ credentials }) => {
      seen.push(credentials.connectionId);
      return credentials.connectionId === "conn-2" ? { success: true, response: okResponse() } : fail429();
    });

    const promise = handleChat(chatRequest("combo-per-key"));
    await vi.runAllTimersAsync();
    const res = await promise;

    // tries=2 → 1 + 2 attempts on conn-1, then the next key succeeds on its first try.
    expect(res.status).toBe(200);
    expect(seen).toEqual(["conn-1", "conn-1", "conn-1", "conn-2"]);
  });

  it("advances to the next combo member once every key is exhausted", async () => {
    vi.useFakeTimers();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      providerRetries: { p1: { enabled: true, tries: 1, maxBackoffSeconds: 16, mode: "per-key" } },
    });
    mocks.getComboModels.mockResolvedValue(["p1/m1", "p2/m2"]);

    const callsPerProvider = {};
    mocks.getProviderCredentials.mockImplementation(async (provider) => {
      callsPerProvider[provider] = (callsPerProvider[provider] || 0) + 1;
      if (provider === "p1") {
        if (callsPerProvider.p1 === 1) return cred("conn-1");
        if (callsPerProvider.p1 === 2) return cred("conn-2");
        return allLocked();
      }
      return cred("conn-3");
    });

    const seen = [];
    mocks.handleChatCore.mockImplementation(async ({ credentials }) => {
      seen.push(credentials.connectionId);
      return credentials.connectionId === "conn-3" ? { success: true, response: okResponse() } : fail429();
    });

    const promise = handleChat(chatRequest("combo-per-key-exhaust"));
    await vi.runAllTimersAsync();
    const res = await promise;

    // tries=1 → 2 attempts per key; p1 never gets a member-level retry.
    expect(res.status).toBe(200);
    expect(seen).toEqual(["conn-1", "conn-1", "conn-2", "conn-2", "conn-3"]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledTimes(4);
  });

  it("does not retry the same key when the mode is member", async () => {
    vi.useFakeTimers();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      providerRetries: { p1: { enabled: true, tries: 2, maxBackoffSeconds: 16, mode: "member" } },
    });
    mocks.getComboModels.mockResolvedValue(["p1/m1"]);

    mocks.getProviderCredentials
      .mockResolvedValueOnce(cred("conn-1"))
      .mockResolvedValue(allLocked());
    mocks.handleChatCore.mockResolvedValue(fail429());

    const promise = handleChat(chatRequest("combo-member"));
    await vi.runAllTimersAsync();
    const res = await promise;

    // One try per key, then the member signal drives the combo-level retry:
    // conn-1 is never re-run in place.
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
  });
});
