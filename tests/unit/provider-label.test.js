import { describe, expect, it } from "vitest";
import { providerDisplayLabel } from "../../open-sse/utils/providerLabel.js";

describe("providerDisplayLabel", () => {
  it("prefers a trimmed connection prefix over the generated provider id", () => {
    expect(providerDisplayLabel("openai-compatible-chat-88e8", { prefix: "qwen-3.8" })).toBe("qwen-3.8");
    expect(providerDisplayLabel("openai-compatible-chat-88e8", { prefix: "  my-node  " })).toBe("my-node");
  });

  it("falls back to the raw provider id when no usable prefix is present", () => {
    expect(providerDisplayLabel("anthropic", {})).toBe("anthropic");
    expect(providerDisplayLabel("anthropic", null)).toBe("anthropic");
    expect(providerDisplayLabel("anthropic", undefined)).toBe("anthropic");
    expect(providerDisplayLabel("anthropic", { prefix: "" })).toBe("anthropic");
    expect(providerDisplayLabel("anthropic", { prefix: "   " })).toBe("anthropic");
    expect(providerDisplayLabel("anthropic", { prefix: 42 })).toBe("anthropic");
  });
});
