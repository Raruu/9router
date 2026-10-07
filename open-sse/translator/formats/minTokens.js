import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { FORMAT_FIELDS, readField, writeField } from "./outputCapFields.js";

// Minimum output floor — the counterpart of maxTokens.js's ceiling.
//
// Some models spend most of their output budget on internal reasoning before
// emitting any visible text. A client-sent cap that is too small gets consumed
// during the reasoning phase and the turn comes back empty (OpenCode Free
// muse-spark below ~8k is the reported case; custom providers behave the same).
// The catalog's `minOutput` capability lets a rule raise those too-small caps
// just before dispatch, for any provider or model pattern.
//
// Semantics: only caps the client explicitly sent are raised. An absent cap is
// left absent — the upstream default may be larger than the floor, and writing
// one would silently LOWER the budget. kiro/codex/cursor rebuild or strip the
// field entirely, so there is nothing to raise for them.

/**
 * Resolve the effective floor for a provider/model, or null when none applies.
 * The floor can never exceed the model's own output ceiling: a misconfigured
 * rule must not force a cap the model cannot honor.
 *
 * @param {string} provider
 * @param {string} model
 * @param {object} caps - Optional pre-resolved capabilities (avoids a second lookup).
 * @returns {number|null}
 */
export function resolveMinOutputFloor(provider, model, caps = null) {
  const resolved = caps || getCapabilitiesForModel(provider, model);
  const floor = Number(resolved?.minOutput);
  if (!Number.isFinite(floor) || floor <= 0) return null;
  const ceiling = Number(resolved?.maxOutput);
  if (Number.isFinite(ceiling) && ceiling > 0 && floor > ceiling) return ceiling;
  return Math.floor(floor);
}

/**
 * Raise an explicitly-sent output cap below `floor`. Mutates and returns body.
 * Absent caps and values at/above the floor are untouched.
 *
 * @param {object} body - Request body in the target format.
 * @param {string} format - Target wire format (FORMATS.*).
 * @param {number} floor - Minimum output tokens.
 * @returns {number} How many fields were raised (0 = no-op).
 */
export function applyMinOutputFloor(body, format, floor) {
  if (!body || typeof body !== "object") return 0;
  if (!Number.isFinite(floor) || floor <= 0) return 0;
  const fields = FORMAT_FIELDS[format];
  if (!fields) return 0;

  let raised = 0;
  for (const path of fields) {
    const current = readField(body, path);
    if (typeof current === "number" && Number.isFinite(current) && current > 0 && current < floor) {
      writeField(body, path, floor);
      raised += 1;
    }
  }
  return raised;
}
