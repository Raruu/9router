import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
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
  warn: mocks.warn,
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

const { handleChat } = await import("../../src/sse/handlers/chat.js");

const GENERATED_ID = "anthropic-compatible-21e3714a-fa4b-4f78-8685-b113805ded1e";

function chatRequest() {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: `${GENERATED_ID}/kimi-k3`, messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("locked-account error label", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.extractApiKey.mockReturnValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: GENERATED_ID, model: "kimi-k3" });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 11000).toISOString(),
      retryAfterHuman: "reset after 11s",
      lastError: "[522]: HTTP 522",
      lastErrorCode: 522,
      providerSpecificData: { prefix: "hcnsec" },
    });
  });

  it("shows the connection prefix instead of the generated provider id", async () => {
    const res = await handleChat(chatRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.message).toContain("[hcnsec/kimi-k3]");
    expect(body.error.message).not.toContain("anthropic-compatible-21e3714a");
    expect(mocks.warn).toHaveBeenCalledWith("CHAT", expect.stringContaining("[hcnsec/kimi-k3]"));
  });

  it("falls back to the provider id when the connection has no prefix", async () => {
    mocks.getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 11000).toISOString(),
      retryAfterHuman: "reset after 11s",
      lastError: "[522]: HTTP 522",
      lastErrorCode: 522,
      providerSpecificData: {},
    });

    const res = await handleChat(chatRequest());
    const body = await res.json();

    expect(body.error.message).toContain(`[${GENERATED_ID}/kimi-k3]`);
  });
});
