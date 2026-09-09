export const MODEL_CATALOG_PRIORITIES = [
  "user-openrouter-hardcoded",
  "user-hardcoded-openrouter",
];

export const DEFAULT_MODEL_CATALOG_PRIORITY = MODEL_CATALOG_PRIORITIES[0];

export const CAPABILITY_KEYS = [
  "vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput",
  "tools", "reasoning", "contextWindow", "maxOutput",
];

export const PRICING_KEYS = ["input", "output", "cached", "reasoning", "cache_creation"];

export function normalizeCatalogPriority(value) {
  return MODEL_CATALOG_PRIORITIES.includes(value) ? value : DEFAULT_MODEL_CATALOG_PRIORITY;
}

export function normalizeProvider(provider) {
  const value = String(provider || "*").trim().toLowerCase();
  if (!value || /[\s|]/.test(value)) throw new Error("Invalid model catalog provider");
  return value;
}

export function normalizePattern(pattern) {
  const value = String(pattern || "").trim();
  if (!value || value.length > 512) throw new Error("Invalid model catalog pattern");
  return value;
}

export function sanitizeCapabilities(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const key of CAPABILITY_KEYS) {
    const value = input[key];
    if (key === "contextWindow" || key === "maxOutput") {
      if (Number.isFinite(value) && value >= 0) out[key] = Math.floor(value);
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function sanitizePricing(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const key of PRICING_KEYS) {
    const value = input[key];
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

export function sanitizeCatalogData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid model catalog data");
  }
  const capabilities = sanitizeCapabilities(input.capabilities || input.caps);
  const pricing = sanitizePricing(input.pricing);
  return {
    ...(Object.keys(capabilities).length ? { capabilities } : {}),
    ...(Object.keys(pricing).length ? { pricing } : {}),
    ...(input.provenance && typeof input.provenance === "object" ? { provenance: input.provenance } : {}),
  };
}
