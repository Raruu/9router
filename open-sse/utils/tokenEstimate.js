// Rough prompt-size estimation for routing decisions (combo context-fit).
// No tokenizer dependency: JSON-stringify the whole request body (works for
// every client shape — OpenAI messages, Claude messages, Responses input,
// Gemini contents) and count CJK codepoints as ~1 token each, the rest at
// ~4 chars/token. The same heuristic family as estimateQoderPromptTokens and
// capacityAdapter's CHARS_PER_TOKEN, kept here so the combo path can reuse it
// without importing a provider-specific module.

const CJK_RE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;
const CHARS_PER_TOKEN = 4;

// Base64 payloads (images/audio/files) inflate JSON length without inflating
// token count proportionally — a 1MB screenshot is ~200 tokens to a vision
// model, not ~250K. Collapse each data-URI body to a fixed placeholder so the
// estimate tracks text, not bytes. Placeholder is deliberately tiny.
const DATA_URI_RE = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]+/gi;
const DATA_URI_PLACEHOLDER = "data:image/placeholder;base64,AA";

// Headroom multiplier applied to the estimate before comparing against a
// member's context window: the estimate is approximate, and the response
// needs room too. Matches QODER_CONTEXT_TIER_HEADROOM.
export const CONTEXT_FIT_HEADROOM = 0.15;

/**
 * Estimate the prompt token count of a request body.
 * @param {object} body - client request body in any supported format
 * @returns {number} estimated prompt tokens (0 for unusable input)
 */
export function estimateRequestTokens(body) {
  if (!body || typeof body !== "object") return 0;
  let text;
  try {
    text = JSON.stringify(body);
  } catch {
    return 0;
  }
  if (!text) return 0;
  text = text.replace(DATA_URI_RE, DATA_URI_PLACEHOLDER);
  const cjk = (text.match(CJK_RE) || []).length;
  return Math.ceil(cjk + (text.length - cjk) / CHARS_PER_TOKEN);
}

/**
 * Token budget a request needs from a member's context window: estimate plus
 * headroom. Shared so the reorder predicate and tests agree on one formula.
 * @param {number} estimatedTokens
 * @returns {number}
 */
export function contextFitBudget(estimatedTokens) {
  return Math.ceil((estimatedTokens || 0) * (1 + CONTEXT_FIT_HEADROOM));
}
