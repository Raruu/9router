import { afterEach, describe, expect, it } from "vitest";
import { createCatalogResolver } from "../../src/lib/modelCatalog/resolution.js";
import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel, setCatalogPricingSource } from "../../open-sse/providers/pricing.js";

afterEach(() => {
  setCatalogSource(null);
  setCatalogPricingSource(null);
});

describe("model catalog precedence", () => {
  const rules = {
    userRules: [
      { provider: "*", pattern: "foo-*", data: { capabilities: { vision: false }, pricing: { output: 8 } } },
      { provider: "acme", pattern: "foo-special", data: { capabilities: { tools: false }, pricing: { input: 7 } } },
    ],
    openRouterRules: [
      { provider: "*", pattern: "*foo*", data: { capabilities: { vision: true, reasoning: true }, pricing: { input: 2, output: 4 } } },
    ],
    hardcodedRules: [
      { provider: "*", pattern: "*foo*", data: { capabilities: { tools: true, contextWindow: 200000 }, pricing: { cached: 1 } } },
    ],
    customModels: [{ providerAlias: "acme", id: "foo-special", caps: { reasoning: false, audioInput: true } }],
  };

  it("field-merges sources with explicit false and deterministic specificity", () => {
    const resolver = createCatalogResolver(rules);
    expect(resolver.getCapabilities("acme", "foo-special", { tools: true, pdf: true })).toEqual({
      tools: false, pdf: true, vision: false, reasoning: false, audioInput: true,
    });
    expect(resolver.getPricing("acme", "foo-special", { cached: 1 })).toEqual({ cached: 1, input: 7, output: 8 });
  });

  it("supports hardcoded-before-OpenRouter alternate priority", () => {
    const resolver = createCatalogResolver({ ...rules, priority: "user-hardcoded-openrouter" });
    expect(resolver.getCapabilities("other", "foo-basic", { reasoning: false }).reasoning).toBe(false);
  });

  it("drives the public synchronous capability and pricing seams", () => {
    const resolver = createCatalogResolver(rules);
    setCatalogSource(resolver);
    setCatalogPricingSource(resolver);
    expect(getCapabilitiesForModel("acme", "foo-special")).toMatchObject({ vision: false, tools: false, reasoning: false, audioInput: true });
    expect(getPricingForModel("acme", "foo-special")).toEqual({ input: 7, output: 8 });
  });

  it("keeps explicit false above the vision name heuristic", () => {
    const resolver = createCatalogResolver({
      userRules: [{ provider: "*", pattern: "vision-model", data: { capabilities: { vision: false } } }],
    });
    setCatalogSource(resolver);
    expect(getCapabilitiesForModel("acme", "vision-model").vision).toBe(false);
  });

  it("resolves a custom model through its selected source pattern", () => {
    const resolver = createCatalogResolver({
      userRules: [{ provider: "acme", pattern: "custom-id", data: { capabilities: { tools: false }, pricing: { output: 9 } } }],
      openRouterRules: [{ provider: "*", pattern: "*claude*", data: { capabilities: { vision: true, contextWindow: 1000000 }, pricing: { input: 3, output: 15 } } }],
      customModels: [{ providerAlias: "acme", id: "custom-id", catalogRef: { source: "openrouter", provider: "*", pattern: "*claude*" } }],
    });

    expect(resolver.getCapabilities("acme", "custom-id", { reasoning: true })).toEqual({ vision: true, contextWindow: 1000000, tools: false });
    expect(resolver.getPricing("acme", "custom-id", { cached: 1 })).toEqual({ input: 3, output: 9 });
  });

  it("supports hardcoded live references and ignores missing references", () => {
    const hardcodedRules = [{ provider: "*", pattern: "*sonnet*", data: { capabilities: { reasoning: true }, pricing: { input: 4 } } }];
    const selected = createCatalogResolver({
      hardcodedRules,
      customModels: [{ providerAlias: "acme", id: "opaque", catalogRef: { source: "hardcoded", provider: "*", pattern: "*sonnet*" } }],
    });
    const missing = createCatalogResolver({
      hardcodedRules,
      customModels: [{ providerAlias: "acme", id: "opaque", catalogRef: { source: "hardcoded", provider: "*", pattern: "deleted-pattern" } }],
    });

    expect(selected.getCapabilities("acme", "opaque", { vision: true })).toEqual({ reasoning: true });
    expect(selected.getPricing("acme", "opaque", { output: 8 })).toEqual({ input: 4 });
    expect(missing.getCapabilities("acme", "opaque", { vision: true })).toEqual({});
  });

  it("matches a custom catalog reference through equivalent provider aliases", () => {
    const aliases = { kr: "kiro", kiro: "kiro" };
    const resolver = createCatalogResolver({
      openRouterRules: [{
        provider: "*",
        pattern: "*omni*",
        data: { capabilities: { vision: true, pdf: true, audioInput: true, videoInput: true, imageOutput: true, audioOutput: true, tools: true, reasoning: true } },
      }],
      customModels: [{ providerAlias: "kr", id: "opaque", catalogRef: { source: "openrouter", provider: "*", pattern: "*omni*" } }],
      normalizeProviderId: (provider) => aliases[provider] || provider,
    });

    expect(resolver.getCapabilities("kiro", "opaque", {})).toMatchObject({
      vision: true,
      pdf: true,
      audioInput: true,
      videoInput: true,
      imageOutput: true,
      audioOutput: true,
      tools: true,
      reasoning: true,
    });
  });
});
