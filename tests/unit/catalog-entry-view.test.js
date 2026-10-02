import { describe, expect, it } from "vitest";
import { buildCatalogEntryView, entrySourceLabel, entryTypeLabel } from "../../src/shared/utils/catalogEntryView.js";

describe("catalog entry view model", () => {
  it("normalizes a user rule row", () => {
    const view = buildCatalogEntryView({
      source: "user",
      provider: "acme",
      pattern: "foo-*",
      matchType: "glob",
      name: "Foo",
      capabilities: { vision: true, contextWindow: 200000 },
      pricing: { input: 1 },
      data: { provenance: { source: "openrouter", sourceId: "x/y" } },
    });
    expect(view).toMatchObject({
      pattern: "foo-*",
      provider: "acme",
      name: "Foo",
      source: "user",
      sourceLabel: "User rule",
      typeLabel: "Ordered glob",
      pricingSource: "user catalog",
      thinkingLevels: null,
    });
    expect(view.provenance.sourceId).toBe("x/y");
  });

  it("normalizes an OpenRouter row (data-nested caps and pricing)", () => {
    const view = buildCatalogEntryView({
      source: "openrouter",
      provider: "*",
      pattern: "*claude*",
      normalizedModel: "claude",
      name: "Claude",
      fetchedAt: "2026-10-01T00:00:00.000Z",
      data: {
        capabilities: { reasoning: true, thinkingLevels: ["low", "high"] },
        pricing: { input: 3, output: 15 },
        provenance: { source: "openrouter", sourceId: "anthropic/claude", sourceIds: ["anthropic/claude", "anthropic/claude:free"], variantOnly: false },
      },
    });
    expect(view.capabilities.reasoning).toBe(true);
    expect(view.thinkingLevels).toEqual(["low", "high"]);
    expect(view.pricing).toEqual({ input: 3, output: 15 });
    expect(view.pricingSource).toBe("openrouter");
    expect(view.fetchedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("normalizes a hardcoded entry and keeps the raw row intact", () => {
    const row = {
      source: "hardcoded",
      type: "Provider exact",
      provider: "codex",
      pattern: "gpt-6.1-sol",
      matchType: "exact",
      capabilities: { reasoning: true, thinkingCanDisable: false },
      pricing: { input: 1.25 },
    };
    const view = buildCatalogEntryView(row);
    expect(view.typeLabel).toBe("Provider exact");
    expect(view.sourceLabel).toBe("Hardcoded");
    expect(view.pricingSource).toBe("builtin");
    expect(view.raw).toBe(row);
  });

  it("returns null for missing entries and tolerates empty rows", () => {
    expect(buildCatalogEntryView(null)).toBeNull();
    const view = buildCatalogEntryView({});
    expect(view.pattern).toBe("");
    expect(view.provider).toBe("*");
    expect(view.capabilities).toEqual({});
    expect(view.pricing).toBeNull();
    expect(view.provenance).toBeNull();
  });

  it("derives type and source labels without row fields", () => {
    expect(entryTypeLabel({ pattern: "*sonnet*" })).toBe("Ordered glob");
    expect(entryTypeLabel({ pattern: "claude-opus-5", matchType: "exact" })).toBe("Exact");
    expect(entryTypeLabel({ recordType: "canonical" })).toBe("Canonical exact");
    expect(entryTypeLabel({})).toBeNull();
    expect(entrySourceLabel({ source: "openrouter" })).toBe("OpenRouter");
    expect(entrySourceLabel({ source: "custom-thing" })).toBe("custom-thing");
    expect(entrySourceLabel({})).toBeNull();
  });
});
