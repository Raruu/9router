import { describe, expect, it } from "vitest";

import { comboEffortTiers, mergeEffortTiers } from "../../open-sse/providers/comboCapabilities.js";
import { applyThinking, clampLevelToSupport } from "../../open-sse/translator/concerns/thinkingUnified.js";

// A combo mixing a flagship (xhigh) with a smaller fallback (high-only) must
// still advertise the thinking option above high — the serving member clamps
// each request to what it accepts (see clampLevelToSupport below).
const XHIGH_MEMBER = "openai/gpt-5.4"; // ["none","minimal","low","medium","high","xhigh"]
const HIGH_MEMBER = "qwen/qwen3-max"; // ["none","low","medium","high"]

const ctx = (names, strategy) => ({
  providerIdByPrefix: new Map([["openai", "openai"], ["qwen", "qwen"]]),
  modelAliases: {},
  comboByName: new Map(names.map((name) => [name, { name, models: [] }])),
  comboEffortStrategy: strategy,
});

const combo = (name, models) => ({ name, models });

describe("mergeEffortTiers", () => {
  it("unions member levels by default", () => {
    expect(mergeEffortTiers([
      ["none", "minimal", "low", "medium", "high", "xhigh"],
      ["none", "low", "medium", "high"],
    ])).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("intersects under the intersection strategy", () => {
    expect(mergeEffortTiers([
      ["none", "minimal", "low", "medium", "high", "xhigh"],
      ["none", "low", "medium", "high"],
    ], "intersection")).toEqual(["none", "low", "medium", "high"]);
  });

  it("defaults to union for missing or bogus strategies", () => {
    const lists = [["none", "high"], ["none", "low", "high", "xhigh"]];
    for (const strategy of [undefined, null, "", "bogus"]) {
      expect(mergeEffortTiers(lists, strategy)).toEqual(mergeEffortTiers(lists, "union"));
    }
  });

  it("returns canonically ordered tiers regardless of input order", () => {
    expect(mergeEffortTiers([["xhigh", "high", "none"]])).toEqual(["none", "high", "xhigh"]);
  });

  it("returns null when nothing is left (empty lists or no overlap)", () => {
    expect(mergeEffortTiers([])).toBeNull();
    expect(mergeEffortTiers([[], []])).toBeNull();
    expect(mergeEffortTiers([["high"], ["low"]], "intersection")).toBeNull();
  });
});

describe("comboEffortTiers", () => {
  it("unions member levels by default, keeping xhigh from the flagship", () => {
    const tiers = comboEffortTiers(
      combo("mix", [XHIGH_MEMBER, HIGH_MEMBER]),
      ctx([]),
    );
    expect(tiers).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("intersects when the effort strategy is intersection", () => {
    const tiers = comboEffortTiers(
      combo("mix", [XHIGH_MEMBER, HIGH_MEMBER]),
      ctx([], "intersection"),
    );
    expect(tiers).toEqual(["none", "low", "medium", "high"]);
  });

  it("resolves aliases and nested combos, skipping unresolvable members", () => {
    const nested = combo("inner", [HIGH_MEMBER]);
    const tiers = comboEffortTiers(combo("outer", ["inner", "alias-x", "bogus", "provider-only"]), {
      providerIdByPrefix: new Map([["openai", "openai"], ["qwen", "qwen"]]),
      modelAliases: { "alias-x": XHIGH_MEMBER },
      comboByName: new Map([["inner", nested]]),
    });
    expect(tiers).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("returns null when no member reports levels", () => {
    expect(comboEffortTiers(combo("empty", ["bogus"]), ctx([]))).toBeNull();
    expect(comboEffortTiers(combo("empty", []), ctx([]))).toBeNull();
  });
});

describe("clampLevelToSupport", () => {
  const level = (l) => ({ mode: "level", level: l });

  it("leaves supported levels untouched", () => {
    expect(clampLevelToSupport(level("xhigh"), ["none", "low", "high", "xhigh"])).toEqual(level("xhigh"));
  });

  it("falls back to the highest available when the request exceeds support", () => {
    expect(clampLevelToSupport(level("xhigh"), ["none", "low", "medium", "high"]))
      .toEqual(level("high"));
    expect(clampLevelToSupport(level("max"), ["none", "low", "medium", "high"]))
      .toEqual(level("high"));
  });

  it("falls back to the nearest supported level when the request undercuts support", () => {
    expect(clampLevelToSupport(level("low"), ["none", "high", "max"])).toEqual(level("high"));
  });

  it("never upgrades a disable and never touches auto", () => {
    expect(clampLevelToSupport(level("none"), ["high"])).toEqual(level("none"));
    expect(clampLevelToSupport({ mode: "auto" }, ["high"])).toEqual({ mode: "auto" });
  });

  it("leaves the request alone when support is unknown or unranked", () => {
    expect(clampLevelToSupport(level("xhigh"), null)).toEqual(level("xhigh"));
    expect(clampLevelToSupport(level("xhigh"), [])).toEqual(level("xhigh"));
    expect(clampLevelToSupport(level("xhigh"), ["none", "thinking"])).toEqual(level("xhigh"));
    expect(clampLevelToSupport(level("budget-x"), ["none", "low", "high"])).toEqual(level("budget-x"));
  });

  it("ignores non-level configs", () => {
    expect(clampLevelToSupport({ mode: "budget", budget: 128000 }, ["none", "high"]))
      .toEqual({ mode: "budget", budget: 128000 });
    expect(clampLevelToSupport(null, ["high"])).toBeNull();
  });
});

describe("applyThinking member clamp", () => {
  it("clamps xhigh to high on a high-only member instead of sending it upstream", () => {
    // tokenrouter passes reasoning_effort through verbatim, so a qwen member
    // (topping out at high) would receive a level it rejects without the clamp.
    const body = {};
    applyThinking("openai", "qwen3-max", body, "tokenrouter", { mode: "level", level: "xhigh" });
    expect(body.reasoning_effort).toBe("high");
  });

  it("leaves mapping formats alone — kimi still translates xhigh to max", () => {
    const body = {};
    applyThinking("openai", "kimi-k2.7", body, "kimchi", { mode: "level", level: "xhigh" });
    expect(body.reasoning_effort).toBe("max");
  });

  it("passes xhigh through on a member that supports it", () => {
    const body = {};
    applyThinking("openai", "gpt-5.4", body, "openai", { mode: "level", level: "xhigh" });
    expect(body.reasoning_effort).toBe("xhigh");
  });
});
