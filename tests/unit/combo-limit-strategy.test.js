// comboLimitStrategy — which member's numeric limits (contextWindow/maxOutput)
// a combo advertises. Global setting, default "max". Booleans always union.
// Display-only: routing and clamping always use the member that served the
// request, so these tests only cover the advertised surfaces.
//
// Members are chosen so the windows genuinely differ (glm-5.3-flash 1M/131072,
// gpt-5.4 400k/128000, opus-4.6 1M/128000 per the live capability tables) and
// expectations are computed from those tables, so table drift fails the
// differ-guard loudly instead of making the direction assertions vacuous.
import { describe, it, expect, beforeEach, vi } from "vitest";

import { mergeMemberCapabilities, comboCapabilities } from "../../open-sse/providers/comboCapabilities.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const caps = (fullModel) => {
  const slash = fullModel.indexOf("/");
  return getCapabilitiesForModel(fullModel.slice(0, slash), fullModel.slice(slash + 1));
};

const MEMBERS = ["vs-llm/glm-5.3-flash", "openai/gpt-5.4", "anthropic/claude-opus-4.6"];
const memberCaps = () => MEMBERS.map(caps);

describe("mergeMemberCapabilities — limit strategy", () => {
  it("min applies to both contextWindow and maxOutput", () => {
    const members = memberCaps();
    expect(new Set(members.map((c) => c.contextWindow)).size).toBeGreaterThan(1);

    const merged = mergeMemberCapabilities(members, "min");
    expect(merged.contextWindow).toBe(Math.min(...members.map((c) => c.contextWindow)));
    expect(merged.maxOutput).toBe(Math.min(...members.map((c) => c.maxOutput)));
  });

  it("max stays the default and the explicit value agrees", () => {
    const members = memberCaps();
    const implicit = mergeMemberCapabilities(members);
    const explicit = mergeMemberCapabilities(members, "max");
    expect(implicit.contextWindow).toBe(explicit.contextWindow);
    expect(explicit.contextWindow).toBe(Math.max(...members.map((c) => c.contextWindow)));
  });

  it("a single member merges to itself under either strategy", () => {
    const members = [caps("vs-llm/glm-5.3-flash")];
    const max = mergeMemberCapabilities(members, "max");
    const min = mergeMemberCapabilities(members, "min");
    expect(max.contextWindow).toBe(min.contextWindow);
    expect(max.maxOutput).toBe(min.maxOutput);
  });

  it("min still unions thinking ranges and booleans", () => {
    const merged = mergeMemberCapabilities(
      [
        { ...caps("gemini/gemini-2.5-pro"), thinkingRange: { min: 128, max: 8192 }, vision: true },
        { ...caps("gemini/gemini-2.5-pro"), thinkingRange: { min: 0, max: 24576 }, vision: false },
      ],
      "min",
    );
    expect(merged.thinkingRange).toEqual({ min: 0, max: 24576 });
    expect(merged.vision).toBe(true);
  });

  it("members without finite limits fall back to the default, not NaN", () => {
    const merged = mergeMemberCapabilities(
      [
        { contextWindow: undefined, maxOutput: Number.NaN },
        { contextWindow: 400000, maxOutput: 128000 },
      ],
      "min",
    );
    expect(merged.contextWindow).toBe(400000);
    expect(merged.maxOutput).toBe(128000);
  });

  it("no member with a finite limit falls back to DEFAULT_CAPABILITIES under min", () => {
    const merged = mergeMemberCapabilities(
      [{ contextWindow: undefined, maxOutput: Number.NaN }],
      "min",
    );
    expect(merged.contextWindow).toBe(200000);
    expect(Number.isFinite(merged.maxOutput)).toBe(true);
  });
});

describe("comboCapabilities — ctx threading", () => {
  const ctx = (strategy) => ({
    providerIdByPrefix: new Map(),
    comboByName: new Map(),
    modelAliases: {},
    comboLimitStrategy: strategy,
  });

  it("reads the strategy from ctx", () => {
    const combo = { name: "c", models: MEMBERS };
    const windows = memberCaps().map((c) => c.contextWindow);
    expect(new Set(windows).size).toBeGreaterThan(1);
    expect(comboCapabilities(combo, ctx("max")).contextWindow).toBe(Math.max(...windows));
    expect(comboCapabilities(combo, ctx("min")).contextWindow).toBe(Math.min(...windows));
  });

  it("unresolvable members stay ignored under min instead of dragging to the floor", () => {
    const combo = { name: "c", models: ["vs-llm/glm-5.3-flash", "no-slash-member"] };
    const merged = comboCapabilities(combo, ctx("min"));
    expect(merged.contextWindow).toBe(1000000);
  });
});

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

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
const { mergeWithDefaults } = await import("../../src/lib/db/repos/settingsRepo.js");

describe("GET /v1/models advertises the setting end-to-end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([
      { name: "mixed", kind: "llm", models: MEMBERS },
    ]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("default (no setting) advertises the max window", async () => {
    const windows = memberCaps().map((c) => c.contextWindow);
    const data = await buildModelsList(["llm"], { exposure: "combos" });
    const combo = data.find((e) => e.id === "mixed");
    expect(combo.context_length).toBe(Math.max(...windows));
    expect(combo.max_completion_tokens).toBe(Math.max(...memberCaps().map((c) => c.maxOutput)));
  });

  it("min advertises the smallest member window", async () => {
    const windows = memberCaps().map((c) => c.contextWindow);
    const data = await buildModelsList(["llm"], { exposure: "combos", comboLimitStrategy: "min" });
    const combo = data.find((e) => e.id === "mixed");
    expect(combo.context_length).toBe(Math.min(...windows));
    expect(combo.max_completion_tokens).toBe(Math.min(...memberCaps().map((c) => c.maxOutput)));
  });

  it("mergeWithDefaults supplies max when the stored settings lack the key", () => {
    expect(mergeWithDefaults({}).comboLimitStrategy).toBe("max");
    expect(mergeWithDefaults({ comboLimitStrategy: "min" }).comboLimitStrategy).toBe("min");
  });
});
