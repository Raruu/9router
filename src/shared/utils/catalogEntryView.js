// View-model for the model-catalog entry preview dialog.
//
// Catalog rows arrive in three shapes (user rules, OpenRouter rows, hardcoded
// entries), each nesting capabilities/pricing slightly differently. Normalize
// once here so the dialog stays presentational and the mapping is unit-testable.

const SOURCE_LABELS = {
  user: "User rule",
  openrouter: "OpenRouter",
  hardcoded: "Hardcoded",
};

const TYPE_LABELS = {
  canonical: "Canonical exact",
  "canonical exact": "Canonical exact",
  "provider exact": "Provider exact",
  provider: "Provider exact",
  exact: "Exact",
  glob: "Ordered glob",
  pattern: "Ordered glob",
  "ordered glob": "Ordered glob",
};

export function entryTypeLabel(row) {
  const raw = row.recordType ?? row.record_type ?? row.type ?? row.matchType ?? (row.pattern?.includes?.("*") ? "Pattern" : null);
  if (!raw) return null;
  const normalized = String(raw).toLowerCase().replace(/[\s_-]+/g, " ");
  return TYPE_LABELS[normalized] || String(raw);
}

export function entrySourceLabel(row) {
  return SOURCE_LABELS[row?.source] || (row?.source ? String(row.source) : null);
}

export function buildCatalogEntryView(row) {
  if (!row) return null;
  const capabilities = row.capabilities ?? row.caps ?? row.data?.capabilities ?? row.data?.caps ?? {};
  const pricing = row.pricing ?? row.data?.pricing ?? null;
  const provenance = row.data?.provenance ?? row.provenance ?? null;
  const pattern = row.pattern ?? row.model ?? row.modelId ?? row.id ?? "";
  const provider = row.provider ?? row.providerId ?? "*";
  const source = row.source ?? null;

  const pricingSource = source === "user" ? "user catalog" : source === "openrouter" ? "openrouter" : "builtin";
  const thinkingLevels = Array.isArray(capabilities.thinkingLevels) ? capabilities.thinkingLevels : null;

  return {
    pattern: String(pattern),
    provider: String(provider),
    name: row.name || null,
    source,
    sourceLabel: entrySourceLabel(row),
    typeLabel: entryTypeLabel(row),
    capabilities,
    thinkingLevels,
    pricing,
    pricingSource,
    provenance: provenance && typeof provenance === "object" ? provenance : null,
    fetchedAt: row.fetchedAt || null,
    raw: row,
  };
}
