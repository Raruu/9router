// Kind filtering for the shared model picker (ModelSelectModal).
//
// The picker is used by three families of callers:
//  - combo editors (kindFilter = combo kind, or null for LLM)
//  - media provider pages (kindFilter = the page's kind)
//  - API-key permission editors (kindFilter = the clicked "Add <kind>" button)
//
// Extracted from ModelSelectModal so the rules are testable without rendering.
import { CUSTOM_MODEL_TYPES, EXPOSABLE_NON_LLM_KINDS, getModelKind } from "@/shared/constants/models.js";

// Kinds whose membership is decided by a per-model type/kind field.
// NOTE: video and systemone belong here too — when they were absent, a
// kindFilter of "video"/"systemone" fell through and returned every model,
// LLM entries included.
export const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText", "video", "systemone"]);

// Kinds where the provider IS the model (no per-model selection needed).
export const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);

// For these kinds, providers without hardcoded models can still be picked
// (provider-as-model fallback, value = provider alias).
export const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

// The LLM sentinel — the picker's default when no kind is given.
export const LLM_PICKER_KIND = "llm";

/**
 * Filter a provider's models[] for one kind.
 *
 * @param {Array} models
 * @param {string|null} kind - null/"llm" = the LLM view
 * @param {{strict?: boolean}} [options] - strict excludes custom entries whose
 *   kind is explicitly non-LLM even in the LLM view. The key-permission picker
 *   uses it so a key's LLM tab never mixes in typed custom models; combo
 *   editors keep the permissive behavior (a typed custom model may still be a
 *   valid chat target there).
 */
export function filterModelsForKind(models, kind, options = {}) {
  const list = Array.isArray(models) ? models : [];
  const strict = options.strict === true;

  if (!kind || kind === LLM_PICKER_KIND) {
    return list.filter((m) => {
      if (m.isPlaceholder) return true;
      const modelKind = getModelKind(m);
      // No explicit kind → treated as LLM (legacy/custom rows).
      if (!modelKind || modelKind === LLM_PICKER_KIND) return true;
      // Explicit non-LLM kind. Permissive callers keep custom entries (a
      // typed custom model may still be a valid chat target); strict callers
      // drop every non-LLM model, static or custom, so the LLM tab stays
      // LLM-only.
      return strict ? false : !!m.isCustom;
    });
  }

  if (!TYPED_KINDS.has(kind)) return list;
  return list.filter((m) => m.isPlaceholder || getModelKind(m) === kind);
}

// Kinds offered by the API-key permission picker (one "Add <kind>" button
// each): LLM first, then the exact non-LLM taxonomy the "Also expose in
// /v1/models" checkboxes use (ModelsExposureCard). Keeping both lists on the
// same constant means a kind can never be selectable for exposure but not for
// key permissions. Web kinds and music are deliberately absent (provider-as-
// model entries: a bare provider name can be typed into the pattern input).
export const KEY_PICKER_KINDS = Object.freeze([
  ...CUSTOM_MODEL_TYPES.filter((t) => t.id === LLM_PICKER_KIND),
  ...EXPOSABLE_NON_LLM_KINDS,
].map(({ id, label, icon }) => ({ id, label, icon })));
