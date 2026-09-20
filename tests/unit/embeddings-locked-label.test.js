import { beforeEach, describe, expect, it, vi } from "vitest";

// Representative non-chat handler: verifies the all-locked tag and the
// no-credentials message both use the connection prefix, mirroring
// chat-locked-account-label.test.js for the chat path.

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  resolveProviderDisplayLabel: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  resolveProviderDisplayLabel: mocks.resolveProviderDisplayLabel,
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  warn: mocks.warn,
  error: mocks.error,
  info: vi.fn(),
  maskKey: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: vi.fn() }));

const { handleEmbeddings } = await import("../../src/sse/handlers/embeddings.js");

const GENERATED_ID = "anthropic-compatible-21e3714a-fa4b-4f78-8685-b113805ded1e";

function embeddingRequest() {
  return new Request("http://localhost/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: `${GENERATED_ID}/kimi-k3`, input: "hi" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.extractApiKey.mockReturnValue(null);
  mocks.getModelInfo.mockResolvedValue({ provider: GENERATED_ID, model: "kimi-k3" });
});

describe("embeddings locked-account label", () => {
  it("shows the prefix in the log and the client error", async () => {
    mocks.getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 11000).toISOString(),
      retryAfterHuman: "reset after 11s",
      lastError: "[522]: HTTP 522",
      lastErrorCode: 522,
      providerSpecificData: { prefix: "hcnsec" },
    });

    const res = await handleEmbeddings(embeddingRequest());
    const body = await res.json();

    expect(body.error.message).toContain("[hcnsec/kimi-k3]");
    expect(body.error.message).not.toContain("anthropic-compatible-21e3714a");
    expect(mocks.warn).toHaveBeenCalledWith("EMBEDDINGS", expect.stringContaining("[hcnsec/kimi-k3]"));
  });

  it("labels the no-credentials error through the resolver", async () => {
    mocks.getProviderCredentials.mockResolvedValue(null);
    mocks.resolveProviderDisplayLabel.mockResolvedValue("hcnsec");

    const res = await handleEmbeddings(embeddingRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("No credentials for provider: hcnsec");
    expect(mocks.resolveProviderDisplayLabel).toHaveBeenCalledWith(GENERATED_ID);
  });
});
