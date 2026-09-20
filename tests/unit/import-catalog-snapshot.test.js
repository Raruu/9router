import { describe, it, expect, vi } from "vitest";
import {
  buildCatalogRuleBody,
  buildCatalogRuleBodyFromRaw,
  collectLeafPaths,
  detectImportMapping,
  resolvePath,
  saveCatalogRule,
} from "../../src/shared/utils/importCatalogSnapshot.js";

const detail = {
  capabilities: {
    vision: true,
    pdf: false,
    tools: true,
    reasoning: false,
    contextWindow: 200000,
    maxOutput: 32000,
    extraUnknown: true,
  },
  pricing: { input: 3, output: 15, bogus: 1, negative: -2 },
};

describe("importCatalogSnapshot", () => {
  it("maps detail capabilities/context/pricing to a user rule body", () => {
    expect(buildCatalogRuleBody({ provider: "acme", pattern: "m1", detail })).toEqual({
      provider: "acme",
      pattern: "m1",
      matchType: "exact",
      capabilities: { vision: true, pdf: false, tools: true, reasoning: false },
      contextWindow: 200000,
      maxOutput: 32000,
      pricing: { input: 3, output: 15 },
    });
  });

  it("returns null without capabilities", () => {
    expect(buildCatalogRuleBody({ provider: "acme", pattern: "m1", detail: {} })).toBeNull();
    expect(buildCatalogRuleBody({ provider: "acme", pattern: "m1", detail: null })).toBeNull();
  });

  it("POSTs the rule and succeeds", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const body = { provider: "acme", pattern: "m1", matchType: "exact", capabilities: {} };
    expect(await saveCatalogRule(body, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/models/catalog/user");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(body);
  });

  it("falls back to PUT with identity on 409", async () => {
    const fetchImpl = vi.fn(async (url, init) =>
      init.method === "POST" ? { ok: false, status: 409 } : { ok: true, status: 200 },
    );
    const body = { provider: "acme", pattern: "m1", matchType: "exact", capabilities: {} };
    expect(await saveCatalogRule(body, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      ...body,
      originalIdentity: { provider: "acme", pattern: "m1" },
    });
  });

  it("returns false when both POST and PUT fail", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(
      await saveCatalogRule({ provider: "acme", pattern: "m1", matchType: "exact", capabilities: {} }, fetchImpl),
    ).toBe(false);
  });
});

const agnes = {
  id: "agnes-2.5-flash",
  object: "model",
  owned_by: "byNara",
  name: "Agnes 2.5 Flash",
  context_window: 512000,
  vision: true,
  reasoning: true,
  payg_enabled: true,
  input_idr_per_1k: 0.1,
  output_idr_per_1k: 0.2,
  cache_read_idr_per_1k: 0.01,
  input_idr_per_1m: 100,
  output_idr_per_1m: 200,
  cache_read_idr_per_1m: 10,
};

describe("detectImportMapping", () => {
  it("auto-detects the agnes-style provider payload", () => {
    const mapping = detectImportMapping([agnes]);
    expect(mapping.caps.vision).toBe("vision");
    expect(mapping.caps.reasoning).toBe("reasoning");
    expect(mapping.caps.tools).toBeNull();
    expect(mapping.contextWindow).toBe("context_window");
    expect(mapping.maxOutput).toBeNull();
    expect(mapping.pricing).toEqual({
      input: "input_idr_per_1m",
      output: "output_idr_per_1m",
      cached: "cache_read_idr_per_1m",
    });
    expect(mapping.currency).toBe("IDR");
  });

  it("prefers per-1M over per-1K and USD over IDR", () => {
    expect(detectImportMapping([{ input_idr_per_1k: 1, input_idr_per_1m: 1000 }]).pricing.input).toBe("input_idr_per_1m");
    expect(detectImportMapping([{ input_idr_per_1m: 1000, input_usd_per_1m: 0.06 }]).pricing.input).toBe("input_usd_per_1m");
    expect(detectImportMapping([{ input_idr_per_1k: 1 }]).pricing.input).toBe("input_idr_per_1k");
  });

  it("handles plain OpenAI/OpenRouter-style keys", () => {
    const mapping = detectImportMapping([{ prompt: "0.000003", completion: "0.000015", context_length: 128000 }]);
    expect(mapping.pricing.input).toBe("prompt");
    expect(mapping.pricing.output).toBe("completion");
    expect(mapping.contextWindow).toBe("context_length");
    expect(mapping.currency).toBeNull();
  });

  it("unions keys across entries and ignores non-objects", () => {
    const mapping = detectImportMapping([null, "nope", { vision: true }, { supports_reasoning: false, max_completion_tokens: 8192 }]);
    expect(mapping.caps.vision).toBe("vision");
    expect(mapping.caps.reasoning).toBe("supports_reasoning");
    expect(mapping.maxOutput).toBe("max_completion_tokens");
  });
});

