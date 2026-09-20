// Mapping + persistence for the "save capabilities to Model Catalog" import
// option: snapshot a model's resolved /api/models/detail into a
// provider-scoped, exact-match user catalog rule (POST, PUT on 409).

export const SNAPSHOT_BOOL_CAPS = [
  "vision", "pdf", "audioInput", "videoInput",
  "imageOutput", "audioOutput", "tools", "reasoning",
];

export const SNAPSHOT_PRICING_KEYS = ["input", "output", "cached", "reasoning", "cache_creation"];

// detail: GET /api/models/detail response ({capabilities, pricing}).
// Returns the POST /api/models/catalog/user body, or null when there is
// nothing worth saving.
export function buildCatalogRuleBody({ provider, pattern, detail }) {
  const caps = detail?.capabilities;
  if (!caps || typeof caps !== "object") return null;
  const capabilities = {};
  for (const key of SNAPSHOT_BOOL_CAPS) {
    if (typeof caps[key] === "boolean") capabilities[key] = caps[key];
  }
  const body = { provider, pattern, matchType: "exact", capabilities };
  if (Number.isFinite(caps.contextWindow) && caps.contextWindow > 0) {
    body.contextWindow = Math.floor(caps.contextWindow);
  }
  if (Number.isFinite(caps.maxOutput) && caps.maxOutput > 0) {
    body.maxOutput = Math.floor(caps.maxOutput);
  }
  if (detail.pricing && typeof detail.pricing === "object") {
    const pricing = {};
    for (const key of SNAPSHOT_PRICING_KEYS) {
      const value = Number(detail.pricing[key]);
      if (Number.isFinite(value) && value >= 0) pricing[key] = value;
    }
    if (Object.keys(pricing).length > 0) body.pricing = pricing;
  }
  return body;
}

