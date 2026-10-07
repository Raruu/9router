import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { FORMAT_FIELDS, readField, writeField } from "./outputCapFields.js";

// Maximum output clamp — the counterpart of minTokens.js's floor.
//
// A model's advertised `maxOutput` is the pattern's ceiling, but clients are
// free to request more (a generic client sends max_tokens: 200000 against a
// 128000 model); the upstream then rejects the request or silently truncates.
// The catalog's per-rule `clampMaxOutput` capability (and the global
// Model Catalog toggle it defaults to) lets a rule pull those too-large caps
// down to the resolved ceiling just before dispatch.
//
// Semantics: only caps the client explicitly sent are lowered. An absent cap is
// left absent — the upstream default is already within the model's limit, and
// writing one would silently LOWER the budget. The clamp only engages when a
// catalog layer (user rule, OpenRouter, hardcoded table, models.dev) explicitly
// declares maxOutput; the 64K DEFAULT_CAPABILITIES fallback must not cap a
// client that knows better. kiro/codex/cursor rebuild or strip the field
// entirely, so there is nothing to clamp for them.

/**
 * Resolve the effective output ceiling for a provider/model, or null when none
 * applies. `maxOutputClamp` is set by the capability resolver only when a
 * layer explicitly declares maxOutput and the rule (or global default) opted in.
 *
 * @param {string} provider
 * @param {string} model
 * @param {object} caps - Optional pre-resolved capabilities (avoids a second lookup).
 * @returns {number|null}
 */
export function resolveMaxOutputClamp(provider, model, caps = null) {
  const resolved = caps || getCapabilitiesForModel(provider, model);
  const ceiling = Number(resolved?.maxOutputClamp);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return null;
  return Math.floor(ceiling);
}

/**
 * Lower an explicitly-sent output cap above `ceiling`. Mutates and returns body.
 * Absent caps and values at/below the ceiling are untouched.
 *
 * @param {object} body - Request body in the target format.
 * @param {string} format - Target wire format (FORMATS.*).
 * @param {number} ceiling - Maximum output tokens.
 * @returns {number} How many fields were lowered (0 = no-op).
 */
export function applyMaxOutputClamp(body, format, ceiling) {
  if (!body || typeof body !== "object") return 0;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;
  const fields = FORMAT_FIELDS[format];
  if (!fields) return 0;

  let lowered = 0;
  for (const path of fields) {
    const current = readField(body, path);
    if (typeof current === "number" && Number.isFinite(current) && current > ceiling) {
      writeField(body, path, ceiling);
      lowered += 1;
    }
  }
  return lowered;
}
