import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getCombos: vi.fn(),
  getComboByName: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderConnections: vi.fn(),
  getProviderNodes: vi.fn(),
  getSettings: vi.fn(),
  getPricingForModel: vi.fn(),
  getUserPricingTables: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getCombos: mocks.getCombos,
  getComboByName: mocks.getComboByName,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getProviderConnections: mocks.getProviderConnections,
  getProviderNodes: mocks.getProviderNodes,
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/db/repos/pricingRepo.js", () => ({
  getPricingForModel: mocks.getPricingForModel,
  getUserPricingTables: mocks.getUserPricingTables,
}));

const { GET } = await import("../../src/app/api/models/detail/route.js");

const req = (query) => ({ url: `http://localhost:20128/api/models/detail?${query}` });

describe("GET /api/models/detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({ comboStrategies: {} });
    mocks.getPricingForModel.mockResolvedValue(null);
    mocks.getUserPricingTables.mockResolvedValue({});
  });

  it("requires an id or combo param", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("returns the full 15-key capability object for a model", async () => {
    const res = await GET(req("id=anthropic/claude-opus-4.6"));

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("model");
    expect(Object.keys(res.body.capabilities).sort()).toEqual([
      "audioInput",
      "audioOutput",
      "contextWindow",
      "imageOutput",
      "maxOutput",
      "pdf",
      "reasoning",
      "search",
      "thinkingCanDisable",
      "thinkingEffortSupported",
      "thinkingFormat",
      "thinkingRange",
      "tools",
      "videoInput",
      "vision",
    ]);
  });

  it("mirrors the limits under the snake_case names /v1/models uses", async () => {
    const res = await GET(req("id=anthropic/claude-opus-4.6"));

    expect(res.body.context_length).toBe(res.body.capabilities.contextWindow);
    expect(res.body.max_completion_tokens).toBe(res.body.capabilities.maxOutput);
  });

  // The capability tables are keyed by provider id while every dashboard model
  // string carries the routing alias, so the alias has to be mapped back before
  // the lookup or a provider-specific window is silently replaced by the
  // generic pattern match.
  it("resolves the routing alias to a provider id before reading capabilities", async () => {
    const viaAlias = await GET(req("id=kr/gpt-5.6-sol"));
    const viaId = await GET(req("id=kiro/gpt-5.6-sol"));

    expect(viaAlias.body.provider.id).toBe("kiro");
    expect(viaAlias.body.capabilities.contextWindow).toBe(
      viaId.body.capabilities.contextWindow,
    );
    expect(viaAlias.body.owned_by).toBe("kr");
  });

  it("maps a connection's custom prefix to its provider id", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "openai-compatible-chat", providerSpecificData: { prefix: "my-node" } },
    ]);

    const res = await GET(req("id=my-node/some-model"));

    expect(res.body.provider.id).toBe("openai-compatible-chat");
    expect(res.body.owned_by).toBe("my-node");
  });

  it("prefers the provider node's display name over the raw compat id", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "openai-compatible-chat", providerSpecificData: { prefix: "my-node" } },
    ]);
    mocks.getProviderNodes.mockResolvedValue([
      { id: "openai-compatible-chat", type: "openai-compatible", name: "My LM Studio", prefix: "my-node" },
    ]);

    const res = await GET(req("id=my-node/some-model"));

    expect(res.body.provider.id).toBe("openai-compatible-chat");
    expect(res.body.provider.name).toBe("My LM Studio");
  });

  it("falls back to the raw provider id when no node display name exists", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "openai-compatible-chat", providerSpecificData: { prefix: "my-node" } },
    ]);
    mocks.getProviderNodes.mockResolvedValue([
      { id: "openai-compatible-chat", type: "openai-compatible", name: "   " },
    ]);

    const res = await GET(req("id=my-node/some-model"));

    expect(res.body.provider.name).toBe("openai-compatible-chat");
  });

  it("reports null pricing without a source when nothing resolves", async () => {
    const res = await GET(req("id=anthropic/claude-opus-4.6"));

    expect(res.body.pricing).toBeNull();
    expect(res.body.pricingSource).toBeNull();
  });

  it("labels a resolved rate as builtin when the user has no override", async () => {
    mocks.getPricingForModel.mockResolvedValue({ input: 5, output: 25 });

    const res = await GET(req("id=anthropic/claude-opus-4.6"));

    expect(res.body.pricing).toEqual({ input: 5, output: 25 });
    expect(res.body.pricingSource).toBe("builtin");
  });

  it("labels the rate as a user override when one exists for that provider id", async () => {
    mocks.getPricingForModel.mockResolvedValue({ input: 1, output: 2 });
    mocks.getUserPricingTables.mockResolvedValue({
      kiro: { "gpt-5.6-sol": { input: 1, output: 2 } },
    });

    const res = await GET(req("id=kr/gpt-5.6-sol"));

    expect(res.body.pricingSource).toBe("user");
  });

  it("flags a model that is in neither the registry nor the custom list", async () => {
    const res = await GET(req("id=openai/not-a-real-model"));

    expect(res.body.source).toBe("unlisted");
  });

  it("flags a user-added model as custom", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "openai", id: "not-a-real-model", type: "llm" },
    ]);

    const res = await GET(req("id=openai/not-a-real-model"));

    expect(res.body.source).toBe("custom");
  });

  it("404s an unknown bare id", async () => {
    const res = await GET(req("id=nope"));
    expect(res.status).toBe(404);
  });

  it("resolves a bare model alias to its target model", async () => {
    mocks.getModelAliases.mockResolvedValue({ opus: "anthropic/claude-opus-4.6" });

    const res = await GET(req("id=opus"));

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("model");
    expect(res.body.id).toBe("anthropic/claude-opus-4.6");
    expect(res.body.requestedAlias).toBe("opus");
  });
});

