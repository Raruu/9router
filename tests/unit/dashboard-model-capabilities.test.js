import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getModelAliases: vi.fn(),
  getCustomModels: vi.fn(),
  getDisabledModels: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/models", () => ({
  getModelAliases: mocks.getModelAliases,
  getCustomModels: mocks.getCustomModels,
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
});