describe("buildCatalogRuleBodyFromRaw", () => {
  const mapping = detectImportMapping([agnes]);

  it("maps caps, limits and IDR prices to USD per 1M", () => {
    const body = buildCatalogRuleBodyFromRaw({ provider: "agnes", pattern: agnes.id, raw: agnes, mapping, currencyRate: 16000 });
    expect(body).toEqual({
      provider: "agnes",
      pattern: "agnes-2.5-flash",
      matchType: "exact",
      capabilities: { vision: true, reasoning: true },
      contextWindow: 512000,
      pricing: {
        input: 100 / 16000,
        output: 200 / 16000,
        cached: 10 / 16000,
      },
    });
  });

  it("scales per-1K sources by 1000 to the same normalized price", () => {
    const body = buildCatalogRuleBodyFromRaw({
      provider: "agnes",
      pattern: agnes.id,
      raw: agnes,
      mapping: { ...mapping, pricing: { ...mapping.pricing, input: "input_idr_per_1k" }, currency: "IDR" },
      currencyRate: 16000,
    });
    expect(body.pricing.input).toBeCloseTo(100 / 16000, 10);
  });

  it("leaves USD sources untouched", () => {
    const body = buildCatalogRuleBodyFromRaw({
      provider: "acme",
      pattern: "m1",
      raw: { vision: true, input_usd_per_1m: 3 },
      mapping: { caps: { vision: "vision" }, pricing: { input: "input_usd_per_1m" }, currency: "USD" },
    });
    expect(body.pricing).toEqual({ input: 3 });
  });

  it("skips non-USD pricing when no usable rate is given", () => {
    const body = buildCatalogRuleBodyFromRaw({ provider: "agnes", pattern: agnes.id, raw: agnes, mapping });
    expect(body.capabilities).toEqual({ vision: true, reasoning: true });
    expect(body.pricing).toBeUndefined();
  });

  it("coerces boolean-ish values and ignores unmappable ones", () => {
    const body = buildCatalogRuleBodyFromRaw({
      provider: "acme",
      pattern: "m1",
      raw: { vision: "yes", reasoning: 0, pdf: "maybe" },
      mapping: { caps: { vision: "vision", reasoning: "reasoning", pdf: "pdf" } },
    });
    expect(body.capabilities).toEqual({ vision: true, reasoning: false });
  });

  it("returns null when nothing is mappable", () => {
    expect(buildCatalogRuleBodyFromRaw({ provider: "a", pattern: "m", raw: agnes, mapping: { caps: {} } })).toBeNull();
    expect(buildCatalogRuleBodyFromRaw({ provider: "a", pattern: "m", raw: {}, mapping })).toBeNull();
    expect(buildCatalogRuleBodyFromRaw({ provider: "a", pattern: "m", raw: agnes, mapping: null })).toBeNull();
    expect(buildCatalogRuleBodyFromRaw({ provider: "a", pattern: "m", raw: null, mapping })).toBeNull();
  });
});

// Payload shape some providers use: capability flags and limits are nested
// rather than flat, so the mapping dropdowns have to reach into them.
const nested = {
  id: "nested-1",
  object: "model",
  owned_by: "acme",
  capabilities: { vision: true, audio_input: true, tools: "yes", pdf: false },
  limits: { context_window: 128000, max_output: 8192 },
  pricing: { input_usd_per_1m: 0.25, output_usd_per_1m: 1.5, cached_usd_per_1m: 0.05 },
};

