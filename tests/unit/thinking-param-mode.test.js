// Per-custom-provider thinking-control wire shape. Some OpenAI-compatible
// endpoints reject the generic `thinking` field and demand `reasoning_effort`
// (top-level) or `reasoning.effort` (nested) instead.
import { describe, it, expect } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const PROVIDER = "openai-compatible-chat-amd";
const MODEL = "DeepSeek-V4.1-Flash";

function bodyWith(thinking) {
  return {
    model: `${PROVIDER}/${MODEL}`,
    messages: [{ role: "user", content: "hi" }],
    ...(thinking ? { thinking } : {}),
  };
}

describe("custom-provider thinking parameter", () => {
  it("keeps today's behavior when no override is configured", () => {
    const out = applyThinking("openai", MODEL, bodyWith({ type: "enabled", budget_tokens: 10000 }), PROVIDER);
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
  });

  it("emits only reasoning_effort for an explicit level", () => {
    const out = applyThinking(
      "openai", MODEL, bodyWith({ type: "enabled" }), PROVIDER,
      { mode: "level", level: "high" }, "reasoning_effort",
    );
    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("emits only reasoning.effort for an explicit level", () => {
    const out = applyThinking(
      "openai", MODEL, bodyWith({ type: "enabled" }), PROVIDER,
      { mode: "level", level: "high" }, "reasoning.effort",
    );
    expect(out.reasoning).toEqual({ effort: "high" });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  it("maps a Claude budget to a reasoning_effort level", () => {
    const out = applyThinking(
      "openai", MODEL, bodyWith({ type: "enabled", budget_tokens: 10000 }), PROVIDER,
      undefined, "reasoning_effort",
    );
    expect(out.reasoning_effort).toBe("medium");
    expect(out.thinking).toBeUndefined();
  });

  it("carries an explicit disable as none", () => {
    const out = applyThinking(
      "openai", MODEL, bodyWith({ type: "disabled" }), PROVIDER,
      undefined, "reasoning.effort",
    );
    expect(out.reasoning).toEqual({ effort: "none" });
    expect(out.thinking).toBeUndefined();
  });

  it("omits both fields for auto so the upstream default applies", () => {
    const out = applyThinking(
      "openai", MODEL, bodyWith({ type: "enabled" }), PROVIDER,
      undefined, "reasoning_effort",
    );
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  it("clamps max/ultra to the model's advertised levels", () => {
    const out = applyThinking(
      "openai", "gpt-5", bodyWith({ type: "enabled" }), PROVIDER,
      { mode: "level", level: "max" }, "reasoning_effort",
    );
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("ignores the override for Responses and Claude targets", () => {
    const responses = applyThinking(
      "openai-responses", "gpt-5", bodyWith({ type: "enabled" }), PROVIDER,
      { mode: "level", level: "high" }, "reasoning.effort",
    );
    // Default Responses handling wins: top-level reasoning_effort, no nested object.
    expect(responses.reasoning_effort).toBe("high");
    expect(responses.reasoning).toBeUndefined();

    const claude = applyThinking(
      "claude", "claude-sonnet-5", bodyWith({ type: "enabled" }), "claude",
      { mode: "level", level: "high" }, "reasoning_effort",
    );
    expect(claude.reasoning_effort).toBeUndefined();
    expect(claude.thinking).toBeDefined();
  });

  it("works through translateRequest", () => {
    const out = translateRequest(
      "openai", "openai", MODEL, bodyWith({ type: "enabled", budget_tokens: 10000 }),
      true, null, PROVIDER, null, [], null, null, "reasoning.effort",
    );
    expect(out.reasoning).toEqual({ effort: "medium" });
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });
});
