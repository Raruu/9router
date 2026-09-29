// Video provider adapters.
//
// Default (no adapter) = xAI shape: raw body forwarded to {baseUrl}/{action},
// polled at {baseUrl}/{id}, upstream JSON passed through verbatim.
// A provider only needs an adapter when its wire format differs from that.
import openrouter from "./openrouter.js";
import vertex from "./vertex.js";
import openaiCompatNode from "./openaiCompatNode.js";

const ADAPTERS = { openrouter, vertex };

export function getVideoAdapter(provider) {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  // Custom OpenAI-compatible nodes: nararouter-shaped root with an xAI-suffix
  // fallback (see the adapter for the 404/405 retry contract).
  if (provider?.startsWith?.("openai-compatible-")) return openaiCompatNode;
  return null;
}
