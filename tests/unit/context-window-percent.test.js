// Context window percent — Model Catalog `contextWindowPercent` capability.
//
// A pattern that inherits a 1M context window can advertise a smaller share of
// it (80% = 800K) instead of hardcoding an absolute token count, so a
// refetched OpenRouter/table value re-derives automatically. The percent is a
// rule-layer concept: the resolver computes the absolute and strips the key.
import { describe, it, expect, afterEach } from "vitest";

import { sanitizeCapabilities } from "../../src/lib/modelCatalog/validation.js";
import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { createCatalogResolver } from "../../src/lib/modelCatalog/resolution.js";

afterEach(() => setCatalogSource(null));

describe("sanitizeCapabilities — contextWindowPercent", () => {
  it("keeps whole percents in 1–100 and floors decimals", () => {
    expect(sanitizeCapabilities({ contextWindowPercent: 80 })).toEqual({ contextWindowPercent: 80 });
    expect(sanitizeCapabilities({ contextWindowPercent: 80.9 })).toEqual({ contextWindowPercent: 80 });
    expect(sanitizeCapabilities({ contextWindowPercent: 1 })).toEqual({ contextWindowPercent: 1 });
    expect(sanitizeCapabilities({ contextWindowPercent: 100 })).toEqual({ contextWindowPercent: 100 });
  });

  it("drops out-of-range and non-numeric values", () => {
    expect(sanitizeCapabilities({ contextWindowPercent: 0 })).toEqual({});
    expect(sanitizeCapabilities({ contextWindowPercent: 101 })).toEqual({});
    expect(sanitizeCapabilities({ contextWindowPercent: -5 })).toEqual({});
    expect(sanitizeCapabilities({ contextWindowPercent: "80" })).toEqual({});
    expect(sanitizeCapabilities({ contextWindowPercent: NaN })).toEqual({});
    expect(sanitizeCapabilities({ contextWindowPercent: Infinity })).toEqual({});
  });
});

describe("resolution — percent vs absolute", () => {
  it("keeps the percent when the user layer has no absolute window", () => {
    const resolver = createCatalogResolver({
      userRules: [{ provider: "acme", pattern: "win-*", data: { capabilities: { contextWindowPercent: 80 } } }],
    });
    expect(resolver.getCapabilities("acme", "win-1", { contextWindow: 1000000 })).toMatchObject({
      contextWindow: 1000000,
      contextWindowPercent: 80,
    });
  });

  it("drops the percent when a user rule sets an absolute window", () => {
    const resolver = createCatalogResolver({
      userRules: [
        { provider: "acme", pattern: "win-*", data: { capabilities: { contextWindowPercent: 80 } } },
        { provider: "acme", pattern: "win-exact", data: { capabilities: { contextWindow: 500000 } } },
      ],
    });
    const caps = resolver.getCapabilities("acme", "win-exact", { contextWindow: 1000000 });
    expect(caps.contextWindow).toBe(500000);
    expect(caps.contextWindowPercent).toBeUndefined();
  });

  it("keeps a specific rule's percent over a broader rule's absolute", () => {
    const resolver = createCatalogResolver({
      userRules: [
        { provider: "acme", pattern: "win-*", data: { capabilities: { contextWindow: 500000 } } },
        { provider: "acme", pattern: "win-exact", data: { capabilities: { contextWindowPercent: 50 } } },
      ],
    });
    const caps = resolver.getCapabilities("acme", "win-exact", { contextWindow: 1000000 });
    // The specific rule's percent survives and shrinks the broader rule's window.
    expect(caps.contextWindow).toBe(500000);
    expect(caps.contextWindowPercent).toBe(50);

    setCatalogSource(resolver);
    expect(getCapabilitiesForModel("acme", "win-exact").contextWindow).toBe(250000);
  });
});

describe("refine — computes and strips the percent", () => {
  function installCaps(caps) {
    setCatalogSource({
      getCapabilities: () => caps,
      getModalities: () => null,
      getLimits: () => null,
    });
  }

  it("computes the share of an explicit hardcoded window", () => {
    setCatalogSource(createCatalogResolver({
      userRules: [{ provider: "acme", pattern: "claude-opus-4.8", data: { capabilities: { contextWindowPercent: 80 } } }],
    }));
    const caps = getCapabilitiesForModel("acme", "claude-opus-4.8");
    expect(caps.contextWindow).toBe(800000);
    expect(caps.contextWindowPercent).toBeUndefined();
  });

  it("computes the share of the 200K default when nothing declares a window", () => {
    installCaps({ contextWindowPercent: 80 });
    const caps = getCapabilitiesForModel("acme", "unknown-model");
    expect(caps.contextWindow).toBe(160000);
    expect(caps.contextWindowPercent).toBeUndefined();
  });

  it("floors fractional results", () => {
    installCaps({ contextWindow: 999999, contextWindowPercent: 33 });
    expect(getCapabilitiesForModel("acme", "m").contextWindow).toBe(329999);
  });

  it("ignores an out-of-range percent and still strips the key", () => {
    installCaps({ contextWindow: 1000000, contextWindowPercent: 150 });
    const caps = getCapabilitiesForModel("acme", "m");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.contextWindowPercent).toBeUndefined();
  });
});
