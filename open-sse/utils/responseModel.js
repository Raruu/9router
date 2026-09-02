/**
 * Rewrite the client-facing model name on an outgoing response.
 *
 * Used when a request targeted a combo: by the time a response exists, the model
 * string is the member that actually served it (e.g. "qwen3.8-flash-free"), but
 * the client asked for the combo ("qwen-3.8"). Opt-in via the
 * `comboNameInResponse` setting.
 *
 * Only fields that ALREADY exist are rewritten — never added. A response shape
 * that carries no model name keeps carrying none, so this can be applied to any
 * body or chunk without changing its schema.
 *
 * Usage tracking, request details and logs deliberately keep the real member:
 * only the client-facing payload is touched here.
 */

// Field paths per response shape:
//   model                    OpenAI chat.completion(.chunk), Claude message, Responses
//   modelVersion             Gemini (top level)
//   response.modelVersion    Gemini (wrapped)
//   message.model            Claude message_start streaming frame
export function applyResponseModelOverride(payload, override) {
  if (!override || !payload || typeof payload !== "object") return payload;

  if (typeof payload.model === "string") payload.model = override;
  if (typeof payload.modelVersion === "string") payload.modelVersion = override;

  const response = payload.response;
  if (response && typeof response === "object" && typeof response.modelVersion === "string") {
    response.modelVersion = override;
  }

  const message = payload.message;
  if (message && typeof message === "object" && typeof message.model === "string") {
    message.model = override;
  }

  return payload;
}
