// Import directly from file to avoid pulling in server-side dependencies via index.js
export {
  PROVIDER_MODELS,
  getProviderModels,
  getDefaultModel,
  isValidModel as isValidModelCore,
  findModelName,
  getModelTargetFormat,
  getModelStrip,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  getModelUpstreamId,
  getModelQuotaFamily
} from "open-sse/config/providerModels.js";

import { AI_PROVIDERS, isOpenAICompatibleProvider } from "./providers.js";
import { PROVIDER_MODELS as MODELS } from "open-sse/config/providerModels.js";

// Providers that accept any model (passthrough)
const PASSTHROUGH_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.passthroughModels)
    .map(([key]) => key)
);

// Wrap isValidModel with passthrough providers
export function isValidModel(aliasOrId, modelId) {
  if (isOpenAICompatibleProvider(aliasOrId)) return true;
  if (PASSTHROUGH_PROVIDERS.has(aliasOrId)) return true;
  const models = MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS = Object.entries(MODELS).flatMap(([alias, models]) =>
  models.map(m => ({ provider: alias, model: m.id, name: m.name }))
);

export const getModelKind = (m, fallback = null) => m?.kind || m?.type || fallback;

// Capacity metadata for UI badges — icon + label + color per capability.
export const CAPACITY_META = {
  vision: { icon: "visibility", label: "Vision", desc: "Supports image input", color: "text-blue-500" },
  pdf: { icon: "picture_as_pdf", label: "PDF", desc: "Supports PDF input", color: "text-red-500" },
  audioInput: { icon: "mic", label: "Audio input", desc: "Supports audio input", color: "text-violet-500" },
  videoInput: { icon: "videocam", label: "Video input", desc: "Supports video input", color: "text-fuchsia-500" },
  imageOutput: { icon: "add_photo_alternate", label: "Image output", desc: "Supports image output", color: "text-cyan-500" },
  audioOutput: { icon: "volume_up", label: "Audio output", desc: "Supports audio output", color: "text-purple-500" },
  tools: { icon: "build", label: "Tools", desc: "Supports tool calls", color: "text-green-600" },
  search: { icon: "travel_explore", label: "Web search", desc: "Supports web search", color: "text-green-600" },
  reasoning: { icon: "neurology", label: "Reasoning", desc: "Supports reasoning / thinking", color: "text-amber-500" },
};

// Realtime STT transport markers accepted on custom models — single source of
// truth across layers: the API whitelist (src/app/api/models/custom/route.js
// sanitizeTransport) and the dashboard transport select
// (providers/[id]/AddCustomModelModal) both import this map, so one new row
// here makes a realtime engine dispatch case (open-sse/handlers/sttCore.js)
// selectable and validated end-to-end. Keys must mirror a sttCore case.
export const STT_TRANSPORT_META = {
  "gemini-live": {
    label: "Gemini Live (realtime WebSocket)",
    desc: "Streams audio over bidiGenerateContent and returns incremental transcription segments",
  },
};

export const STT_TRANSPORTS = Object.freeze(Object.keys(STT_TRANSPORT_META));

export function isSttTransport(transport) {
  if (typeof transport !== "string") return false;
  return Object.prototype.hasOwnProperty.call(STT_TRANSPORT_META, transport.trim());
}
