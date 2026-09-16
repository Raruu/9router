// User catalog rules store their provider scope as the raw compatible-node id
// (e.g. "openai-compatible-chat-<uuid>") because runtime resolution compares
// scopes against provider ids. For display, map those ids back to the node's
// user-chosen prefix (e.g. "qwen-3.8"); unknown ids (registry providers, "*",
// deleted nodes) pass through unchanged.
export function buildCatalogProviderLabel(nodes = []) {
  const prefixById = new Map();
  for (const node of nodes || []) {
    const id = typeof node?.id === "string" ? node.id : "";
    const prefix = typeof node?.prefix === "string" ? node.prefix.trim() : "";
    if (!id || !prefix) continue;
    prefixById.set(id, prefix);
    prefixById.set(id.toLowerCase(), prefix);
  }
  return (provider) => {
    const raw = provider == null ? "" : String(provider);
    return prefixById.get(raw) || prefixById.get(raw.toLowerCase()) || raw;
  };
}
