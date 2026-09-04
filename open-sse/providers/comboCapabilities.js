// Combo capability resolution — merged limits/modalities for a combo, derived
// from its members. Lives here rather than in the /v1/models route so a second
// consumer (the dashboard's model detail endpoint) can reuse it without
// importing that route's provider connections and live-catalog resolvers.

import { DEFAULT_CAPABILITIES, getCapabilitiesForModel } from "./capabilities.js";

// Combos can list other combos as members, so resolution recurses. The cap is
// a guard against a pathological chain, not a supported nesting depth.
export const MAX_COMBO_NESTING_DEPTH = 5;

/**
 * Split a combo member string into the provider id + model id capabilities are
 * keyed by. Returns null when the member carries no model to read limits from.
 *
 * Members are stored as the model picker's `{prefix}/{model}` strings, where the
 * prefix may be a connection's custom prefix, the provider's static alias, or
 * the raw provider id — `ctx.providerIdByPrefix` maps all three back to an id.
 *
 * @param {string} member
 * @param {{ providerIdByPrefix: Map<string,string>, modelAliases?: object, comboByName: Map<string,object> }} ctx
 * @returns {{ providerId: string, modelId: string, fullModel: string } | null}
 */
export function resolveComboMember(member, ctx) {
  if (typeof member !== "string") return null;
  const fullModel = member.trim();
  if (!fullModel || !fullModel.includes("/")) return null;

  const separator = fullModel.indexOf("/");
  const prefix = fullModel.slice(0, separator);
  const modelId = fullModel.slice(separator + 1).trim();
  if (!modelId) return null;

  return {
    providerId: ctx.providerIdByPrefix?.get(prefix) || prefix,
    modelId,
    fullModel,
  };
}

export function comboMemberCapabilities(member, ctx, depth, visited) {
  if (typeof member !== "string") return null;
  let fullModel = member.trim();
  if (!fullModel) return null;

  // A bare member is a nested combo or a model alias — routing resolves it in
  // that order (getModelInfo checks combos before aliases), so match it here.
  // Anything else bare is a provider-as-model entry with no member model to
  // read limits from, so it contributes nothing.
  if (!fullModel.includes("/")) {
    const nested = ctx.comboByName.get(fullModel);
    if (nested) return comboCapabilities(nested, ctx, depth + 1, visited);
    const resolved = ctx.modelAliases?.[fullModel];
    if (typeof resolved !== "string" || !resolved.includes("/")) return null;
    fullModel = resolved;
  }

  const parsed = resolveComboMember(fullModel, ctx);
  if (!parsed) return null;

  return getCapabilitiesForModel(parsed.providerId, parsed.modelId);
}

// Merged capabilities for one combo, recursing into combo members. `visited`
// tracks the current chain only (removed on the way out), so a combo reached
// twice by different paths still contributes — only a cycle is cut.
export function comboCapabilities(combo, ctx, depth = 0, visited = new Set()) {
  if (depth >= MAX_COMBO_NESTING_DEPTH) return null;
  const name = typeof combo?.name === "string" ? combo.name : null;
  if (name !== null) {
    if (visited.has(name)) return null;
    visited.add(name);
  }
  try {
    const memberCapabilities = (combo?.models || [])
      .map((member) => comboMemberCapabilities(member, ctx, depth, visited))
      .filter(Boolean);
    return mergeMemberCapabilities(memberCapabilities, ctx?.comboLimitStrategy);
  } finally {
    if (name !== null) visited.delete(name);
  }
}

// null means "no clamp", so a member without a range constrains nothing; the
// combo's range spans every member that does clamp.
function unionThinkingRanges(ranges) {
  const bounded = ranges.filter((r) => Number.isFinite(r?.min) && Number.isFinite(r?.max));
  if (bounded.length === 0) return null;
  return {
    min: Math.min(...bounded.map((r) => r.min)),
    max: Math.max(...bounded.map((r) => r.max)),
  };
}

// A combo is named after the model it is built to serve, and auto-switch floats
// the member that fits the request to the front, so it advertises what its BEST
// member delivers: booleans union, limits take the maximum. Intersecting
// instead lets one small text-only fallback erase the headline model's window —
// a glm-5.3-flash combo reported 200k/no-vision because two of its seven
// members were plain GLM-5.2.
//
// The tradeoff: a prompt sized for the best member hard-fails if routing falls
// through to a smaller one. Fallback is by availability, so keep members within
// a comparable size class. The `comboLimitStrategy` setting (dashboard →
// Combos) lets the user flip the numeric limits to the smallest member instead,
// so clients sizing prompts off context_length never over-fill a fallback.
// Limits-only by design: AND-ing booleans would recreate the masked-vision bug
// above, and `tools` defaults true so intersection could zero out tool calling.
export function mergeMemberCapabilities(memberCapabilities, limitStrategy = "max") {
  if (memberCapabilities.length === 0) return null;

  // A budget range only means something alongside the format it belongs to, so
  // it survives merging only when every member speaks the same one.
  const formats = memberCapabilities.map((caps) => caps.thinkingFormat);
  const sharesThinkingFormat = formats.every((format) => format === formats[0]);

  const merged = {};
  for (const key of Object.keys(DEFAULT_CAPABILITIES)) {
    const values = memberCapabilities.map((caps) => caps[key]);
    if (key === "contextWindow" || key === "maxOutput") {
      const numbers = values.filter((value) => Number.isFinite(value));
      if (numbers.length === 0) {
        merged[key] = DEFAULT_CAPABILITIES[key];
      } else {
        merged[key] = limitStrategy === "min" ? Math.min(...numbers) : Math.max(...numbers);
      }
    } else if (key === "thinkingRange") {
      merged[key] = sharesThinkingFormat ? unionThinkingRanges(values) : null;
    } else if (values.every((value) => typeof value === "boolean")) {
      merged[key] = values.some((value) => value === true);
    } else if (values.every((value) => value === values[0])) {
      merged[key] = values[0];
    } else {
      // Members disagree (e.g. different thinkingFormat) — no single answer
      // holds for the whole combo, so fall back to the neutral default.
      merged[key] = DEFAULT_CAPABILITIES[key];
    }
  }
  return merged;
}
