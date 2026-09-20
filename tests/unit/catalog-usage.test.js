import { describe, it, expect } from "vitest";
import {
  bindingKey,
  clearScopeRules,
  summarizeClearRules,
} from "../../src/shared/utils/catalogUsage.js";

const rules = [
  { provider: "acme", pattern: "pinned-model" },   // bound (below, mixed case)
  { provider: "acme", pattern: "exact-model" },
  { provider: "acme", pattern: "combo-*" },
  { provider: "*", pattern: "global-*" },
];
const pins = [{ provider: "ACME", pattern: "Pinned-Model" }];

describe("summarizeClearRules", () => {
  it("splits rules by pattern shape and binding", () => {
    const summary = summarizeClearRules(rules, pins);
    expect(summary.all.rules).toHaveLength(4);
    expect(summary.all.bound.map((r) => r.pattern)).toEqual(["pinned-model"]);
    expect(summary.all.unbound.map((r) => r.pattern)).toEqual(["exact-model", "combo-*", "global-*"]);
    expect(summary.glob.rules.map((r) => r.pattern)).toEqual(["combo-*", "global-*"]);
    expect(summary.glob.bound).toEqual([]);
    expect(summary.exact.rules.map((r) => r.pattern)).toEqual(["pinned-model", "exact-model"]);
    expect(summary.exact.bound.map((r) => r.pattern)).toEqual(["pinned-model"]);
  });

  it("matches bindings case-insensitively", () => {
    expect(bindingKey("ACME", "Pinned-Model")).toBe(bindingKey("acme", "pinned-model"));
    const summary = summarizeClearRules([{ provider: "AcMe", pattern: "PINNED-model" }], pins);
    expect(summary.all.bound).toHaveLength(1);
  });

  it("treats an empty rule list as nothing to clear", () => {
    const summary = summarizeClearRules([], []);
    expect(summary.all).toEqual({ rules: [], bound: [], unbound: [] });
    expect(clearScopeRules(summary, "all", true)).toEqual([]);
  });

  it("ignores non-user pins by key shape", () => {
    // A pin without a usable shape still cannot match a rule.
    const summary = summarizeClearRules(rules, [{ provider: "acme", pattern: "other-*" }]);
    expect(summary.all.bound).toEqual([]);
  });
});

describe("clearScopeRules", () => {
  it("keeps bound rules unless includeBound is set", () => {
    const summary = summarizeClearRules(rules, pins);
    expect(clearScopeRules(summary, "all", false).map((r) => r.pattern)).toEqual(["exact-model", "combo-*", "global-*"]);
    expect(clearScopeRules(summary, "all", true).map((r) => r.pattern)).toEqual(["pinned-model", "exact-model", "combo-*", "global-*"]);
  });

  it("scopes by pattern shape", () => {
    const summary = summarizeClearRules(rules, pins);
    expect(clearScopeRules(summary, "glob", false).map((r) => r.pattern)).toEqual(["combo-*", "global-*"]);
    expect(clearScopeRules(summary, "exact", false).map((r) => r.pattern)).toEqual(["exact-model"]);
    expect(clearScopeRules(summary, "exact", true).map((r) => r.pattern)).toEqual(["pinned-model", "exact-model"]);
  });

  it("falls back to the full set for an unknown scope", () => {
    const summary = summarizeClearRules(rules, pins);
    expect(clearScopeRules(summary, "nope", true)).toHaveLength(4);
  });
});
