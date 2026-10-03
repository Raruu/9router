// providerServesKind / listProvidersServingKind — who appears on a media kind
// page. The declared serviceKinds is the primary source, but providers gain
// models of a kind without the declaration following (or users add custom media
// models to any provider), so the listing must union three sources.
import { describe, expect, it } from "vitest";
import {
  declaredKinds,
  builtInModelKinds,
  customModelKindsByAlias,
  providerServesKind,
  listProvidersServingKind,
} from "../../src/shared/utils/providerKinds.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const custom = (providerAlias, type) => ({ providerAlias, id: `m-${type}`, type });

describe("declaredKinds", () => {
  it("reads the registry declaration and defaults to llm", () => {
    expect(declaredKinds("openrouter")).toContain("image");
    // A provider with no serviceKinds is chat-only.
    expect(declaredKinds("byteplus")).toEqual(["llm"]);
    expect(declaredKinds("not-a-provider")).toEqual(["llm"]);
  });
});

describe("builtInModelKinds", () => {
  it("collects the kinds of a provider's registry models", () => {
    const kinds = builtInModelKinds("runwayml");
    expect(kinds.has("image")).toBe(true);
    expect(kinds.has("video")).toBe(true);
  });
});

describe("customModelKindsByAlias", () => {
  it("groups custom models by alias", () => {
    const map = customModelKindsByAlias([custom("nr", "image"), custom("nr", "stt"), custom("glm", "stt")]);
    expect([...map.get("nr")].sort()).toEqual(["image", "stt"]);
    expect([...map.get("glm")]).toEqual(["stt"]);
  });
});

describe("providerServesKind", () => {
  it("accepts a declared kind", () => {
    expect(providerServesKind("openrouter", "image")).toBe(true);
    expect(providerServesKind("nvidia", "stt")).toBe(true);
    expect(providerServesKind("runwayml", "video")).toBe(true);
  });

  it("accepts an undeclared kind carried by registry models", () => {
    // The drift this helper exists for: models of a kind with no declaration.
    // Patch the declaration away and confirm the model path still answers.
    const info = AI_PROVIDERS.runwayml;
    const saved = info.serviceKinds;
    info.serviceKinds = ["image"];
    try {
      expect(declaredKinds("runwayml")).not.toContain("video");
      expect(providerServesKind("runwayml", "video")).toBe(true);
      expect(listProvidersServingKind("video").map((p) => p.id)).toContain("runwayml");
    } finally {
      info.serviceKinds = saved;
    }
  });

  it("accepts a kind present only on a user-added custom model", () => {
    const customModels = [custom("openai", "stt")];
    // openai declares stt too, so use a chat-only provider to isolate the path.
    const chatOnly = [custom("byteplus", "stt")];
    expect(providerServesKind("byteplus", "stt", { customModels })).toBe(false);
    expect(providerServesKind("byteplus", "stt", { customModels: chatOnly })).toBe(true);
  });

  it("matches custom models through alternate aliases", () => {
    // Compatible nodes store custom models under the generated node id, while
    // the page may navigate by the connection prefix (or vice versa).
    const customModels = [custom("node-123", "image")];
    expect(providerServesKind("node-123", "image", { customModels })).toBe(true);
    expect(providerServesKind("openai-compatible-chat-node-123", "image", {
      customModels,
      aliases: ["node-123"],
    })).toBe(true);
  });

  it("honours hiddenKinds and hidden", () => {
    expect(providerServesKind("huggingface", "tts")).toBe(false); // hiddenKinds
    expect(providerServesKind("coqui", "tts")).toBe(false); // hidden provider
  });

  it("rejects unknown providers and kinds", () => {
    expect(providerServesKind("nope", "image")).toBe(false);
    expect(providerServesKind("openrouter", "bogus-kind")).toBe(false);
    expect(providerServesKind("", "image")).toBe(false);
  });
});

describe("listProvidersServingKind", () => {
  it("lists the declared providers for a kind", () => {
    const ids = listProvidersServingKind("video").map((p) => p.id);
    expect(ids).toContain("openrouter");
    expect(ids).toContain("vertex");
    expect(ids).toContain("runwayml");
  });

  it("adds a chat provider that only gained a custom media model", () => {
    const before = listProvidersServingKind("stt").map((p) => p.id);
    expect(before).not.toContain("byteplus");

    const after = listProvidersServingKind("stt", { customModels: [custom("byteplus", "stt")] }).map((p) => p.id);
    expect(after).toContain("byteplus");
    // Priority sort keeps the list ordered by the providers' own priority.
    const priorities = listProvidersServingKind("stt", { customModels: [custom("byteplus", "stt")] })
      .map((p) => p.priority ?? p.mediaPriority ?? 999);
    expect([...priorities]).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("keeps hidden providers and hiddenKinds out", () => {
    expect(listProvidersServingKind("tts").map((p) => p.id)).not.toContain("huggingface");
    expect(listProvidersServingKind("tts").map((p) => p.id)).not.toContain("coqui");
  });
});
