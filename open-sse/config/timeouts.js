// Per-provider timeout overrides (chat/combo path).
// Stored in settings as providerTimeouts: { [providerId]: { connectMs?, firstChunkMs?, stallMs? } }.
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
