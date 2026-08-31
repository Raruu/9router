import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { mergeMemberCapabilities } from "../../src/app/api/v1/models/route.js";

// A combo advertises what its BEST member delivers. Merging conservatively
// (min limits / AND booleans) let one small text-only fallback erase the
// headline model's window: a glm-5.3-flash combo carrying two plain GLM-5.2
// members reported 200k + vision:false instead of the 1M multimodal window
// every glm-5.3-flash member actually has.
const caps = (fullModel) => {
  const slash = fullModel.indexOf("/");
  return getCapabilitiesForModel(fullModel.slice(0, slash), fullModel.slice(slash + 1));
};

describe("combo capability merge", () => {
  it("reports the largest member window, not the smallest", () => {
    const merged = mergeMemberCapabilities([
      caps("vs-llm/glm-5.3-flash"),      // 1M / 131072
      caps("nara-router/glm-5.3-free"),  // 200k / 128000, text-only
      caps("cbai/glm-5.2"),              // 200k / 128000, text-only
    ]);

    expect(merged.contextWindow).toBe(1000000);
    expect(merged.maxOutput).toBe(131072);
  });

  it("unions modalities so a multimodal member is not masked by a text-only one", () => {
    const merged = mergeMemberCapabilities([
      caps("vs-llm/glm-5.3-flash"),
      caps("cbai/glm-5.2"),
    ]);

    expect(merged).toMatchObject({
      vision: true,
      pdf: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "zai",
    });
  });

  it("keeps thinking disableable when any member can turn it off", () => {
    const merged = mergeMemberCapabilities([
      caps("nara-router/glm-5.3-flash-free"), // thinkingCanDisable: false
      caps("vs-llm/glm-5.3-flash"),           // thinkingCanDisable: true
    ]);

    expect(merged.thinkingCanDisable).toBe(true);
  });

  it("spans the widest thinking budget when members share a format", () => {
    const merged = mergeMemberCapabilities([
      { ...caps("gemini/gemini-2.5-pro"), thinkingRange: { min: 128, max: 8192 } },
      { ...caps("gemini/gemini-2.5-pro"), thinkingRange: { min: 0, max: 24576 } },
    ]);

    expect(merged.thinkingRange).toEqual({ min: 0, max: 24576 });
  });

  it("drops the thinking range when members speak different formats", () => {
    const merged = mergeMemberCapabilities([
      caps("vs-llm/glm-5.3-flash"),          // zai
      caps("gemini/gemini-2.5-pro"),         // gemini-budget
    ]);

    expect(merged.thinkingRange).toBeNull();
    expect(merged.thinkingFormat).toBeNull();
  });

  it("returns null for a combo with no resolvable members", () => {
    expect(mergeMemberCapabilities([])).toBeNull();
  });
});
