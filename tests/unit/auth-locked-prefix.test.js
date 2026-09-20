import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials, resolveProviderDisplayLabel } = await import("../../src/sse/services/auth.js");

const PROVIDER = "anthropic-compatible-21e3714a-fa4b-4f78-8685-b113805ded1e";
const MODEL = "kimi-k3";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("getProviderCredentials all-locked return", () => {
  it("carries the connection prefix so callers can label the provider", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "conn-a",
      provider: PROVIDER,
      isActive: true,
      providerSpecificData: { prefix: "hcnsec" },
      "modelLock_kimi-k3": new Date(Date.now() + 11000).toISOString(),
      lastError: "[522]: HTTP 522",
      errorCode: 522,
    }]);

    await expect(getProviderCredentials(PROVIDER, null, MODEL)).resolves.toMatchObject({
      allRateLimited: true,
      providerSpecificData: { prefix: "hcnsec" },
    });
  });

  it("omits the prefix when the connection has none", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "conn-b",
      provider: PROVIDER,
      isActive: true,
      "modelLock_kimi-k3": new Date(Date.now() + 11000).toISOString(),
    }]);

    const result = await getProviderCredentials(PROVIDER, null, MODEL);
    expect(result.allRateLimited).toBe(true);
    expect(result.providerSpecificData).toEqual({ prefix: undefined });
  });
});

describe("resolveProviderDisplayLabel", () => {
  it("prefers the prefix already in hand and skips the lookup", async () => {
    await expect(resolveProviderDisplayLabel(PROVIDER, { prefix: "hcnsec" })).resolves.toBe("hcnsec");
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("falls back to the first connection prefix when credentials are absent", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-a", providerSpecificData: {} },
      { id: "conn-b", providerSpecificData: { prefix: "hcnsec" } },
    ]);

    await expect(resolveProviderDisplayLabel(PROVIDER)).resolves.toBe("hcnsec");
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: PROVIDER });
  });

  it("returns the provider id when no connection carries a prefix", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    await expect(resolveProviderDisplayLabel(PROVIDER)).resolves.toBe(PROVIDER);
  });

  it("returns the provider id when the lookup throws", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("db down"));
    await expect(resolveProviderDisplayLabel(PROVIDER)).resolves.toBe(PROVIDER);
  });
});
