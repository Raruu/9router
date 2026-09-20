import { describe, expect, it } from "vitest";
import { providerDisplayLabel, providerModelTag } from "../../open-sse/utils/providerLabel.js";

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

describe("providerModelTag", () => {
  it("tags a compatible node with its prefix instead of the generated id", () => {
    expect(providerModelTag("anthropic-compatible-21e3714a-fa4b-4f78-8685-b113805ded1e", { prefix: "hcnsec" }, "kimi-k3"))
      .toBe("hcnsec/kimi-k3");
  });

  it("falls back to provider/model when no prefix is present", () => {
    expect(providerModelTag("openai", null, "gpt-5.5")).toBe("openai/gpt-5.5");
    expect(providerModelTag("openai", {}, "gpt-5.5")).toBe("openai/gpt-5.5");
  });
});