describe("GET /api/models/detail — combos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({ comboStrategies: {} });
    mocks.getPricingForModel.mockResolvedValue(null);
    mocks.getUserPricingTables.mockResolvedValue({});
  });

  it("404s an unknown combo", async () => {
    const res = await GET(req("combo=missing"));
    expect(res.status).toBe(404);
  });

  it("reports the combo as owned_by combo with one row per member", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "opus-4.8", kind: "llm", models: ["anthropic/claude-opus-4.6", "openai/gpt-5.4"] },
    ]);

    const res = await GET(req("combo=opus-4.8"));

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("combo");
    expect(res.body.owned_by).toBe("combo");
    expect(res.body.id).toBe("opus-4.8");
    expect(res.body.members).toHaveLength(2);
    expect(res.body.members.map((m) => m.raw)).toEqual([
      "anthropic/claude-opus-4.6",
      "openai/gpt-5.4",
    ]);
  });

  // Limits take the maximum so one small fallback member cannot erase the
  // headline model's window.
  it("advertises the largest member window", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "wide", kind: "llm", models: ["anthropic/claude-opus-4.6", "openai/gpt-5.4"] },
    ]);

    const res = await GET(req("combo=wide"));
    const windows = res.body.members.map((m) => m.capabilities.contextWindow);

    expect(res.body.capabilities.contextWindow).toBe(Math.max(...windows));
    expect(res.body.context_length).toBe(res.body.capabilities.contextWindow);
  });

  it("keeps an unresolvable member as a flagged row instead of dropping it", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "typo", kind: "llm", models: ["anthropic/claude-opus-4.6", "no-slash-member"] },
    ]);

    const res = await GET(req("combo=typo"));

    expect(res.body.members).toHaveLength(2);
    const bad = res.body.members[1];
    expect(bad.unresolved).toBe(true);
    expect(bad.resolved).toBeNull();
    expect(bad.capabilities).toBeNull();
    // The merge ignores it rather than falling back to defaults.
    expect(res.body.capabilities.contextWindow).toBe(
      res.body.members[0].capabilities.contextWindow,
    );
  });

  it("resolves a nested combo member", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "outer", kind: "llm", models: ["inner"] },
      { name: "inner", kind: "llm", models: ["anthropic/claude-opus-4.6"] },
    ]);

    const res = await GET(req("combo=outer"));

    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].kind).toBe("combo");
    expect(res.body.members[0].capabilities).not.toBeNull();
  });

  it("returns null capabilities when no member resolves", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "empty", kind: "llm", models: ["bare-nonsense"] },
    ]);

    const res = await GET(req("combo=empty"));

    expect(res.body.capabilities).toBeNull();
    expect(res.body.context_length).toBeUndefined();
  });

  it("includes the per-combo strategy from settings", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "fused", kind: "llm", models: ["anthropic/claude-opus-4.6"] },
    ]);
    mocks.getSettings.mockResolvedValue({
      comboStrategies: { fused: { fallbackStrategy: "fusion", judgeModel: "" } },
    });

    const res = await GET(req("combo=fused"));

    expect(res.body.strategy.fallbackStrategy).toBe("fusion");
  });

  it("resolves a bare id that names a combo", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "opus-4.8", kind: "llm", models: ["anthropic/claude-opus-4.6"] },
    ]);

    const res = await GET(req("id=opus-4.8"));

    expect(res.body.type).toBe("combo");
    expect(res.body.id).toBe("opus-4.8");
  });
});
