import { describe, expect, it, vi } from "vitest";
import { setCatalogSource } from "../../open-sse/providers/capabilities.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderNodes: vi.fn(async () => []),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const syncedLimits = { contextWindow: 180000, maxOutput: 16000 };

async function modelsWithCombo(providerId, modelId, combos) {
  db.getProviderConnections.mockResolvedValue([{
    id: 1,
    provider: providerId,
    isActive: true,
    providerSpecificData: { enabledModels: [modelId] },
  }]);
  db.getCombos.mockResolvedValue(combos);
  setCatalogSource({
    getModalities: () => null,
    getLimits: (provider, model) =>
      provider === providerId && model === modelId ? syncedLimits : null,
  });
  try {
    return await buildModelsList(["llm"]);
  } finally {
    setCatalogSource(null);
  }
}

describe("/v1/models combo limits", () => {
  it.each([
    ["ocg", "opencode-go", "mimo-v2.5"],
    ["xmtp", "xiaomi-tokenplan", "mimo-v2.5"],
    ["ps", "poolside", "custom-model"],
    ["ds", "deepseek", "deepseek-chat"],
  ])("uses the real provider for a %s UI-alias seat", async (uiAlias, providerId, modelId) => {
    const combo = { name: "ui-alias-combo", models: [`${uiAlias}/${modelId}`] };
    const models = await modelsWithCombo(providerId, modelId, [combo]);
    const published = models.find((model) => model.id === combo.name);

    expect(published).toMatchObject({
      context_length: 180000,
      max_completion_tokens: 16000,
      capabilities: { contextWindow: 180000, maxOutput: 16000 },
    });
  });

  it("carries provider-scoped limits through a nested combo", async () => {
    const models = await modelsWithCombo("opencode-go", "mimo-v2.5", [
      { name: "inner-combo", models: ["ocg/mimo-v2.5"] },
      { name: "outer-combo", models: ["inner-combo"] },
    ]);
    const outer = models.find((model) => model.id === "outer-combo");

    expect(outer).toMatchObject({
      context_length: 180000,
      max_completion_tokens: 16000,
      capabilities: { contextWindow: 180000, maxOutput: 16000 },
    });
  });

  it("publishes Devin CLI's 200k limit for a dv combo seat", async () => {
    const models = await modelsWithCombo("devin-cli", "gpt-5.5-high", [
      { name: "devin-combo", models: ["dv/gpt-5.5-high"] },
    ]);
    const combo = models.find((model) => model.id === "devin-combo");

    expect(combo).toMatchObject({
      context_length: 200000,
      capabilities: { contextWindow: 200000 },
    });
  });
});

// A custom node whose connections are all deactivated: the node (and its
// per-model catalog pins) still exist, so a combo member pointing at the node's
// prefix must resolve to the node id. Without the node layer the member falls
// back to provider-agnostic rules and advertises levels the member never
// declared — the `testing` combo bug.
describe("/v1/models combo member on an inactive custom node", () => {
  const NODE_ID = "openai-compatible-chat-inactive-node";

  it("resolves the node prefix from the node list, not the active connections", async () => {
    db.getProviderConnections.mockResolvedValue([]); // node deactivated → no active conns
    db.getProviderNodes.mockResolvedValue([{ id: NODE_ID, type: "openai-compatible", prefix: "agent-router" }]);
    db.getCombos.mockResolvedValue([{ name: "testing", models: ["agent-router/gpt-6-astra"] }]);
    db.getCustomModels.mockResolvedValue([{
      providerAlias: NODE_ID,
      id: "gpt-6-astra",
      type: "llm",
      catalogRef: { source: "user", provider: "*", pattern: "gpt-6-astra-agentrouter" },
    }]);
    setCatalogSource({
      getCapabilities: (provider, model, hardcoded) => ({
        ...(hardcoded || {}),
        // The pinned rule only matches the NODE id — never the bare prefix.
        ...(provider === NODE_ID
          ? { reasoning: true, thinkingFormatOverride: "openai", thinkingLevels: ["none"], thinkingEnforce: true }
          : { reasoning: true, thinkingFormat: "openai" }),
      }),
    });
    try {
      const models = await buildModelsList(["llm"]);
      const combo = models.find((model) => model.id === "testing");
      expect(combo.capabilities.effort_tiers).toEqual(["none"]);
    } finally {
      setCatalogSource(null);
      db.getProviderNodes.mockResolvedValue([]);
      db.getCustomModels.mockResolvedValue([]);
    }
  });
});
