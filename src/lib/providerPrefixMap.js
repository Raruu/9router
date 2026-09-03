import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";

// Combo members and dashboard model strings are stored as `{prefix}/{model}`,
// where the prefix may be a connection's custom prefix, the provider's static
// alias, or the raw provider id. Capabilities and pricing are keyed by provider
// id, so map every prefix a model string could carry back to one.
export function buildProviderIdByPrefix(connections) {
  const byPrefix = new Map();
  for (const [providerId, alias] of Object.entries(PROVIDER_ID_TO_ALIAS)) {
    byPrefix.set(providerId, providerId);
    if (alias) byPrefix.set(alias, providerId);
  }
  for (const conn of connections || []) {
    const providerId = conn?.provider;
    if (!providerId) continue;
    const alias = getProviderAlias(providerId);
    if (alias) byPrefix.set(alias, providerId);
    const prefix = conn?.providerSpecificData?.prefix;
    if (typeof prefix === "string" && prefix.trim()) byPrefix.set(prefix.trim(), providerId);
  }
  return byPrefix;
}
