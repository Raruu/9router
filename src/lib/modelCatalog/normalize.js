import { sanitizeCapabilities, sanitizePricing } from "./validation.js";

const PRICE_FIELDS = {
  prompt: "input",
  completion: "output",
  input_cache_read: "cached",
  internal_reasoning: "reasoning",
  input_cache_write: "cache_creation",
};

export function normalizeOpenRouterModelId(modelId) {
  const terminal = String(modelId || "").split("/").pop() || "";
  return terminal.split(":")[0].trim().toLowerCase();
}

function usdPerMillion(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined;
}

function normalizeCapabilities(model) {
  const input = model?.architecture?.input_modalities;
  const output = model?.architecture?.output_modalities;
  const params = model?.supported_parameters;
  const caps = {};

  if (Array.isArray(input)) {
    caps.vision = input.includes("image");
    caps.pdf = input.includes("pdf") || input.includes("file");
    caps.audioInput = input.includes("audio");
    caps.videoInput = input.includes("video");
  }
  if (Array.isArray(output)) {
    caps.imageOutput = output.includes("image");
    caps.audioOutput = output.includes("audio");
  }
  if (Array.isArray(params)) {
    caps.tools = params.includes("tools") || params.includes("tool_choice");
    caps.reasoning = params.includes("reasoning") || params.includes("include_reasoning");
  }
  // The reasoning object is the endpoint's effort contract: it is present for
  // models that reason even when the parameter list omits the flag, it lists
  // the effort vocabulary the model accepts, and `mandatory` pins thinking on.
  if (model?.reasoning && typeof model.reasoning === "object") {
    caps.reasoning = true;
    const efforts = model.reasoning.supported_efforts;
    if (Array.isArray(efforts)) {
      const levels = sortEfforts(efforts.filter((level) => typeof level === "string" && level.trim()));
      if (levels.length) caps.thinkingLevels = levels;
    }
    if (model.reasoning.mandatory === true) caps.thinkingCanDisable = false;
  }

  const contextWindow = Number(model?.context_length);
  const maxOutput = Number(model?.top_provider?.max_completion_tokens);
  if (contextWindow > 0) caps.contextWindow = contextWindow;
  if (maxOutput > 0) caps.maxOutput = maxOutput;
  return sanitizeCapabilities(caps);
}

// Canonical picker order (mirrors the translator's EFFORT_LEVELS, plus "none"
// for wires that can disable). OpenRouter returns efforts highest-first; the
// dashboard renders this list in the order stored, so normalize it here.
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

function sortEfforts(efforts) {
  return [...new Set(efforts)].sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a);
    const ib = EFFORT_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function normalizePricing(model) {
  const pricing = {};
  for (const [source, target] of Object.entries(PRICE_FIELDS)) {
    const value = usdPerMillion(model?.pricing?.[source]);
    if (value !== undefined) pricing[target] = value;
  }
  return sanitizePricing(pricing);
}

function mergeCapabilities(entries) {
  const merged = {};
  const levels = new Set();
  let canDisable;
  for (const entry of entries) {
    for (const [key, value] of Object.entries(normalizeCapabilities(entry))) {
      if (key === "thinkingLevels") {
        for (const level of value) levels.add(level);
      } else if (key === "thinkingCanDisable") {
        // False is sticky: one mandatory variant keeps thinking on everywhere.
        if (value === false) canDisable = false;
        else if (canDisable === undefined) canDisable = true;
      } else if (typeof value === "boolean") {
        merged[key] = merged[key] === true || value;
      }
    }
  }
  if (levels.size) merged.thinkingLevels = sortEfforts([...levels]);
  if (canDisable === false) merged.thinkingCanDisable = false;
  return merged;
}

export function normalizeOpenRouterModels(payload, fetchedAt = new Date().toISOString()) {
  const models = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(models)) throw new Error("Invalid OpenRouter model catalog");

  const groups = new Map();
  for (const model of models) {
    const normalizedModel = normalizeOpenRouterModelId(model?.id);
    if (!normalizedModel) continue;
    if (!groups.has(normalizedModel)) groups.set(normalizedModel, []);
    groups.get(normalizedModel).push(model);
  }

  const rows = [];
  for (const [normalizedModel, variants] of groups) {
    variants.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const base = variants.find((model) => !String(model.id).split("/").pop().includes(":"));
    const selected = base || variants[0];
    // The unsuffixed offering is authoritative. Variant capabilities can differ
    // (for example :free or :batch), so only merge variants when no base exists.
    const capabilities = base ? normalizeCapabilities(base) : mergeCapabilities(variants);
    if (!base) {
      delete capabilities.contextWindow;
      delete capabilities.maxOutput;
    }

    const pricing = base ? normalizePricing(base) : {};
    rows.push({
      pattern: `*${normalizedModel}*`,
      normalizedModel,
      sourceId: selected.id,
      name: selected.name || normalizedModel,
      data: {
        capabilities,
        ...(Object.keys(pricing).length ? { pricing } : {}),
        provenance: {
          source: "openrouter",
          sourceId: selected.id,
          sourceIds: variants.map((model) => model.id),
          variantOnly: !base,
        },
      },
      fetchedAt,
    });
  }
  return rows.sort((a, b) => a.normalizedModel.localeCompare(b.normalizedModel));
}
