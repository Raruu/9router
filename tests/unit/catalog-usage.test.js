import { describe, it, expect } from "vitest";
import { collectCatalogForms, partitionCatalogRules } from "../../src/shared/utils/catalogUsage.js";

const NODE = "openai-compatible-chat-88e8";
const usage = {
  nodes: [{ id: NODE, prefix: "qwen-3.8" }],
  customModels: [{ provider: NODE, pattern: "Pinned-Model" }],
  combos: [{ id: "c1", name: "Fallback", models: [`qwen-3.8/combo-model`, "anthropic/claude-x"] }],
  aliasTargets: [`QWEN-3.8/Aliased-Model`, "anthropic/other", "anthropic/glob-model-two"],
  mitmAlias: { claude: { "claude-sonnet-4-5": `${NODE}/mitm-model` } },
  userPricing: { [NODE]: { "priced-model": { input: 1 } } },
  capacityAdapter: { vision: { models: [`${NODE}/vision-model`] } },
  disabled: { [NODE]: ["disabled-model"] },
};

const rules = [
  { provider: NODE, pattern: "pinned-model" },          // pin (case-insensitive)
  { provider: NODE, pattern: "combo-model" },            // combo via prefix→id canonicalization
  { provider: NODE, pattern: "aliased-model" },          // alias target, mixed case
  { provider: NODE, pattern: "mitm-model" },             // mitm target
  { provider: NODE, pattern: "priced-model" },           // pricing override
  { provider: NODE, pattern: "vision-model" },           // capacity list
  { provider: NODE, pattern: "disabled-model" },         // disabled entry
  { provider: "anthropic", pattern: "claude-*" },        // scoped glob
  { provider: "*", pattern: "*glob-model*" },            // global glob
  { provider: NODE, pattern: "nobody-uses-me" },         // unused
  { provider: "*", pattern: "ghost-*" },                 // unused global
];

describe("catalogUsage", () => {
  it("canonicalizes prefix-scoped forms to node ids", () => {
    const forms = collectCatalogForms(usage);
    expect(forms.has(`${NODE}/combo-model`)).toBe(true);
    expect(forms.has(`qwen-3.8/combo-model`)).toBe(false);
    expect(forms.has("anthropic/claude-x")).toBe(true);
  });

  it("marks pinned or referenced rules used and the rest unused", () => {
    const { used, unused } = partitionCatalogRules(rules, usage);
    expect(used.map((r) => r.pattern)).toEqual([
      "pinned-model", "combo-model", "aliased-model", "mitm-model",
      "priced-model", "vision-model", "disabled-model", "claude-*", "*glob-model*",
    ]);
    expect(unused.map((r) => r.pattern)).toEqual(["nobody-uses-me", "ghost-*"]);
  });

  it("treats an empty usage snapshot as everything unused", () => {
    const { used, unused } = partitionCatalogRules(rules, {});
    expect(used).toEqual([]);
    expect(unused.length).toBe(rules.length);
  });

  it("a provider-scoped rule does not match another provider's model", () => {
    const { used } = partitionCatalogRules(
      [{ provider: "other-provider", pattern: "combo-model" }],
      usage,
    );
    expect(used).toEqual([]);
  });
});
