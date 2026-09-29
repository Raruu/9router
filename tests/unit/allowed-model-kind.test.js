// Allowed-model → kind resolution for the API-key editor's grouped chips.
//
// Covers the static registry lookup (including multi-segment ids like
// "openrouter/google/veo-3.1" and TTS voice suffixes), custom provider nodes
// (models registered under the node id for compatible nodes, under the prefix
// for custom-embedding nodes), and the null cases that render under "Other".
import { describe, it, expect } from "vitest";
import {
  createAllowedModelKindResolver,
  groupAllowedModelsByKind,
  countAllowedModelsByKind,
  ALLOWED_MODEL_GROUP_ORDER,
} from "../../src/shared/utils/allowedModelKind.js";

const NODE_ID = "openai-compatible-chat-abc123";

const resolver = () => createAllowedModelKindResolver({
  connections: [
    { provider: NODE_ID, providerSpecificData: { prefix: "nr" } },
    { provider: "custom-embedding-xyz", providerSpecificData: { prefix: "my-embed" } },
  ],
  nodes: [
    { id: NODE_ID, prefix: "nr" },
    { id: "custom-embedding-xyz", prefix: "my-embed" },
  ],
  customModels: [
    { providerAlias: NODE_ID, id: "gpt-image-2", type: "image" },
    { providerAlias: NODE_ID, id: "jev", type: "systemone" },
    { providerAlias: "my-embed", id: "bge-large", type: "embedding" },
  ],
});

describe("createAllowedModelKindResolver — built-in models", () => {
  const resolve = resolver();

  it("maps chat models to llm", () => {
    expect(resolve("openai/gpt-4o")).toBe("llm");
    expect(resolve("anthropic/claude-sonnet-4-20250514")).toBe("llm");
  });

  it("maps media models to their registry kind", () => {
    expect(resolve("openai/tts-1")).toBe("tts");
    expect(resolve("openai/whisper-1")).toBe("stt");
    expect(resolve("openai/text-embedding-3-small")).toBe("embedding");
    expect(resolve("openai/gpt-image-2.5")).toBe("image");
  });

  it("maps video models with multi-segment ids", () => {
    expect(resolve("openrouter/google/veo-3.1")).toBe("video");
    expect(resolve("xai/grok-imagine-video")).toBe("video");
  });

  it("maps systemone models", () => {
    expect(resolve("opencode-zen/jev-1.13")).toBe("systemone");
  });

  it("strips a TTS voice suffix before lookup", () => {
    // The request sends "openai/tts-1/alloy"; the whitelist names the model.
    expect(resolve("openai/tts-1/alloy")).toBe("tts");
  });
});

describe("createAllowedModelKindResolver — custom nodes", () => {
  const resolve = resolver();

  it("resolves a compatible node's model by its display prefix", () => {
    expect(resolve("nr/gpt-image-2")).toBe("image");
    expect(resolve("nr/jev")).toBe("systemone");
  });

  it("resolves a custom-embedding node's model (registered under the prefix)", () => {
    expect(resolve("my-embed/bge-large")).toBe("embedding");
  });

  it("returns null for an unregistered model on a known node", () => {
    expect(resolve("nr/unknown-model")).toBeNull();
  });
});

describe("createAllowedModelKindResolver — Other bucket", () => {
  const resolve = resolver();

  it.each([
    ["wildcard prefix", "oc/*"],
    ["glob", "*claude*"],
    ["bare model name", "gpt-4o"],
    ["empty", ""],
    ["non-string", 42],
    ["provider only", "openai/"],
  ])("returns null for %s", (_label, value) => {
    expect(resolve(value)).toBeNull();
  });
});

describe("groupAllowedModelsByKind", () => {
  const resolve = resolver();

  it("groups LLM first, then media kinds in taxonomy order, then Other", () => {
    const models = ["oc/*", "openai/tts-1", "openai/gpt-4o", "openai/gpt-image-2.5", "nr/jev"];
    const groups = groupAllowedModelsByKind(models, resolve);
    expect(groups.map(([kind]) => kind)).toEqual(["llm", "image", "tts", "systemone", "other"]);
    expect(groups[0][1]).toEqual(["openai/gpt-4o"]);
    expect(groups.at(-1)[1]).toEqual(["oc/*"]);
  });

  it("preserves insertion order inside a group", () => {
    const groups = groupAllowedModelsByKind(["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"], resolve);
    expect(groups).toEqual([["llm", ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"]]]);
  });

  it("lists every kind in the documented order constant", () => {
    expect(ALLOWED_MODEL_GROUP_ORDER[0]).toBe("llm");
    expect(ALLOWED_MODEL_GROUP_ORDER.at(-1)).toBe("other");
  });

  it("returns an empty list for no models", () => {
    expect(groupAllowedModelsByKind([], resolve)).toEqual([]);
  });
});

describe("countAllowedModelsByKind", () => {
  const resolve = resolver();

  it("counts each kind's entries (the per-button badge)", () => {
    const count = countAllowedModelsByKind(
      ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514", "openai/tts-1", "nr/gpt-image-2", "oc/*"],
      resolve,
    );
    expect(count("llm")).toBe(2);
    expect(count("tts")).toBe(1);
    expect(count("image")).toBe(1);
    expect(count("other")).toBe(1);
  });

  it("returns 0 for kinds with no entries, including kinds absent from the list", () => {
    const count = countAllowedModelsByKind(["openai/gpt-4o"], resolve);
    expect(count("systemone")).toBe(0);
    expect(count("video")).toBe(0);
  });

  it("returns 0 for every kind on an empty list", () => {
    const count = countAllowedModelsByKind([], resolve);
    expect(count("llm")).toBe(0);
    expect(count("other")).toBe(0);
  });

  it("counts TTS voice-suffixed values under tts", () => {
    const count = countAllowedModelsByKind(["openai/tts-1/alloy"], resolve);
    expect(count("tts")).toBe(1);
    expect(count("other")).toBe(0);
  });
});
