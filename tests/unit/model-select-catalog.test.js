// Regression: the combo "Add Model" picker showed Cline's account-wide live
// catalog (hundreds of ids from api.cline.bot) instead of the provider's
// configured list (static registry + models imported via "Import from
// /models"). pickProviderCatalog now only honors live catalogs for providers
// in LIVE_CATALOG_PROVIDERS; Cline/ClinePass must resolve to the static list
// even when a caller passes live models for them.
import { describe, expect, it } from "vitest";
import { LIVE_CATALOG_PROVIDERS, pickProviderCatalog } from "../../src/shared/utils/modelSelectCatalog.js";

const staticCline = [
  { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7" },
  { id: "openai/gpt-5.4", name: "GPT-5.4" },
];

const liveClineCatalog = [
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7" },
  { id: "cline-pass/glm-5.2", name: "GLM-5.2 (ClinePass)" },
  { id: "free-model-xyz", name: "Free XYZ" },
];

const staticCursor = [
  { id: "default", name: "Auto (Server Picks)" },
];

describe("LIVE_CATALOG_PROVIDERS", () => {
  it("contains cursor only — cline/clinepass use the configured list", () => {
    expect(LIVE_CATALOG_PROVIDERS).toEqual(["cursor"]);
    expect(LIVE_CATALOG_PROVIDERS).not.toContain("cline");
    expect(LIVE_CATALOG_PROVIDERS).not.toContain("clinepass");
  });
});

describe("pickProviderCatalog", () => {
  it("ignores a live catalog for cline even when one is passed", () => {
    const result = pickProviderCatalog({
      providerId: "cline",
      liveModelsByProvider: { cline: liveClineCatalog },
      staticModels: staticCline,
    });
    expect(result).toBe(staticCline);
    expect(result.map((m) => m.id)).not.toContain("free-model-xyz");
  });

  it("ignores a live catalog for clinepass", () => {
    const staticClinepass = [{ id: "cline-pass/glm-5.2", name: "GLM-5.2 (ClinePass)" }];
    const result = pickProviderCatalog({
      providerId: "clinepass",
      liveModelsByProvider: { clinepass: liveClineCatalog },
      staticModels: staticClinepass,
    });
    expect(result).toBe(staticClinepass);
  });

  it("uses the live catalog for cursor when present", () => {
    const live = [{ id: "claude-4.6-opus-max", name: "Claude 4.6 Opus Max" }];
    const result = pickProviderCatalog({
      providerId: "cursor",
      liveModelsByProvider: { cursor: live },
      staticModels: staticCursor,
    });
    expect(result).toBe(live);
  });

  it("falls back to the static list for cursor when the live fetch is empty", () => {
    const result = pickProviderCatalog({
      providerId: "cursor",
      liveModelsByProvider: { cursor: [] },
      staticModels: staticCursor,
    });
    expect(result).toBe(staticCursor);
  });

  it("falls back to the static list when no live entry exists for cursor", () => {
    const result = pickProviderCatalog({ providerId: "cursor", staticModels: staticCursor });
    expect(result).toBe(staticCursor);
  });

  it("returns the static list for a built-in provider untouched", () => {
    const openai = [{ id: "gpt-5.4", name: "GPT-5.4" }];
    const result = pickProviderCatalog({
      providerId: "openai",
      liveModelsByProvider: { openai: liveClineCatalog },
      staticModels: openai,
    });
    expect(result).toBe(openai);
  });

  it("handles missing/undefined inputs without throwing", () => {
    expect(pickProviderCatalog({ providerId: "cline" })).toEqual([]);
    expect(pickProviderCatalog({ providerId: "cursor", liveModelsByProvider: undefined })).toEqual([]);
  });
});
