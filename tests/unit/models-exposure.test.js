import { describe, it, expect, beforeEach, vi } from "vitest";

// `modelsExposure` decides what GET /v1/models advertises. Combos and provider
// models stay routable either way — the setting only narrows the catalog, so a
// client that already knows an id keeps working.
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getSettings: vi.fn(),
  getDisabledModels: vi.fn(),
  hasValidCliToken: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/lib/auth/cliToken", () => ({
  hasValidCliToken: mocks.hasValidCliToken,
}));

const { buildModelsList, GET } = await import("../../src/app/api/v1/models/route.js");
const { mergeWithDefaults } = await import("../../src/lib/db/repos/settingsRepo.js");

const ids = (entries) => entries.map((e) => e.id);
const comboEntries = (entries) => entries.filter((e) => e.owned_by === "combo");

describe("/v1/models exposure setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "glm", isActive: true, providerSpecificData: { enabledModels: ["glm-5.2"] } },
    ]);
    mocks.getCombos.mockResolvedValue([{ name: "my-combo", models: ["glm/glm-5.2"] }]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({ modelsExposure: "all" });
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("lists combos and provider models by default", async () => {
    const data = await buildModelsList(["llm"], { exposure: "all" });
    expect(ids(data)).toContain("my-combo");
    expect(data.some((e) => e.owned_by !== "combo")).toBe(true);
  });

  it("treats a missing exposure option as all — /v1/models/{kind} passes none", async () => {
    const data = await buildModelsList(["llm"]);
    expect(ids(data)).toContain("my-combo");
    expect(data.some((e) => e.owned_by !== "combo")).toBe(true);
  });

  it("falls back to all for an unrecognized exposure value", async () => {
    const data = await buildModelsList(["llm"], { exposure: "bogus" });
    expect(ids(data)).toContain("my-combo");
    expect(data.some((e) => e.owned_by !== "combo")).toBe(true);
  });

  it("combos: emits combo entries only", async () => {
    const data = await buildModelsList(["llm"], { exposure: "combos" });
    expect(ids(data)).toEqual(["my-combo"]);
    expect(comboEntries(data)).toHaveLength(1);
  });

  it("models: drops combo entries", async () => {
    const data = await buildModelsList(["llm"], { exposure: "models" });
    expect(ids(data)).not.toContain("my-combo");
    expect(comboEntries(data)).toHaveLength(0);
    expect(data.length).toBeGreaterThan(0);
  });

  it("combos still inherit member capabilities when models are hidden", async () => {
    const [combo] = await buildModelsList(["llm"], { exposure: "combos" });
    expect(combo.context_length).toBeGreaterThan(0);
  });
});

describe("GET /v1/models exposure resolution", () => {
  const request = (headers = {}) => ({ headers: new Headers(headers) });
  const listIds = async (res) => ids((await res.json()).data);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "glm", isActive: true, providerSpecificData: { enabledModels: ["glm-5.2"] } },
    ]);
    mocks.getCombos.mockResolvedValue([{ name: "my-combo", models: ["glm/glm-5.2"] }]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("applies the stored setting", async () => {
    mocks.getSettings.mockResolvedValue({ modelsExposure: "combos" });
    expect(await listIds(await GET(request()))).toEqual(["my-combo"]);
  });

  it("exempts CLI-token requests so the CLI model pickers stay populated", async () => {
    mocks.getSettings.mockResolvedValue({ modelsExposure: "combos" });
    mocks.hasValidCliToken.mockResolvedValue(true);

    const result = await listIds(await GET(request({ "x-9r-cli-token": "token" })));
    expect(result).toContain("my-combo");
    expect(result.length).toBeGreaterThan(1);
  });

  it("falls back to all when settings cannot be read", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db down"));
    const result = await listIds(await GET(request()));
    expect(result).toContain("my-combo");
    expect(result.length).toBeGreaterThan(1);
  });

  it("falls back to the setting when the CLI token check throws", async () => {
    mocks.hasValidCliToken.mockRejectedValue(new Error("no machine id"));
    mocks.getSettings.mockResolvedValue({ modelsExposure: "models" });
    expect(await listIds(await GET(request()))).not.toContain("my-combo");
  });
});

describe("modelsExposure default", () => {
  it("backfills existing installs with all", () => {
    expect(mergeWithDefaults({ comboStrategy: "fallback" }).modelsExposure).toBe("all");
  });

  it("keeps a stored value", () => {
    expect(mergeWithDefaults({ modelsExposure: "combos" }).modelsExposure).toBe("combos");
  });
});
