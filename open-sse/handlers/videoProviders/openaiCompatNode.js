// Custom OpenAI-compatible provider nodes (openai-compatible-*) — video jobs.
//
// Nararouter-shaped: creation POSTs to {base}/videos (collection root) and
// polling GETs {base}/videos/{id}. Some OpenAI-style aggregators follow xAI's
// suffix style instead, so creation carries a fallback plan for
// POST {base}/videos/generations — the core only re-sends there on 404/405,
// statuses that cannot have created a job. Same async contract as xAI: the
// upstream JSON ({ id, status, url, … }) passes through verbatim.
import { resolveCompatKindBaseUrl } from "../../config/kindEndpoints.js";

// ponytail: generations only — nararouter-style roots have no edits/extensions
// endpoints; the body's `mode` (t2v/i2v/r2v) carries the variation instead.
const SUPPORTED_ACTIONS = new Set(["generations"]);

function authHeaders(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default {
  buildRequest({ action, requestId, rawBody, contentType, credentials }) {
    const base = resolveCompatKindBaseUrl(credentials, "video");
    if (!base) return { error: "No base URL configured for this provider" };

    if (requestId) {
      return {
        method: "GET",
        url: `${base}/videos/${encodeURIComponent(requestId)}`,
        headers: authHeaders(credentials),
      };
    }
    if (!SUPPORTED_ACTIONS.has(action)) {
      return { error: `Custom video providers support 'generations' only (got '${action}')` };
    }
    const headers = { ...authHeaders(credentials), "Content-Type": contentType || "application/json" };
    return {
      method: "POST",
      url: `${base}/videos`,
      headers,
      body: rawBody,
      fallbacks: [{
        method: "POST",
        url: `${base}/videos/generations`,
        headers,
        body: rawBody,
      }],
    };
  },
};
