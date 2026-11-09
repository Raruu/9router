// Per-provider timeout overrides (chat/combo path).
// Stored in settings as providerTimeouts: { [providerId]: { connectMs?, firstChunkMs?, stallMs?, imageJobMs? } }.
// Only positive finite numbers survive; anything else is dropped so a missing
// or invalid entry always means "use the global default".

const KEYS = ["connectMs", "firstChunkMs", "stallMs"];

export function resolveProviderTimeouts(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of KEYS) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = value;
    }
  }
  return out;
}

// Async image jobs render for minutes on some gateways (tens of seconds to a
// few minutes), so the job poller gets its own, longer default
// than the chat connect timeout. IMAGE_JOB_TIMEOUT_MS overrides it globally;
// a provider's providerTimeouts.imageJobMs overrides it per provider.
export const DEFAULT_IMAGE_JOB_TIMEOUT_MS = 300000;

export function defaultImageJobTimeoutMs() {
  const raw = Number(process.env.IMAGE_JOB_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IMAGE_JOB_TIMEOUT_MS;
}

export function resolveImageJobTimeoutMs(raw, fallback = defaultImageJobTimeoutMs()) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.imageJobMs : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