// fetchImpl defaults to global fetch so tests can inject a mock.
export async function saveCatalogRule(body, fetchImpl = fetch) {
  const post = (method, payload) => fetchImpl("/api/models/catalog/user", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let res = await post("POST", body);
  if (res.status === 409) {
    res = await post("PUT", {
      ...body,
      originalIdentity: { provider: body.provider, pattern: body.pattern },
    });
  }
  return res.ok;
}

// --- Field mapping for non-standard /models payloads -------------------------
// Some providers return richer model objects than the OpenAI shape (e.g.
// context_window, vision, reasoning, input_idr_per_1m). The import dialog
// auto-detects these and lets the user correct the guesses; the helpers here
// stay pure so both the dialog defaults and the import path share one mapping.

const CAP_ALIASES = {
  vision: ["vision", "supports_vision", "vision_enabled", "multimodal", "image_input"],
  pdf: ["pdf", "supports_pdf", "document", "file_input"],
  audioInput: ["audio_input", "supports_audio", "audio"],
  videoInput: ["video_input", "supports_video", "video"],
  imageOutput: ["image_output", "image_generation", "supports_image_output"],
  audioOutput: ["audio_output", "audio_generation", "supports_audio_output"],
  tools: ["tools", "supports_tools", "function_calling", "tool_use"],
  reasoning: ["reasoning", "supports_reasoning", "reasoning_enabled", "thinking"],
};

const CONTEXT_ALIASES = [
  "context_window", "context_length", "max_context_tokens", "max_context_length", "context_size", "context",
];

const MAX_OUTPUT_ALIASES = [
  "max_output", "max_output_tokens", "max_completion_tokens", "max_tokens", "output_tokens",
];

const PRICE_ALIASES = {
  input: ["input", "prompt", "input_price", "prompt_price"],
  output: ["output", "completion", "output_price", "completion_price"],
  cached: ["cache_read", "cached", "cache_read_input", "cache_hit", "input_cache_read"],
};

// Matches an alias against the leaf segment of a (possibly dotted) key, so a
// nested source like "pricing.output_usd_per_1m" scores the same as the flat
// "output_usd_per_1m". Returns 2 for an exact segment, 1 for an affixed one,
// 0 for no match.
function aliasRank(key, alias) {
  const segment = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  if (segment === alias) return 2;
  if (
    segment.startsWith(`${alias}_`)
    || segment.startsWith(`${alias}-`)
    || segment.endsWith(`_${alias}`)
    || segment.endsWith(`-${alias}`)
  ) {
    return 1;
  }
  return 0;
}

// "input_idr_per_1m" -> "per_1m"; plain values (no marker) default to per-1M.
export function detectPriceUnit(key) {
  const value = String(key || "").toLowerCase();
  if (/(?:^|[_-])(?:per[_-]?)?1k(?:[_-]|$)|per[_-]?thousand/.test(value)) return "per_1k";
  if (/(?:^|[_-])(?:per[_-]?)?1m(?:[_-]|$)|per[_-]?million/.test(value)) return "per_1m";
  return null;
}

export function detectCurrencyFromKey(key) {
  const value = String(key || "").toLowerCase();
  if (/(?:^|[_-])idr(?:[_-]|$)/.test(value)) return "IDR";
  if (/(?:^|[_-])usd(?:[_-]|$)/.test(value)) return "USD";
  return null;
}

function scoreCandidate(key, aliases, pricing) {
  const lower = key.toLowerCase();
  let rank = 0;
  for (const alias of aliases) rank = Math.max(rank, aliasRank(lower, alias));
  if (rank === 0) return -1;

  let score = rank * 100;
  if (pricing) {
    const unit = detectPriceUnit(lower);
    if (unit === "per_1m") score += 2000;
    else if (unit === "per_1k") score += 1000;
    if (/(?:^|[_-])(?:price|cost|rate|idr|usd)(?:[_-]|$)/.test(lower)) score += 300;
    const currency = detectCurrencyFromKey(lower);
    if (currency === "USD") score += 20;
    else if (currency === null) score += 10;
  }
  return score;
}

function pickField(keys, aliases, pricing = false) {
  let best = null;
  let bestScore = -1;
  for (const key of keys) {
    const score = scoreCandidate(key, aliases, pricing);
    // On a tie prefer the shallower path, so a flat "vision" wins over
    // "capabilities.vision" when a payload happens to carry both.
    const shallower = bestScore >= 0 && score === bestScore && key.split(".").length < best.split(".").length;
    if (score > bestScore || shallower) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

// Some /models payloads nest capability flags and limits inside containers
// (e.g. capabilities: { vision: true }, limits: { context_window: 128000 }).
// The helpers below flatten nested objects to dot-paths ("capabilities.vision")
// so the same alias detection and value resolution work for flat and nested
// shapes alike.

export function resolvePath(source, path) {
  if (!source || typeof source !== "object" || !path) return undefined;
  let current = source;
  for (const segment of String(path).split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

const MAX_SOURCE_DEPTH = 4;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

// Union of dot-paths to scalar leaves across every entry, in first-seen order
// (keeps detection deterministic when several aliases score the same). Arrays
// and empty objects contribute nothing; nesting stops at maxDepth segments.
export function collectLeafPaths(entries, { maxDepth = MAX_SOURCE_DEPTH } = {}) {
  const paths = [];
  const seen = new Set();
  const visit = (value, prefix, depth) => {
    for (const key of Object.keys(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const child = value[key];
      if (isScalar(child)) {
        if (seen.has(path)) continue;
        seen.add(path);
        paths.push(path);
      } else if (isPlainObject(child) && depth < maxDepth) {
        visit(child, path, depth + 1);
      }
    }
  };
  for (const entry of entries || []) {
    if (isPlainObject(entry)) visit(entry, "", 1);
  }
  return paths;
}

// Auto-detected mapping for the import dialog: { caps, contextWindow,
// maxOutput, pricing: { input, output, cached }, currency }. Unmatched targets
// are null; the user edits the guesses in the dialog before importing.
export function detectImportMapping(entries = []) {
  const keys = collectLeafPaths(entries);
  const caps = {};
  for (const cap of SNAPSHOT_BOOL_CAPS) caps[cap] = pickField(keys, CAP_ALIASES[cap], false);
  const pricing = {
    input: pickField(keys, PRICE_ALIASES.input, true),
    output: pickField(keys, PRICE_ALIASES.output, true),
    cached: pickField(keys, PRICE_ALIASES.cached, true),
  };
  const currencies = [...new Set(Object.values(pricing).filter(Boolean).map(detectCurrencyFromKey).filter(Boolean))];
  return {
    caps,
    contextWindow: pickField(keys, CONTEXT_ALIASES, false),
    maxOutput: pickField(keys, MAX_OUTPUT_ALIASES, false),
    pricing,
    currency: currencies.length === 0 ? null : currencies.includes("USD") ? "USD" : currencies[0],
  };
}

function readNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "enabled", "supported"].includes(normalized)) return true;
    if (["false", "no", "0", "disabled", "unsupported"].includes(normalized)) return false;
  }
  return undefined;
}

// Build a user catalog rule body from one raw /models entry plus a mapping
// (usually detectImportMapping output, possibly user-edited). price values are
// normalized to USD per 1M tokens: per-1k sources are multiplied by 1000 and
// non-USD sources are divided by currencyRate ("1 USD = <rate> <currency>").
// Returns null when nothing mappable is present so callers can fall back to
// the resolved /api/models/detail snapshot.
export function buildCatalogRuleBodyFromRaw({ provider, pattern, raw, mapping, currencyRate } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!mapping || typeof mapping !== "object") return null;

  const capabilities = {};
  for (const cap of SNAPSHOT_BOOL_CAPS) {
    const source = mapping.caps?.[cap];
    if (!source) continue;
    const value = readBoolean(resolvePath(raw, source));
    if (value !== undefined) capabilities[cap] = value;
  }

  const body = { provider, pattern, matchType: "exact", capabilities };

  const contextWindow = readNumber(resolvePath(raw, mapping.contextWindow));
  if (contextWindow !== undefined && contextWindow > 0) body.contextWindow = Math.floor(contextWindow);
  const maxOutput = readNumber(resolvePath(raw, mapping.maxOutput));
  if (maxOutput !== undefined && maxOutput > 0) body.maxOutput = Math.floor(maxOutput);

  const pricing = {};
  for (const [target, source] of Object.entries(mapping.pricing || {})) {
    if (!source) continue;
    let value = readNumber(resolvePath(raw, source));
    if (value === undefined || value < 0) continue;
    if (detectPriceUnit(source) === "per_1k") value *= 1000;
    const currency = detectCurrencyFromKey(source) || mapping.currency || "USD";
    if (currency !== "USD") {
      const rate = Number(currencyRate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      value /= rate;
    }
    pricing[target] = value;
  }
  if (Object.keys(pricing).length > 0) body.pricing = pricing;

  const hasLimits = body.contextWindow !== undefined || body.maxOutput !== undefined;
  if (Object.keys(capabilities).length === 0 && !hasLimits && !body.pricing) return null;
  return body;
}
