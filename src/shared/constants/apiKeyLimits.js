// Per-API-key access rules. `limitType` selects which usage counter is enforced —
// a zero limit always means "no limit" for that counter, and `either` trips on
// whichever limit is reached first.
export const API_KEY_LIMIT_TYPES = ["none", "tokens", "requests", "either"];

export const API_KEY_LIMIT_TYPE_LABELS = {
  none: "No limit",
  tokens: "Token limit",
  requests: "Request limit",
  either: "Token or request limit",
};

export function normalizeLimitType(value) {
  return API_KEY_LIMIT_TYPES.includes(value) ? value : "none";
}

export function normalizeAllowedModels(value) {
  if (!Array.isArray(value)) return null;
  const list = value.map((m) => String(m).trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

export function normalizeLimitValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Returns the tripped-limit message, or null when the key may proceed.
export function checkApiKeyLimit({ limitType, tokenLimit, usedTokens, requestLimit, usedRequests }) {
  const type = normalizeLimitType(limitType);
  if (type === "none") return null;

  const tokensUsed = Number(usedTokens) || 0;
  const tokensMax = Number(tokenLimit) || 0;
  const requestsUsed = Number(usedRequests) || 0;
  const requestsMax = Number(requestLimit) || 0;
  const tokensHit = tokensMax > 0 && tokensUsed >= tokensMax;
  const requestsHit = requestsMax > 0 && requestsUsed >= requestsMax;

  if ((type === "tokens" || type === "either") && tokensHit) {
    return `Token limit exceeded for this API key (${tokensUsed.toLocaleString()} / ${tokensMax.toLocaleString()} tokens used)`;
  }
  if ((type === "requests" || type === "either") && requestsHit) {
    return `Request limit exceeded for this API key (${requestsUsed.toLocaleString()} / ${requestsMax.toLocaleString()} requests used)`;
  }
  return null;
}
