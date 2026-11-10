// Antigravity admission rejections must steer the account loop to another
// connection without persisting a quota/account lock.
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

function chatRequest() {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "antigravity/claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

function cred(connectionId) {
  return {
    connectionId,
    connectionName: connectionId,
    authType: "oauth",
    accessToken: "tok",
    projectId: "project-1",
    providerSpecificData: {},
  };
}

function okResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function admissionFailure(status, kind, message) {
  return {
    success: false,
    status,
    error: `[${status}]: ${message}`,
    admission: kind,
    response: new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { "content-type": "application/json", "retry-after": "1" },
    }),
  };
}

/** Return the first pool entry not excluded yet — bounded, so a bug cannot loop. */
function poolCredentials(pool) {
  return async (_provider, exclude) => {
    const next = pool.find((id) => !exclude.has(id));
    return next ? cred(next) : null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractApiKey.mockReturnValue(null);
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model: "claude-sonnet-4-6" });
  mocks.getComboModels.mockResolvedValue(null);
});

describe("handleChat — admission rejections rotate accounts", () => {
  it("tries the next connection and never persists the refusal", async () => {
    mocks.getProviderCredentials.mockImplementation(poolCredentials(["conn-1", "conn-2"]));
    mocks.handleChatCore.mockImplementation(async ({ credentials }) => (
      credentials.connectionId === "conn-2"
        ? { success: true, response: okResponse() }
        : admissionFailure(429, "connection_limit", "connection concurrency limit reached (limit 3)")
    ));

    const response = await handleChat(chatRequest());

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.handleAntigravityQuotaError).not.toHaveBeenCalled();
  });

  it("returns the local 503 when the breaker has no other connection to use", async () => {
    mocks.getProviderCredentials.mockImplementation(poolCredentials(["conn-1"]));
    mocks.handleChatCore.mockResolvedValue(
      admissionFailure(503, "circuit_breaker_open", "antigravity circuit breaker open for connection conn-1"),
    );

    const response = await handleChat(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).toContain("circuit breaker open");
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.handleAntigravityQuotaError).not.toHaveBeenCalled();
  });
});
