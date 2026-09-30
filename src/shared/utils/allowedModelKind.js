// Resolve the service kind of an allowedModels entry for the API-key editor.
//
// `allowedModels` is a flat list of patterns (exact ids, provider wildcards,
// globs). The key modal shows the picked entries grouped by kind, which needs
// a best-effort mapping from a stored value back to a kind:
//  - "openai/tts-1"              → tts        (built-in registry kind)
//  - "openai/tts-1/alloy"        → tts        (TTS voice suffix is dropped)
//  - "nr/gpt-image-2"            → image      (custom node, prefix → node id)
//  - "openrouter/google/veo-3.1" → video      (multi-segment model id)
//  - "oc/*", "*claude*", "gpt-4o" → null      (pattern / bare name → "Other")
import { getModelsByProviderId, getModelKind } from "../constants/models.js";
import { resolveProviderId } from "../constants/providers.js";

// Group order for the key editor: LLM first, then the media taxonomy, then the
// provider-as-model web kinds, then "other" (patterns/bare names/unknown ids).
export const ALLOWED_MODEL_GROUP_ORDER = Object.freeze([
  "llm", "embedding", "image", "imageToText", "video", "tts", "stt", "systemone", "webSearch", "webFetch", "other",
]);

/**
 * Group allowedModels values by kind, preserving list order inside each group.
 * Returns [[kind, values], …] in ALLOWED_MODEL_GROUP_ORDER order; unknown
 * kinds sort after the known ones.
 */
export function groupAllowedModelsByKind(models, resolveKind) {
  const byKind = new Map();
  for (const value of models) {
    const kind = resolveKind(value) || "other";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(value);
  }
  return [...byKind.entries()].sort(([a], [b]) => {
    const ia = ALLOWED_MODEL_GROUP_ORDER.indexOf(a);
    const ib = ALLOWED_MODEL_GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}


/**
 * How many allowedModels entries fall into each kind. Used for the per-kind
 * "Add <kind>" buttons so the user sees where the whitelist currently lives.
 * Kinds with zero entries are present with count 0; unknown kinds are ignored
 * (they only show up in the chips' "Other" group, which has no button).
 *
 * @returns {(kind: string) => number} count lookup
 */
export function countAllowedModelsByKind(models, resolveKind) {
  const counts = new Map();
  for (const [kind, values] of groupAllowedModelsByKind(models, resolveKind)) {
    counts.set(kind, values.length);
  }
  return (kind) => counts.get(kind) || 0;
}

/**
 * Build a resolver from the dashboard's connection/node/custom-model records.
 *
 * @param {object} sources
 * @param {Array} [sources.connections] - provider connections ({ provider, providerSpecificData.prefix })
 * @param {Array} [sources.nodes] - provider nodes ({ id, prefix })
 * @param {Array} [sources.customModels] - custom model records ({ providerAlias, id, type })
 * @returns {(value: string) => string|null} kind id, or null when it cannot be
 *   determined (patterns, bare names, unknown ids) — rendered under "Other".
 */
export function createAllowedModelKindResolver({ connections = [], nodes = [], customModels = [] } = {}) {
  // prefix → provider id (nodes carry it; connections mirror it for the runtime).
  const providerIdByPrefix = new Map();
  for (const node of nodes) {
    if (node?.id && typeof node.prefix === "string" && node.prefix.trim()) {
      providerIdByPrefix.set(node.prefix.trim(), node.id);
    }
  }
  for (const conn of connections) {
    const prefix = conn?.providerSpecificData?.prefix;
    if (conn?.provider && typeof prefix === "string" && prefix.trim()) {
      providerIdByPrefix.set(prefix.trim(), conn.provider);
    }
  }

  // Custom models are keyed by node id (compatible nodes) or by prefix
  // (custom-embedding nodes) — index both forms by "alias|id".
  const customKindByAliasAndId = new Map();
  for (const m of customModels) {
    if (!m?.providerAlias || !m?.id) continue;
    customKindByAliasAndId.set(`${m.providerAlias}|${m.id}`, m.type || "llm");
  }

  const lookupCustomKind = (prefix, modelId) => {
    const direct = customKindByAliasAndId.get(`${prefix}|${modelId}`);
    if (direct) return direct;
    const nodeId = providerIdByPrefix.get(prefix);
    if (nodeId) {
      const viaNode = customKindByAliasAndId.get(`${nodeId}|${modelId}`);
      if (viaNode) return viaNode;
    }
    return null;
  };

  const lookupBuiltinKind = (prefix, modelId) => {
    const providerId = resolveProviderId(prefix);
    const models = getModelsByProviderId(providerId);
    const hit = models.find((m) => (m?.id || m) === modelId);
    if (!hit) return null;
    return getModelKind(hit) || "llm";
  };

  return (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes("*")) return null; // pattern → Other

    const slash = trimmed.indexOf("/");
    if (slash === -1) return null; // bare model name → Other

    const prefix = trimmed.slice(0, slash);
    const remainder = trimmed.slice(slash + 1);
    if (!remainder) return null;

    // TTS values may carry a voice segment ("provider/model/voice"); the voice
    // is a request sub-parameter, so fall back to the model-only id.
    const candidates = [remainder];
    const lastSlash = remainder.lastIndexOf("/");
    if (lastSlash > 0) candidates.push(remainder.slice(0, lastSlash));

    for (const candidate of candidates) {
      const customKind = lookupCustomKind(prefix, candidate);
      if (customKind) return customKind;
      const builtinKind = lookupBuiltinKind(prefix, candidate);
      if (builtinKind) return builtinKind;
    }
    return null;
  };
}
