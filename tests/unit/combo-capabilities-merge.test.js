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

// Members chosen so the windows actually differ (glm-5.3-flash 1M/131072,
// gpt-5.4 400k/128000, glm-5.3-free + glm-5.2 1M/128000); expectations are
// computed from the live tables so table drift cannot silently vacuous-ify
// the direction assertions — the guard fails loudly if they ever converge.
const MEMBERS = ["vs-llm/glm-5.3-flash", "openai/gpt-5.4", "nara-router/glm-5.3-free"];

describe("combo capability merge", () => {
  it("reports the largest member window, not the smallest", () => {
    const memberCaps = MEMBERS.map(caps);
    const windows = memberCaps.map((c) => c.contextWindow);
    expect(new Set(windows).size).toBeGreaterThan(1);

    const merged = mergeMemberCapabilities(memberCaps);
    expect(merged.contextWindow).toBe(Math.max(...windows));
    expect(merged.maxOutput).toBe(Math.max(...memberCaps.map((c) => c.maxOutput)));
  });

  it("reports the smallest member window under the min strategy", () => {
    const memberCaps = MEMBERS.map(caps);

    const merged = mergeMemberCapabilities(memberCaps, "min");
    expect(merged.contextWindow).toBe(Math.min(...memberCaps.map((c) => c.contextWindow)));
    expect(merged.maxOutput).toBe(Math.min(...memberCaps.map((c) => c.maxOutput)));
  });

  it("keeps booleans unioned under the min strategy — limits only, by design", () => {
    const merged = mergeMemberCapabilities(
      [
        caps("vs-llm/glm-5.3-flash"),     // multimodal, tools, reasoning
        caps("cbai/glm-5.2"),             // text-only
      ],
      "min",
    );

    expect(merged.vision).toBe(true);
    expect(merged.pdf).toBe(true);
    expect(merged.tools).toBe(true);
    expect(merged.reasoning).toBe(true);
  });

  it("falls back to max for anything that is not \"min\"", () => {
    const memberCaps = MEMBERS.map(caps);
    for (const strategy of [undefined, null, "", "MAX", "bogus"]) {
      expect(mergeMemberCapabilities(memberCaps, strategy).contextWindow).toBe(
        mergeMemberCapabilities(memberCaps, "max").contextWindow,
      );
    }
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
