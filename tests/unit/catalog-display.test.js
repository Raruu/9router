import { describe, it, expect } from "vitest";
import { buildCatalogProviderLabel } from "../../src/shared/utils/catalogDisplay.js";

describe("buildCatalogProviderLabel", () => {
  const label = buildCatalogProviderLabel([
    { id: "openai-compatible-chat-88e8", prefix: "qwen-3.8" },
    { id: "anthropic-compatible-chat-abc", prefix: " my-node " },
    { id: "openai-compatible-chat-noPrefix", prefix: "" },
  ]);

  it("maps custom node ids to their prefixes and trims", () => {
    expect(label("openai-compatible-chat-88e8")).toBe("qwen-3.8");
    expect(label("anthropic-compatible-chat-abc")).toBe("my-node");
  });

  it("matches node ids case-insensitively", () => {
    expect(label("OpenAI-Compatible-Chat-88E8")).toBe("qwen-3.8");
  });

  it("passes through non-node scopes unchanged", () => {
    expect(label("*")).toBe("*");
    expect(label("anthropic")).toBe("anthropic");
    expect(label("openai-compatible-chat-noPrefix")).toBe("openai-compatible-chat-noPrefix");
    expect(label(undefined)).toBe("");
  });

  it("empty node list keeps scopes raw", () => {
    expect(buildCatalogProviderLabel([])("openai-compatible-chat-x")).toBe("openai-compatible-chat-x");
  });
});
