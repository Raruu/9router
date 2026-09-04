// Provider icon paths under /public/providers.
// Alias related brands; session-cache 404s so one miss never spams again.

const ICON_ALIASES = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
  "ollama-search": "ollama",
};

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set();

function normalizeId(providerId) {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve icon file id (after alias). Empty if previously failed this session. */
export function resolveProviderIconId(providerId) {
  const id = normalizeId(providerId);
  if (!id) return "";
  if (failedIds.has(id)) return "";
  const aliased = ICON_ALIASES[id] || id;
  if (failedIds.has(aliased)) return "";
  return aliased;
}

/** `/providers/{id}.png` or null when previously failed. */
export function getProviderIconSrc(providerId) {
  return srcForFileId(resolveProviderIconId(providerId));
}

function srcForFileId(fileId) {
  return fileId && !failedIds.has(fileId) ? `/providers/${fileId}.png` : null;
}

// Prefixes for the user-created compatible provider nodes. Inlined as literals
// (not imported from constants/providers.js) on purpose: that module pulls the
// full provider registry, and ProviderIcon is used on the public landing page,
// which must stay registry-free.
const OPENAI_COMPATIBLE = "openai-compatible";
const ANTHROPIC_COMPATIBLE = "anthropic-compatible";

/**
 * Icon src for a provider id that may be a user-created compatible node.
 * Those ids embed their api type (`openai-compatible-chat-<uuid>` /
 * `openai-compatible-responses-<uuid>`, see /api/provider-nodes POST) and no
 * registry entry exists for them, so plain getProviderIconSrc always 404s.
 * apiType overrides the id-derived value when the caller already knows it.
 * custom-embedding-* has no icon asset and keeps the text fallback.
 */
export function getProviderIconSrcForId(providerId, apiType) {
  const id = typeof providerId === "string" ? providerId : "";
  if (id.startsWith(ANTHROPIC_COMPATIBLE)) return srcForFileId("anthropic-m");
  if (id.startsWith(OPENAI_COMPATIBLE)) {
    const type = apiType || (id.startsWith(`${OPENAI_COMPATIBLE}-responses`) ? "responses" : "chat");
    return srcForFileId(type === "responses" ? "oai-r" : "oai-cc");
  }
  return getProviderIconSrc(providerId);
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId) {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}
