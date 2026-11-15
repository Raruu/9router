// How a custom OpenAI-compatible provider expects thinking control on Chat
// Completions. The default (no value) keeps the model/provider-native format
// resolved by thinkingUnified.applyThinking. Endpoints that reject the generic
// `thinking` field can opt into a top-level `reasoning_effort` or a nested
// `reasoning.effort` instead.
export const THINKING_PARAM_VALUES = Object.freeze(["reasoning_effort", "reasoning.effort"]);

export const THINKING_PARAM_OPTIONS = Object.freeze([
  { value: "", label: "Default (auto)" },
  { value: "reasoning_effort", label: "reasoning_effort" },
  { value: "reasoning.effort", label: "reasoning.effort" },
]);

export function isValidThinkingParam(value) {
  return value === undefined
    || value === null
    || value === ""
    || THINKING_PARAM_VALUES.includes(value);
}

// Empty/null clear the override; unknown values are rejected by the API route.
export function normalizeThinkingParam(value) {
  return THINKING_PARAM_VALUES.includes(value) ? value : null;
}
