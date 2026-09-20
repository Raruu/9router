// Console-label helper: compatible provider nodes are keyed internally by their
// generated id ("openai-compatible-chat-<uuid>"), which is noise in logs and
// dashboard-visible lines. The user-facing name for that same provider is the
// node's prefix ("qwen-3.8"), mirrored onto each connection's
// providerSpecificData.prefix. Display only — every stored key (usage rows,
// model locks, pending-request maps, combo members) keeps the raw provider id.

export function providerDisplayLabel(provider, providerSpecificData) {
  const prefix = providerSpecificData?.prefix;
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  return provider;
}

// `provider/model` tag for console lines and client-visible error messages, so
// a compatible node reads as its prefix ("hcnsec/kimi-k3") rather than the
// generated id ("anthropic-compatible-<uuid>/kimi-k3").
export function providerModelTag(provider, providerSpecificData, model) {
  return `${providerDisplayLabel(provider, providerSpecificData)}/${model}`;
}
