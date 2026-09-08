import { describe, expect, it } from "vitest";
import {
  catalogPatternOptions,
  catalogRefKey,
  filterCatalogPatternOptions,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/catalogPatternOptions.js";

describe("custom model catalog pattern options", () => {
  const catalog = {
    userDefined: [{ provider: "acme", pattern: "opaque-model", name: "Opaque" }],
    openrouter: { models: [{ pattern: "*claude-sonnet*", name: "Claude Sonnet" }] },
    hardcoded: [{ provider: "*", pattern: "*gemini*", type: "Pattern" }],
  };

  it("projects every catalog source into a stable live reference", () => {
    const options = catalogPatternOptions(catalog);

    expect(options.map((option) => option.ref)).toEqual([
      { source: "user", provider: "acme", pattern: "opaque-model" },
      { source: "openrouter", provider: "*", pattern: "*claude-sonnet*" },
      { source: "hardcoded", provider: "*", pattern: "*gemini*" },
    ]);
    expect(options[1].key).toBe(catalogRefKey(options[1].ref));
  });

  it("filters the autocomplete by source, provider, name, and pattern", () => {
    const options = catalogPatternOptions(catalog);

    expect(filterCatalogPatternOptions(options, "openrouter")).toHaveLength(1);
    expect(filterCatalogPatternOptions(options, "acme")).toHaveLength(1);
    expect(filterCatalogPatternOptions(options, "Claude Sonnet")).toHaveLength(1);
    expect(filterCatalogPatternOptions(options, "*gemini*")).toHaveLength(1);
    expect(filterCatalogPatternOptions(options, "missing")).toEqual([]);
  });
});
