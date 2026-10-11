import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";

// Combo members and dashboard model strings are stored as `{prefix}/{model}`,
// where the prefix may be a connection's custom prefix, the provider's static
// alias, or the raw provider id. Capabilities and pricing are keyed by provider
// id, so map every prefix a model string could carry back to one.
//
// `nodes` (providerNodes rows) contribute their own prefix → node id. Nodes are
// the durable record of a custom provider: a node's connections can all be
// deactivated, but its models and their catalog pins live on the node, so a
// prefix that only exists on an inactive node must still resolve. Node entries
// are gap-filled — they never overwrite a built-in id/alias or a connection,
// matching model.js's reserved-prefix policy.
export function buildProviderIdByPrefix(connections, nodes = []) {
  const byPrefix = new Map();
  for (const [providerId, alias] of Object.entries(PROVIDER_ID_TO_ALIAS)) {
    byPrefix.set(providerId, providerId);
    if (alias) byPrefix.set(alias, providerId);
  }
  for (const node of nodes || []) {
    const prefix = typeof node?.prefix === "string" ? node.prefix.trim() : "";
    if (!prefix || !node?.id || byPrefix.has(prefix)) continue;
    byPrefix.set(prefix, node.id);
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
