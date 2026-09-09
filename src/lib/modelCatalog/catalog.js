import { getHardcodedCapabilityCatalog } from "open-sse/providers/capabilities.js";
import { getHardcodedPricingCatalog } from "open-sse/providers/pricing.js";

// Server/API callers can combine these stable hand-written entries with rows
// from repository.js without reaching into the runtime resolver internals.
export function getHardcodedModelCatalog() {
  return {
    capabilities: getHardcodedCapabilityCatalog(),
    pricing: getHardcodedPricingCatalog(),
  };
}

export function getHardcodedCatalogEntries() {
  const { capabilities, pricing } = getHardcodedModelCatalog();
  const rows = new Map();
  const add = (provider, pattern, matchType, type, field, value) => {
    const key = `${provider}\0${pattern}`;
    const current = rows.get(key) || { source: "hardcoded", type, provider, pattern, matchType };
    current[field] = { ...(current[field] || {}), ...value };
    rows.set(key, current);
  };
  for (const { model: pattern, capabilities: value } of capabilities.canonicalExact) add("*", pattern, "exact", "Canonical exact", "capabilities", value);
  for (const { provider, model: pattern, capabilities: value } of capabilities.providerExact) add(provider, pattern, "exact", "Provider exact", "capabilities", value);
  for (const { pattern, capabilities: value } of capabilities.patterns) add("*", pattern, "glob", "Pattern", "capabilities", value);
  for (const { model: pattern, pricing: value } of pricing.canonicalExact) add("*", pattern, "exact", "Canonical exact", "pricing", value);
  for (const { provider, model: pattern, pricing: value } of pricing.providerExact) add(provider, pattern, "exact", "Provider exact", "pricing", value);
  for (const { pattern, pricing: value } of pricing.patterns) add("*", pattern, "glob", "Pattern", "pricing", value);
  return [...rows.values()];
}
