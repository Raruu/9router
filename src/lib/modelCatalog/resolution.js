import { DEFAULT_MODEL_CATALOG_PRIORITY, normalizeCatalogPriority } from "./validation.js";

export function matchCatalogPattern(pattern, model) {
  const escaped = String(pattern).split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(String(model || ""));
}

function matches(pattern, model) {
  const terminal = String(model || "").split("/").pop();
  return matchCatalogPattern(pattern, model) || matchCatalogPattern(pattern, terminal);
}

function specificity(rule, provider) {
  const exactProvider = rule.provider === String(provider || "").toLowerCase() ? 1 : 0;
  const exactPattern = rule.pattern.includes("*") ? 0 : 1;
  const literalLength = rule.pattern.replaceAll("*", "").length;
  const wildcards = (rule.pattern.match(/\*/g) || []).length;
  return [exactProvider, exactPattern, literalLength, -wildcards];
}

function compareRules(a, b, provider) {
  const aa = specificity(a, provider);
  const bb = specificity(b, provider);
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  const byProvider = b.provider.localeCompare(a.provider);
  return byProvider || b.pattern.localeCompare(a.pattern);
}

function resolveRules(rules, provider, model, field, global = false) {
  return rules
    .filter((rule) => (global || rule.provider === "*" || rule.provider === String(provider || "").toLowerCase()) && matches(rule.pattern, model))
    .sort((a, b) => compareRules(a, b, provider))
    .reduce((result, rule) => ({ ...result, ...(rule.data?.[field] || {}) }), {});
}

function matchingCustomModels(customModels, provider, model, normalizeProviderId) {
  const normalizedProvider = String(normalizeProviderId(provider) || "").toLowerCase();
  const terminal = String(model || "").split("/").pop();
  return customModels.filter((entry) =>
    String(normalizeProviderId(entry.providerAlias) || "").toLowerCase() === normalizedProvider
      && (String(entry.id) === String(model) || String(entry.id) === terminal));
}

// Resolve the source rule a catalog ref points at. Both halves compare
// case-insensitively, matching findUserRuleCaseInsensitive and
// matchCatalogPattern — a case-only difference must not silently unpin a model.
function findReferencedRule(sources, ref) {
  const provider = String(ref.provider || "*").toLowerCase();
  const pattern = String(ref.pattern || "").toLowerCase();
  return sources[ref.source]?.find(
    (candidate) =>
      String(candidate.provider || "*").toLowerCase() === provider
      && String(candidate.pattern || "").toLowerCase() === pattern,
  );
}

function referencedData(customModels, sources, field) {
  return customModels.reduce((out, entry) => {
    const ref = entry.catalogRef;
    if (!ref) return { ...out, ...(field === "capabilities" ? (entry.capabilities || entry.caps || {}) : {}) };
    return { ...out, ...(findReferencedRule(sources, ref)?.data?.[field] || {}) };
  }, {});
}

function customMetadata(customModels, sources, provider, model, field, normalizeProviderId) {
  const matched = matchingCustomModels(customModels, provider, model, normalizeProviderId);
  const data = referencedData(matched, sources, field);
  // Suppress the lower-priority chain only when a PIN resolved to real data.
  // A dangling ref (rule deleted, OpenRouter catalog refetched/cleared) or a
  // rule that carries nothing for this field used to set hasReference with an
  // empty payload, which replaced the entire chain — including the hand-written
  // tables — with DEFAULT_CAPABILITIES, erasing vision/reasoning/context.
  const pinned = referencedData(matched.filter((entry) => entry.catalogRef), sources, field);
  return {
    hasReference: Object.keys(pinned).length > 0,
    data,
  };
}

function compactSourceRules(rules) {
  return rules.map((rule) => ({
    ...rule,
    provider: String(rule.provider || "*").toLowerCase(),
    pattern: String(rule.pattern || ""),
  }));
}

export function createCatalogResolver({ userRules = [], openRouterRules = [], hardcodedRules = [], customModels = [], priority = DEFAULT_MODEL_CATALOG_PRIORITY, normalizeProviderId = (provider) => provider } = {}) {
  const selectedPriority = normalizeCatalogPriority(priority);
  const normalizedUserRules = compactSourceRules(userRules);
  const normalizedOpenRouterRules = compactSourceRules(openRouterRules);
  const normalizedHardcodedRules = compactSourceRules(hardcodedRules);
  const sources = { user: normalizedUserRules, openrouter: normalizedOpenRouterRules, hardcoded: normalizedHardcodedRules };

  function resolveField(field, provider, model, hardcoded = {}) {
    const custom = customMetadata(customModels, sources, provider, model, field, normalizeProviderId);
    const user = resolveRules(normalizedUserRules, provider, model, field);
    const openrouter = custom.hasReference ? {} : resolveRules(normalizedOpenRouterRules, provider, model, field, true);
    const lower = selectedPriority === "user-hardcoded-openrouter"
      ? { ...openrouter, ...hardcoded }
      : { ...hardcoded, ...openrouter };
    return { ...(custom.hasReference ? {} : lower), ...custom.data, ...user };
  }

  return {
    getCapabilities(provider, model, hardcoded) {
      return resolveField("capabilities", provider, model, hardcoded);
    },
    getPricing(provider, model, hardcoded) {
      return resolveField("pricing", provider, model, hardcoded);
    },
  };
}
