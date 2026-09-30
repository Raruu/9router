// /v1/systemone must enforce per-key model whitelists like every other
// handler. It used to call isValidApiKey only, so a key restricted to chat
// models could still spend System One requests.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateApiKeyWithRules: vi.fn(),
  extractApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleSystemoneCore: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: mocks.extractApiKey,
  validateApiKeyWithRules: mocks.validateApiKeyWithRules,
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  warn: mocks.warn,
  error: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({ handleSystemoneCore: mocks.handleSystemoneCore }));

const { handleSystemone } = await import("../../src/sse/handlers/systemone.js");

const MODEL = "opencode-zen/jev-1.13";

function systemoneRequest(headers = {}) {
  return new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model: MODEL, state: "s", questions: { q: { type: "noul" } } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractApiKey.mockReturnValue("sk-test");
  mocks.getSettings.mockResolvedValue({ requireApiKey: true });
  mocks.getModelInfo.mockResolvedValue({ provider: "opencode-zen", model: "jev-1.13" });
  mocks.getProviderCredentials.mockResolvedValue({
    connectionId: "conn-1",
    connectionName: "test",
    apiKey: "upstream-key",
    providerSpecificData: {},
  });
});

describe("systemone per-key model access", () => {
  it("rejects a model outside the key's whitelist with 403 before any routing", async () => {
    mocks.validateApiKeyWithRules.mockResolvedValue({
      valid: false,
      status: 403,
      error: `Model '${MODEL}' is not allowed for this API key`,
    });

    const res = await handleSystemone(systemoneRequest({ Authorization: "Bearer sk-test" }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.message).toContain("not allowed for this API key");
    expect(mocks.validateApiKeyWithRules).toHaveBeenCalledWith("sk-test", MODEL);
    // Never reached provider routing.
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
  });

  it("relays a 429 when the key is over its usage limit", async () => {
    mocks.validateApiKeyWithRules.mockResolvedValue({ valid: false, status: 429, error: "Token limit exceeded" });

    const res = await handleSystemone(systemoneRequest({ Authorization: "Bearer sk-test" }));
    expect(res.status).toBe(429);
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
  });

  it("routes normally when the key allows the model", async () => {
    mocks.validateApiKeyWithRules.mockResolvedValue({ valid: true, keyRecord: { id: "key-1" } });
    mocks.handleSystemoneCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ answers: {} }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    const res = await handleSystemone(systemoneRequest({ Authorization: "Bearer sk-test" }));
    expect(res.status).toBe(200);
    expect(mocks.validateApiKeyWithRules).toHaveBeenCalledWith("sk-test", MODEL);
    expect(mocks.handleSystemoneCore).toHaveBeenCalledTimes(1);
  });

  it("still requires a key when requireApiKey is on and none is presented", async () => {
    mocks.extractApiKey.mockReturnValue(null);
    const res = await handleSystemone(systemoneRequest());
    expect(res.status).toBe(401);
    expect(mocks.validateApiKeyWithRules).not.toHaveBeenCalled();
  });

  it("skips validation entirely when no key is presented and keys are optional", async () => {
    mocks.extractApiKey.mockReturnValue(null);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.handleSystemoneCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ answers: {} }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    const res = await handleSystemone(systemoneRequest());
    expect(res.status).toBe(200);
    expect(mocks.validateApiKeyWithRules).not.toHaveBeenCalled();
  });
});
