// Registry kind coverage — a provider's declared serviceKinds must cover every
// kind its own models carry.
//
// The dashboard's media pages (and the /v1/models kind passes) list providers by
// serviceKinds, so a model with a kind its provider does not declare is
// invisible everywhere it should appear: OpenRouter's image models had an
// imageConfig, an adapter and four models, yet no "image" serviceKind — the
// Text to Image page never showed it. This test pins the invariant and the
// three registry fixes that restored it (openrouter image, nvidia stt,
// runwayml video).
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";

const KIND_OF = (model) => model?.kind || model?.type || "llm";

// Every kind a model entry can carry. LLM is excluded: it is the implicit
// default and providers may legitimately serve chat without declaring it.
const MODEL_KINDS = [
  "embedding", "image", "imageToText", "tts", "stt",
  "webSearch", "webFetch", "video", "music", "systemone",
];

const modelsOf = (entry) =>
  PROVIDER_MODELS[entry.alias || entry.id] || PROVIDER_MODELS[entry.uiAlias] || [];

describe("registry kind coverage", () => {
  it("every model kind a provider carries is declared in its serviceKinds", () => {
    const offenders = [];
    for (const entry of REGISTRY) {
      const declared = entry.serviceKinds ?? ["llm"];
      for (const kind of MODEL_KINDS) {
        if (declared.includes(kind)) continue;
        if (modelsOf(entry).some((m) => KIND_OF(m) === kind)) {
          offenders.push(`${entry.id}: model kind "${kind}" not in serviceKinds`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("openrouter declares image (config + adapter + models were already wired)", () => {
    const entry = REGISTRY.find((e) => e.id === "openrouter");
    expect(entry.serviceKinds).toContain("image");
    expect(PROVIDER_MEDIA.openrouter.imageConfig).toBeTruthy();
    expect(PROVIDER_MODELS.openrouter.some((m) => KIND_OF(m) === "image")).toBe(true);
  });

  it("nvidia declares stt and carries a self-hosted Riva sttConfig", () => {
    const entry = REGISTRY.find((e) => e.id === "nvidia");
    expect(entry.serviceKinds).toContain("stt");
    // The hosted API has no ASR route — the config targets a self-hosted Riva
    // NIM, so authType must stay "apikey" for the per-connection baseUrl
    // override to exist at all.
    expect(entry.sttConfig).toMatchObject({ format: "nvidia-asr", authType: "apikey" });
    expect(entry.sttConfig.baseUrl).toContain("localhost:9000");
  });

  it("runwayml declares video and exposes a videoConfig", () => {
    const entry = REGISTRY.find((e) => e.id === "runwayml");
    expect(entry.serviceKinds).toContain("video");
    expect(entry.videoConfig?.baseUrl).toBe("https://api.dev.runwayml.com/v1");
  });

  it("the fixed providers are listed by getProvidersByKind", () => {
    expect(getProvidersByKind("image").some((p) => p.id === "openrouter")).toBe(true);
    expect(getProvidersByKind("stt").some((p) => p.id === "nvidia")).toBe(true);
    expect(getProvidersByKind("video").some((p) => p.id === "runwayml")).toBe(true);
  });

  it("hidden and hiddenKinds still gate the listing", () => {
    // huggingface declares stt but hides tts; hidden providers stay out of the
    // kind listing even though their models would otherwise qualify.
    const hidden = REGISTRY.filter((e) => e.hidden).map((e) => e.id);
    for (const id of hidden) {
      const kinds = AI_PROVIDERS[id]?.serviceKinds ?? ["llm"];
      for (const kind of kinds) {
        expect(getProvidersByKind(kind).some((p) => p.id === id), `${id} must not be listed for ${kind}`).toBe(false);
      }
    }
    const hf = REGISTRY.find((e) => e.id === "huggingface");
    expect(hf.hiddenKinds).toContain("tts");
    expect(getProvidersByKind("tts").some((p) => p.id === "huggingface")).toBe(false);
  });
});
