import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getModelAliases: vi.fn(),
  getCustomModels: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnections: vi.fn(),
  getDisabledModels: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/models", () => ({
  getModelAliases: mocks.getModelAliases,
  getCustomModels: mocks.getCustomModels,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnections: mocks.getProviderConnections,
  setModelAlias: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

const { GET } = await import("../../src/app/api/models/route.js");
const { createCatalogResolver } = await import("../../src/lib/modelCatalog/resolution.js");
const { setCatalogSource } = await import("../../open-sse/providers/capabilities.js");

describe("GET /api/models dashboard capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCatalogSource(null);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  it("keeps every capability resolved for a custom model", async () => {
    const expected = { vision: true, pdf: true, audioInput: true, videoInput: true, imageOutput: true, audioOutput: true, tools: true, reasoning: true };
    setCatalogSource(createCatalogResolver({
      openRouterRules: [{ provider: "*", pattern: "*omni*", data: { capabilities: expected } }],
      customModels: [{ providerAlias: "kr", id: "opaque", catalogRef: { source: "openrouter", provider: "*", pattern: "*omni*" } }],
      normalizeProviderId: (provider) => provider === "kr" ? "kiro" : provider,
    }));
    mocks.getCustomModels.mockResolvedValue([{ providerAlias: "kr", id: "opaque", type: "llm" }]);

    const response = await GET();
    const model = response.body.models.find((entry) => entry.fullModel === "kr/opaque");

    expect(model.caps).toMatchObject(expected);
  });

  it("exposes the compatible-node display prefix and server-resolved levels", async () => {
    const NODE = "openai-compatible-chat-88e8";
    setCatalogSource(createCatalogResolver({
      userRules: [{
        provider: NODE,
        pattern: "glm-5.3-flash",
        data: { capabilities: { reasoning: true, thinkingLevels: ["low", "high"] } },
      }],
    }));
    mocks.getProviderNodes.mockResolvedValue([{ id: NODE, prefix: "qwen-3.8" }]);
    mocks.getCustomModels.mockResolvedValue([{ providerAlias: NODE, id: "glm-5.3-flash", type: "llm" }]);

    const response = await GET();
    const model = response.body.models.find((entry) => entry.fullModel === `${NODE}/glm-5.3-flash`);

    // The picker stores members under the prefix, so the client needs that key
    // to resolve capabilities without the ambiguous bare-id fallback.
    expect(model.prefixModel).toBe("qwen-3.8/glm-5.3-flash");
    expect(model.thinkingLevels).toEqual(["low", "high"]);
    expect(model.caps.reasoning).toBe(true);
  });

  it("falls back to connection prefixes and skips a colliding node-id key", async () => {
    const NODE = "openai-compatible-chat-abc";
    mocks.getProviderConnections.mockResolvedValue([
      { provider: NODE, providerSpecificData: { prefix: "my-node" } },
    ]);
    mocks.getCustomModels.mockResolvedValue([{ providerAlias: NODE, id: "model-x", type: "llm" }]);

    const response = await GET();
    const model = response.body.models.find((entry) => entry.fullModel === `${NODE}/model-x`);

    expect(model.prefixModel).toBe("my-node/model-x");
  });
});
