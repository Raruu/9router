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

  it("supports provider-exact-before-OpenRouter priority", () => {
    // "Provider exact" rows are hardcoded rules scoped to one provider. The
    // new order re-applies them over OpenRouter, while OpenRouter still refines
    // the generic hardcoded layer.
    const providerRules = [
      // Generic (provider "*"): canonical exact / ordered globs / models.dev.
      { provider: "*", pattern: "*foo*", data: { capabilities: { tools: true, contextWindow: 111 }, pricing: { cached: 1 } } },
      // Provider-exact row for acme.
      { provider: "acme", pattern: "foo-special", data: { capabilities: { contextWindow: 222, vision: true }, pricing: { input: 5 } } },
    ];
    const openRouterRules = [
      { provider: "*", pattern: "*foo*", data: { capabilities: { contextWindow: 999, vision: false, reasoning: true }, pricing: { input: 2, output: 4 } } },
    ];

    const resolver = createCatalogResolver({
      openRouterRules,
      hardcodedRules: providerRules,
      priority: "user-provider-exact-openrouter-hardcoded",
    });
    // The third arg mirrors runtime.js: the full hand-written chain for this
    // provider, which already carries the provider-exact values.
    const caps = resolver.getCapabilities("acme", "foo-special", { tools: true, contextWindow: 222, vision: true });
    // Provider exact wins over OpenRouter...
    expect(caps.contextWindow).toBe(222);
    expect(caps.vision).toBe(true);
    // ...OpenRouter wins over the generic hardcoded layer...
    expect(caps.reasoning).toBe(true);
    // ...and fields only the generic layer declares survive.
    expect(caps.tools).toBe(true);

    const pricing = resolver.getPricing("acme", "foo-special", { cached: 1, input: 5 });
    expect(pricing.input).toBe(5); // provider exact
    expect(pricing.output).toBe(4); // openrouter
    expect(pricing.cached).toBe(1); // generic hardcoded

    // The default priority keeps OpenRouter above provider exact.
    const defaultResolver = createCatalogResolver({ openRouterRules, hardcodedRules: providerRules });
    const defaultCaps = defaultResolver.getCapabilities("acme", "foo-special", { tools: true, contextWindow: 222, vision: true });
    expect(defaultCaps.contextWindow).toBe(999);
    expect(defaultCaps.vision).toBe(false);
  });

  it("scopes provider-exact rows to their provider only", () => {
    const resolver = createCatalogResolver({
      openRouterRules: [{ provider: "*", pattern: "*foo*", data: { capabilities: { contextWindow: 999 } } }],
      hardcodedRules: [{ provider: "acme", pattern: "*foo*", data: { capabilities: { contextWindow: 222 } } }],
      priority: "user-provider-exact-openrouter-hardcoded",
    });
    // other provider: the acme-scoped row must not apply.
    expect(resolver.getCapabilities("other", "foo-basic", { contextWindow: 111 }).contextWindow).toBe(999);
    expect(resolver.getCapabilities("acme", "foo-basic", { contextWindow: 222 }).contextWindow).toBe(222);
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
    // A dangling ref must degrade to the normal chain, never erase it: the
    // previous behavior returned {} here, which wiped the model's capabilities
    // (no vision/reasoning/context) whenever a pinned rule disappeared.
    expect(missing.getCapabilities("acme", "opaque", { vision: true })).toEqual({ vision: true });
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

describe("catalog reference robustness", () => {
  it("does not let a dangling pin suppress the lower-priority chain", () => {
    const resolver = createCatalogResolver({
      openRouterRules: [{ provider: "*", pattern: "*glm*", data: { capabilities: { vision: true, reasoning: true } } }],
      customModels: [{ providerAlias: "acme", id: "glm-5.3-flash", catalogRef: { source: "user", provider: "acme", pattern: "deleted-rule" } }],
    });

    // The third arg is the hand-written table result (see capabilities.refine).
    // Falls through to table + OpenRouter instead of collapsing to {}.
    expect(resolver.getCapabilities("acme", "glm-5.3-flash", { tools: true, contextWindow: 1000000 })).toEqual({
      tools: true, contextWindow: 1000000, vision: true, reasoning: true,
    });
  });

  it("keeps capabilities when the pinned rule only carries pricing", () => {
    const resolver = createCatalogResolver({
      userRules: [{ provider: "acme", pattern: "glm-5.3-flash", data: { pricing: { input: 3 } } }],
      customModels: [{ providerAlias: "acme", id: "glm-5.3-flash", catalogRef: { source: "user", provider: "acme", pattern: "glm-5.3-flash" } }],
    });

    const caps = resolver.getCapabilities("acme", "glm-5.3-flash", { tools: true, vision: true });
    expect(caps.vision).toBe(true);
    expect(resolver.getPricing("acme", "glm-5.3-flash").input).toBe(3);
  });

  it("matches a catalog reference case-insensitively", () => {
    const resolver = createCatalogResolver({
      userRules: [{ provider: "acme", pattern: "GLM-5.3-Flash", data: { capabilities: { vision: true } } }],
      customModels: [{ providerAlias: "acme", id: "glm-5.3-flash", catalogRef: { source: "user", provider: "ACME", pattern: "glm-5.3-flash" } }],
    });

    const caps = resolver.getCapabilities("acme", "glm-5.3-flash", {});
    expect(caps.vision).toBe(true);
  });

  it("keeps a resolving pin authoritative over the hand-written chain", () => {
    const resolver = createCatalogResolver({
      userRules: [{ provider: "acme", pattern: "glm-5.3-flash", data: { capabilities: { vision: false, tools: false } } }],
      customModels: [{ providerAlias: "acme", id: "glm-5.3-flash", catalogRef: { source: "user", provider: "acme", pattern: "glm-5.3-flash" } }],
    });

    const caps = resolver.getCapabilities("acme", "glm-5.3-flash", { vision: true, pdf: true, tools: true, reasoning: true });
    expect(caps.vision).toBe(false);
    expect(caps.pdf).toBeUndefined();
    expect(caps.tools).toBe(false);
    expect(caps.reasoning).toBeUndefined();
  });
});
