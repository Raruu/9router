// Shared request-field map for the output-cap transforms (minTokens.js floor
// and maxOutputClamp.js ceiling). A format may accept several spellings from
// different clients; both transforms walk the same list so a field one raises
// can never be invisible to the other.
export const FORMAT_FIELDS = {
  openai: ["max_tokens", "max_completion_tokens", "max_output_tokens"],
  "openai-responses": ["max_output_tokens"],
  "openai-response": ["max_output_tokens"],
  claude: ["max_tokens"],
  gemini: ["generationConfig.maxOutputTokens"],
  vertex: ["generationConfig.maxOutputTokens"],
  ollama: ["options.num_predict"],
};

export function readField(body, path) {
  if (!body || typeof body !== "object") return undefined;
  if (!path.includes(".")) return body[path];
  const [head, tail] = path.split(".", 2);
  return body[head] && typeof body[head] === "object" ? body[head][tail] : undefined;
}

export function writeField(body, path, value) {
  if (!path.includes(".")) {
    body[path] = value;
    return;
  }
  const [head, tail] = path.split(".", 2);
  body[head][tail] = value;
}
