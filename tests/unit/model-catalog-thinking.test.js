import { afterEach, describe, expect, it } from "vitest";
import { THINKING_FORMATS, sanitizeCapabilities, sanitizeThinkingLevels } from "../../src/lib/modelCatalog/validation.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { setCatalogSource } from "../../open-sse/providers/capabilities.js";

// Catalog source stub mirroring runtime.js: the hand-written hardcoded block
// (passed as the third arg) merged under the user-rule result.
const sourceFor = (caps) => ({
  getCapabilities: (provider, model, hardcoded) => ({ ...(hardcoded || {}), ...caps }),
});

afterEach(() => setCatalogSource(null));

describe("thinking capability sanitization", () => {
  it("keeps thinking overrides and drops unknown formats", () => {
    expect(sanitizeCapabilities({
      vision: true,
      thinkingCanDisable: false,
      thinkingFormatOverride: "zai",
      thinkingLevels: ["low", "high", "low"],
      irrelevant: true,
    })).toEqual({
      vision: true,
      thinkingCanDisable: false,
      thinkingFormatOverride: "zai",
      thinkingLevels: ["low", "high"],
    });

    expect(sanitizeCapabilities({ thinkingFormatOverride: "not-a-format" })).toEqual({});
    expect(sanitizeCapabilities({ thinkingLevels: "high" })).toEqual({});
  });

  it("keeps the thinkingEnforce boolean and drops non-boolean values", () => {
    expect(sanitizeCapabilities({ thinkingEnforce: true })).toEqual({ thinkingEnforce: true });
    expect(sanitizeCapabilities({ thinkingEnforce: "yes" })).toEqual({});
  });

  it("bounds the level list and exports the translator's format enum", () => {
    expect(sanitizeThinkingLevels(Array.from({ length: 40 }, (_, i) => `l${i}`))).toHaveLength(16);
    expect(THINKING_FORMATS).toEqual([
      "openai", "claude-adaptive", "claude-budget", "gemini-level", "gemini-budget",
      "zai", "qwen", "kimi", "deepseek", "minimax", "hunyuan", "step",
    ]);
  });
});

describe("catalog-driven thinking levels", () => {
  it("prefers an explicit user level list and drops none when thinking is always on", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingLevels: ["none", "low", "high"],
      thinkingCanDisable: false,
    }));

    expect(getThinkingLevels("openrouter", "glm-5.3-flash")).toEqual(["low", "high"]);
  });

  it("maps a user format override to that format's level vocabulary", () => {
    // claude-sonnet-4.6 natively speaks claude-adaptive; the override swaps in
    // the zai (binary on/off) vocabulary. glm-5.3-flash would not work here —
    // its z.ai entry cannot disable thinking, so "none" is filtered out.
    setCatalogSource(sourceFor({ reasoning: true, thinkingFormatOverride: "zai" }));

    expect(getThinkingLevels("openrouter", "claude-sonnet-4.6")).toEqual(["none", "thinking"]);
  });

  it("returns null when the model cannot reason", () => {
    setCatalogSource(sourceFor({ reasoning: false, thinkingLevels: ["low"] }));

    expect(getThinkingLevels("openrouter", "glm-5.3-flash")).toBeNull();
  });
});

describe("catalog-driven thinking wire format", () => {
  it("lets an explicit override beat the provider registry format", () => {
    setCatalogSource(sourceFor({ reasoning: true, thinkingFormatOverride: "zai" }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "level", level: "high" });

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("keeps the registry format when no override is set", () => {
    setCatalogSource(sourceFor({ reasoning: true, thinkingFormat: "zai" }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "level", level: "high" });

    expect(body.reasoning_effort).toBe("high");
    expect(body.thinking).toBeUndefined();
  });
});

describe("enforced thinking level (thinkingEnforce)", () => {
  // A user rule may assert its endpoint accepts the level verbatim. Without it,
  // "none" is clamped to minimal when thinkingCanDisable:false, and format
  // maps rewrite levels (deepseek low→high, kimi xhigh→max, …).

  it("sends none verbatim on effort wires instead of clamping to minimal", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingFormatOverride: "openai",
      thinkingCanDisable: false,
      thinkingEnforce: true,
    }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "none" });

    expect(body.reasoning_effort).toBe("none");
  });

  it("keeps clamping when the rule does not enforce", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingFormatOverride: "openai",
      thinkingCanDisable: false,
    }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "none" });

    expect(body.reasoning_effort).toBe("minimal");
  });

  it("passes levels through without the format's own remap", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingFormatOverride: "deepseek",
      thinkingEnforce: true,
    }));
    const body = { model: "glm-5.3-flash", messages: [] };

    // Canonical deepseek would rewrite low→high and xhigh→max.
    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "level", level: "low" });
    expect(body.reasoning_effort).toBe("low");
  });

  it("writes none verbatim to the claude-adaptive effort field", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingFormatOverride: "claude-adaptive",
      thinkingCanDisable: false,
      thinkingEnforce: true,
    }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "none" });

    expect(body.output_config).toEqual({ effort: "none" });
  });

  it("writes none verbatim to the gemini-level field", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingFormatOverride: "gemini-level",
      thinkingEnforce: true,
    }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "none" });

    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "none", includeThoughts: false });
  });

  it("leaves budget wires on their canonical disable (no level string exists)", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingFormatOverride: "claude-budget",
      thinkingCanDisable: true,
      thinkingEnforce: true,
    }));
    const body = { model: "glm-5.3-flash", messages: [] };

    applyThinking("openai", "glm-5.3-flash", body, "openrouter", { mode: "none" });

    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("keeps none in the advertised levels even when thinking cannot be disabled", () => {
    setCatalogSource(sourceFor({
      reasoning: true,
      thinkingLevels: ["none", "low", "high"],
      thinkingCanDisable: false,
      thinkingEnforce: true,
    }));

    expect(getThinkingLevels("openrouter", "glm-5.3-flash")).toEqual(["none", "low", "high"]);
  });
});