describe("resolvePath", () => {
  it("walks dotted paths and fails soft on missing or non-object hops", () => {
    expect(resolvePath({ a: { b: { c: 5 } } }, "a.b.c")).toBe(5);
    expect(resolvePath({ a: 1 }, "a.b")).toBeUndefined();
    expect(resolvePath({ a: null }, "a.b")).toBeUndefined();
    expect(resolvePath({ a: true }, "a")).toBe(true);
    expect(resolvePath(null, "a")).toBeUndefined();
    expect(resolvePath({ a: 1 }, "")).toBeUndefined();
    expect(resolvePath({ a: 1 }, null)).toBeUndefined();
  });
});

describe("collectLeafPaths", () => {
  it("flattens nested scalars to dot-paths in first-seen order", () => {
    expect(collectLeafPaths([nested])).toEqual([
      "id", "object", "owned_by",
      "capabilities.vision", "capabilities.audio_input", "capabilities.tools", "capabilities.pdf",
      "limits.context_window", "limits.max_output",
      "pricing.input_usd_per_1m", "pricing.output_usd_per_1m", "pricing.cached_usd_per_1m",
    ]);
  });

  it("skips arrays, empty objects and non-object entries", () => {
    expect(collectLeafPaths([{ a: [1, 2], b: {}, c: true }])).toEqual(["c"]);
    expect(collectLeafPaths([null, "nope", 5, { a: true }])).toEqual(["a"]);
  });

  it("unions paths across entries without duplicates", () => {
    expect(collectLeafPaths([{ a: 1 }, { a: 2, b: 3 }])).toEqual(["a", "b"]);
    expect(collectLeafPaths([{ vision: true }, { capabilities: { vision: true } }])).toEqual(["vision", "capabilities.vision"]);
  });

  it("caps nesting depth", () => {
    expect(collectLeafPaths([{ a: { b: { c: true } } }])).toEqual(["a.b.c"]);
    expect(collectLeafPaths([{ a: { b: { c: { d: { e: 1 } } } } }])).toEqual([]);
    expect(collectLeafPaths([{ a: { b: { c: { d: { e: 1 } } } } }], { maxDepth: 5 })).toEqual(["a.b.c.d.e"]);
  });
});

describe("nested /models payloads", () => {
  it("auto-detects capabilities, limits and prices inside containers", () => {
    const mapping = detectImportMapping([nested]);
    expect(mapping.caps.vision).toBe("capabilities.vision");
    expect(mapping.caps.audioInput).toBe("capabilities.audio_input");
    expect(mapping.caps.tools).toBe("capabilities.tools");
    expect(mapping.caps.pdf).toBe("capabilities.pdf");
    expect(mapping.caps.reasoning).toBeNull();
    expect(mapping.contextWindow).toBe("limits.context_window");
    expect(mapping.maxOutput).toBe("limits.max_output");
    expect(mapping.pricing).toEqual({
      input: "pricing.input_usd_per_1m",
      output: "pricing.output_usd_per_1m",
      cached: "pricing.cached_usd_per_1m",
    });
    expect(mapping.currency).toBe("USD");
  });

  it("prefers an exact top-level match over a nested alias match", () => {
    expect(detectImportMapping([{ capabilities: { vision: true }, vision: false }]).caps.vision).toBe("vision");
  });

  it("resolves nested values when building the rule body", () => {
    const mapping = detectImportMapping([nested]);
    expect(buildCatalogRuleBodyFromRaw({ provider: "acme", pattern: nested.id, raw: nested, mapping })).toEqual({
      provider: "acme",
      pattern: "nested-1",
      matchType: "exact",
      capabilities: { vision: true, pdf: false, audioInput: true, tools: true },
      contextWindow: 128000,
      maxOutput: 8192,
      pricing: { input: 0.25, output: 1.5, cached: 0.05 },
    });
  });
});
