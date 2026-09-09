import { describe, expect, it } from "vitest";
import { normalizeOpenRouterModelId, normalizeOpenRouterModels } from "../../src/lib/modelCatalog/normalize.js";

describe("OpenRouter model normalization", () => {
  it("strips vendor and variant suffixes and prefers the unsuffixed base", () => {
    expect(normalizeOpenRouterModelId("Acme/Foo-Bar:free")).toBe("foo-bar");
    const rows = normalizeOpenRouterModels({ data: [
      {
        id: "acme/foo:free", name: "Foo Free", context_length: 1000,
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" },
      },
      {
        id: "acme/foo", name: "Foo", context_length: 2000,
        top_provider: { max_completion_tokens: 300 },
        architecture: { input_modalities: ["text"], output_modalities: ["text", "audio"] },
        supported_parameters: ["reasoning"],
        pricing: { prompt: "0.000002", completion: "0.000004", input_cache_read: "0.000001" },
      },
    ] }, "2026-01-01T00:00:00.000Z");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pattern: "*foo*", normalizedModel: "foo", sourceId: "acme/foo" });
    expect(rows[0].data.capabilities).toMatchObject({ vision: false, audioOutput: true, tools: false, reasoning: true, contextWindow: 2000, maxOutput: 300 });
    expect(rows[0].data.pricing).toEqual({ input: 2, output: 4, cached: 1 });
  });

  it("keeps variant capabilities but omits variant-only price and limits", () => {
    const [row] = normalizeOpenRouterModels({ data: [{
      id: "acme/bar:free", context_length: 999,
      top_provider: { max_completion_tokens: 111 },
      architecture: { input_modalities: ["text", "pdf"], output_modalities: ["text"] },
      pricing: { prompt: "0", completion: "-1" },
    }] });
    expect(row.data.capabilities).toMatchObject({ pdf: true });
    expect(row.data.capabilities).not.toHaveProperty("contextWindow");
    expect(row.data.capabilities).not.toHaveProperty("maxOutput");
    expect(row.data.pricing).toBeUndefined();
    expect(row.data.provenance.variantOnly).toBe(true);
  });
});
