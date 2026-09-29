// Per-kind upstream endpoints for custom (openai-compatible) provider nodes.
//
// A node's main baseUrl serves chat. Some providers host media on a different
// origin — e.g. nararouter: chat/embeddings/systemone on router.bynara.id/v1,
// images/videos on api-images.bynara.id/v1. The node's optional `kindBaseUrls`
// map (mirrored onto each connection's providerSpecificData) carries those
// overrides; a kind without an entry falls back to the main baseUrl. The path
// stays canonical per kind, so only the host/base changes.

export const COMPAT_KIND_ENDPOINTS = Object.freeze({
  embedding: "/embeddings",
  image: "/images/generations",
  tts: "/audio/speech",
  stt: "/audio/transcriptions",
  video: "/videos",
  systemone: "/systemone",
});

export const COMPAT_KIND_IDS = Object.freeze(Object.keys(COMPAT_KIND_ENDPOINTS));

const OPENAI_COMPAT_PREFIX = "openai-compatible-";

/** True for custom OpenAI-compatible provider nodes (the id prefix is the discriminator). */
export function isCompatNodeProvider(provider) {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPAT_PREFIX);
}

function stripTrailingSlashes(value) {
  return String(value).trim().replace(/\/+$/, "");
}

/**
 * Normalize one kind's base URL: trim, drop trailing slashes, and strip a
 * pasted full endpoint path (`…/v1/images/generations` → `…/v1`) so the
 * canonical path is not appended twice at request time. Unknown kinds → "".
 */
export function sanitizeKindBaseUrl(kind, value) {
  if (typeof value !== "string") return "";
  const path = COMPAT_KIND_ENDPOINTS[kind];
  if (!path) return "";
  let out = stripTrailingSlashes(value);
  if (out.endsWith(path)) out = stripTrailingSlashes(out.slice(0, -path.length));
  return out;
}

/** Sanitize a kindBaseUrls map: known kinds with non-empty values only. */
export function sanitizeKindBaseUrls(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const kind of COMPAT_KIND_IDS) {
    const value = sanitizeKindBaseUrl(kind, input[kind]);
    if (value) out[kind] = value;
  }
  return out;
}

/**
 * Base URL for one kind on a custom node: kindBaseUrls[kind] when set, else the
 * connection's main baseUrl.
 *
 * @param {object} credentials - connection credentials ({ providerSpecificData: { baseUrl, kindBaseUrls } })
 * @param {string} kind - one of COMPAT_KIND_IDS
 * @param {{fallback?: string}} [options] - value returned when neither is configured
 * @returns {string} base URL without trailing slash ("" when none configured)
 */
export function resolveCompatKindBaseUrl(credentials, kind, options = {}) {
  const specific = credentials?.providerSpecificData || {};
  const overrides = specific.kindBaseUrls;
  const override = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides[kind] : null;
  const raw = (typeof override === "string" && override.trim()) ? override : specific.baseUrl;
  const base = (typeof raw === "string" && raw.trim()) ? sanitizeKindBaseUrl(kind, raw) : "";
  if (base) return base;
  return options.fallback ? stripTrailingSlashes(options.fallback) : "";
}

/**
 * Full upstream URL for one kind on a custom node (base + canonical path), or
 * "" when no base URL is configured.
 */
export function buildCompatKindUrl(credentials, kind, options = {}) {
  const base = resolveCompatKindBaseUrl(credentials, kind, options);
  if (!base) return "";
  return `${base}${COMPAT_KIND_ENDPOINTS[kind]}`;
}
