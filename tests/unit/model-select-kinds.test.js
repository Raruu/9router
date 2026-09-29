// Kind filtering rules for the shared model picker (ModelSelectModal) and the
// tab list the API-key permission editor uses. Regression guards for the two
// bugs that made non-LLM selection impossible: video/systemone fell through
// the typed filter (returning every model, LLM included), and the key picker's
// LLM view mixed in typed custom models.
import { describe, it, expect } from "vitest";
import {
  TYPED_KINDS,
  PROVIDER_AS_MODEL_KINDS,
  ALLOW_PROVIDER_FALLBACK_KINDS,
  KEY_PICKER_KINDS,
  filterModelsForKind,
} from "../../src/shared/constants/modelSelectKinds.js";
import { EXPOSABLE_NON_LLM_KINDS } from "../../src/shared/constants/models.js";

const MODELS = [
  { id: "gpt-4o" },                                        // no kind → LLM
  { id: "gpt-4o-mini", kind: "llm" },                      // explicit LLM
  { id: "tts-1", kind: "tts" },
  { id: "whisper-1", kind: "stt" },
  { id: "text-embedding-3-small", kind: "embedding" },
  { id: "gpt-image-2.5", kind: "image" },
  { id: "grok-imagine-video", kind: "video" },
  { id: "jev-1.13", kind: "systemone" },
  { id: "claude-vision", kind: "imageToText" },
  { id: "user-typed-image", kind: "image", isCustom: true },
  { id: "user-plain", isCustom: true },
];

describe("TYPED_KINDS", () => {
  it("covers every kind the custom-model taxonomy can route", () => {
    for (const kind of ["image", "tts", "stt", "embedding", "imageToText", "video", "systemone"]) {
      expect(TYPED_KINDS.has(kind), `missing ${kind}`).toBe(true);
    }
  });

  it("keeps the provider-as-model web kinds out of the typed set", () => {
    expect(TYPED_KINDS.has("webSearch")).toBe(false);
    expect(TYPED_KINDS.has("webFetch")).toBe(false);
    expect(PROVIDER_AS_MODEL_KINDS.has("webSearch")).toBe(true);
    expect(PROVIDER_AS_MODEL_KINDS.has("webFetch")).toBe(true);
  });

  it("allows provider-as-model fallback only for tts/image/webFetch", () => {
    expect([...ALLOW_PROVIDER_FALLBACK_KINDS].sort()).toEqual(["image", "tts", "webFetch"]);
  });
});

describe("filterModelsForKind — typed kinds", () => {
  it("keeps only the requested kind (video no longer leaks LLM)", () => {
    expect(filterModelsForKind(MODELS, "video").map((m) => m.id)).toEqual(["grok-imagine-video"]);
  });

  it("systemone no longer leaks LLM either", () => {
    expect(filterModelsForKind(MODELS, "systemone").map((m) => m.id)).toEqual(["jev-1.13"]);
  });

  it.each([
    ["image", ["gpt-image-2.5", "user-typed-image"]],
    ["tts", ["tts-1"]],
    ["stt", ["whisper-1"]],
    ["embedding", ["text-embedding-3-small"]],
    ["imageToText", ["claude-vision"]],
  ])("%s keeps its models (custom included)", (kind, expected) => {
    expect(filterModelsForKind(MODELS, kind).map((m) => m.id)).toEqual(expected);
  });

  it("always keeps placeholders so an empty provider stays selectable", () => {
    const withPlaceholder = [...MODELS, { id: "__placeholder__x", isPlaceholder: true }];
    expect(filterModelsForKind(withPlaceholder, "tts").map((m) => m.id)).toEqual(["tts-1", "__placeholder__x"]);
  });

  it("passes unknown kinds through untouched (web kinds are provider-as-model)", () => {
    expect(filterModelsForKind(MODELS, "webSearch")).toHaveLength(MODELS.length);
  });
});

describe("filterModelsForKind — LLM view", () => {
  it("permissive (combo editors): keeps custom entries of any kind", () => {
    const ids = filterModelsForKind(MODELS, null).map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("user-plain");
    // A typed custom model may still be a valid chat target in a combo.
    expect(ids).toContain("user-typed-image");
    // Static media models never appear in the LLM view.
    expect(ids).not.toContain("tts-1");
    expect(ids).not.toContain("grok-imagine-video");
  });

  it("strict (key editor): drops typed custom models so the tab stays LLM-only", () => {
    const ids = filterModelsForKind(MODELS, null, { strict: true }).map((m) => m.id);
    expect(ids).toEqual(["gpt-4o", "gpt-4o-mini", "user-plain"]);
  });

  it('treats "llm" and null identically', () => {
    expect(filterModelsForKind(MODELS, "llm", { strict: true })).toEqual(
      filterModelsForKind(MODELS, null, { strict: true }),
    );
  });

  it("tolerates a non-array input", () => {
    expect(filterModelsForKind(null, "image")).toEqual([]);
  });
});

describe("KEY_PICKER_KINDS", () => {
  it("offers LLM first, then exactly the exposable non-LLM kinds", () => {
    expect(KEY_PICKER_KINDS.map((k) => k.id)).toEqual([
      "llm", "embedding", "image", "imageToText", "tts", "stt", "video", "systemone",
    ]);
  });

  it("mirrors EXPOSABLE_NON_LLM_KINDS so exposure and key permissions cannot drift", () => {
    expect(KEY_PICKER_KINDS.slice(1)).toEqual(
      EXPOSABLE_NON_LLM_KINDS.map(({ id, label, icon }) => ({ id, label, icon })),
    );
  });

  it("carries labels and icons for every button", () => {
    for (const tab of KEY_PICKER_KINDS) {
      expect(typeof tab.label).toBe("string");
      expect(tab.label.length).toBeGreaterThan(0);
      expect(typeof tab.icon).toBe("string");
    }
  });

  it("excludes music and the web kinds (no route / no model id) and has no duplicates", () => {
    const ids = KEY_PICKER_KINDS.map((k) => k.id);
    expect(ids).not.toContain("music");
    expect(ids).not.toContain("webSearch");
    expect(ids).not.toContain("webFetch");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
