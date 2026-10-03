// Which service kinds a provider can actually serve, for the media-providers
// pages and anything else that lists providers per kind.
//
// The declared `serviceKinds` field is the primary source, but it drifts: a
// provider can gain models of a kind (or a user can add a custom model of that
// kind to any provider) without the declaration following. The media pages
// therefore list a provider when EITHER:
//   1. its registry entry declares the kind (minus hidden / hiddenKinds), or
//   2. it has a built-in model of that kind (registry models carry `kind`), or
//   3. a user-added custom model of that kind targets it.
//
// (2) and (3) mirror the /v1/models route's own matching, so the dashboard and
// the API agree on who serves what.
import { AI_PROVIDERS, getProvidersByKind } from "../constants/providers.js";
import { getModelsByProviderId, getModelKind } from "../constants/models.js";
import { COMPAT_KIND_IDS } from "open-sse/config/kindEndpoints.js";

const DEFAULT_KINDS = ["llm"];

// Media kinds a user-created compatible node can dispatch: the per-kind
// endpoints it can be pointed at (kindEndpoints). Anything outside this set has
// no compat adapter, so a compatible node can never serve it.
export const CUSTOM_CAPABLE_KINDS = new Set(COMPAT_KIND_IDS);

/** Declared kinds for a provider id/alias, defaulting to ["llm"]. */
export function declaredKinds(providerId) {
  const info = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(info?.serviceKinds) && info.serviceKinds.length > 0
    ? info.serviceKinds
    : DEFAULT_KINDS;
  return kinds;
}

/** True when a hidden/hiddenKinds entry must keep the provider off the listing. */
function isHiddenForKind(providerId, kind) {
  const info = AI_PROVIDERS[providerId];
  if (!info) return false;
  if (info.hidden) return true;
  return Array.isArray(info.hiddenKinds) && info.hiddenKinds.includes(kind);
}

/**
 * Built-in model kinds a provider declares through its model entries.
 * Unknown ids (custom nodes) have no registry models, so this is empty there.
 */
export function builtInModelKinds(providerId) {
  const kinds = new Set();
  for (const model of getModelsByProviderId(providerId)) {
    kinds.add(getModelKind(model, "llm"));
  }
  return kinds;
}

/**
 * Custom-model kinds keyed by provider alias. Custom models store the alias the
 * user typed (a compatible node's generated id, a custom-embedding prefix, or a
 * registry alias), which is not always the id the page navigates by — callers
 * pass every alias form a provider is known by.
 */
export function customModelKindsByAlias(customModels = []) {
  const byAlias = new Map();
  for (const model of customModels) {
    const alias = model?.providerAlias;
    if (typeof alias !== "string" || !alias.trim()) continue;
    const kind = model?.kind || model?.type || "llm";
    if (!byAlias.has(alias)) byAlias.set(alias, new Set());
    byAlias.get(alias).add(kind);
  }
  return byAlias;
}

/**
 * Does a user-created provider node belong on the page for `kind`?
 *
 * - custom-embedding nodes are purpose-built for embeddings, and the embedding
 *   page is where they have always been managed, so they stay listed there even
 *   before a model is added (the providers page does not list them — hiding a
 *   model-less node would make it unreachable).
 * - openai-compatible nodes can be pointed at any per-kind endpoint, but only
 *   appear once they actually carry a model of that kind, so the card never
 *   leads to an empty provider page.
 * - anthropic-compatible nodes have no media adapters and never appear.
 *
 * @param {object} node - provider node ({ id, type, prefix })
 * @param {string} kind - service kind ("image", "stt", …)
 * @param {Map<string, Set<string>>} customKindsByAlias - from customModelKindsByAlias
 * @returns {boolean}
 */
export function customNodeServesKind(node, kind, customKindsByAlias) {
  if (!node?.id || !kind) return false;
  if (node.type === "custom-embedding") return kind === "embedding";
  if (node.type !== "openai-compatible" || !CUSTOM_CAPABLE_KINDS.has(kind)) return false;
  // Custom models are keyed by the node id or by the connection prefix the
  // user typed; match either form.
  for (const alias of [node.id, node.prefix]) {
    if (alias && customKindsByAlias?.get(alias)?.has(kind)) return true;
  }
  return false;
}

/**
 * Does `providerId` serve `kind`?
 *
 * @param {string} providerId - registry id, alias, or custom node id
 * @param {string} kind - service kind ("image", "stt", …)
 * @param {{ customModels?: object[], aliases?: string[] }} [options]
 *   `aliases` lists every other form the provider is stored under (e.g. a
 *   compatible node's connection prefix alongside its generated id) so custom
 *   models keyed by either form match.
 * @returns {boolean}
 */
export function providerServesKind(providerId, kind, options = {}) {
  if (!providerId || !kind) return false;
  if (isHiddenForKind(providerId, kind)) return false;

  if (declaredKinds(providerId).includes(kind)) return true;
  if (builtInModelKinds(providerId).has(kind)) return true;

  const { customModels = [], aliases = [] } = options;
  if (customModels.length === 0) return false;
  const byAlias = customModelKindsByAlias(customModels);
  for (const alias of [providerId, ...aliases]) {
    if (byAlias.get(alias)?.has(kind)) return true;
  }
  return false;
}

// Same priority rule getProvidersByKind applies, so the merged list keeps the
// page's ordering stable.
const byPriority = (a, b) => (a.priority ?? a.mediaPriority ?? 999) - (b.priority ?? b.mediaPriority ?? 999);

/**
 * Providers to list on a media kind page: the declared ones (getProvidersByKind,
 * hidden/hiddenKinds already applied) plus any provider that gained models of
 * the kind without declaring it — built-in registry models or user-added custom
 * models. Merged in priority order.
 *
 * @returns {object[]} AI_PROVIDERS-shaped entries
 */
export function listProvidersServingKind(kind, { customModels = [] } = {}) {
  const listed = getProvidersByKind(kind);
  const seen = new Set(listed.map((provider) => provider.id));
  const extra = [];
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (seen.has(provider.id)) continue;
    const aliases = [provider.alias].filter(Boolean);
    if (providerServesKind(provider.id, kind, { customModels, aliases })) extra.push(provider);
  }
  if (extra.length === 0) return listed;
  return [...listed, ...extra].sort(byPriority);
}
