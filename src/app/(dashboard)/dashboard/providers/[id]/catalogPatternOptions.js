export const AUTOMATIC_PATTERN_OPTION = {
  key: "",
  label: "Automatic (match model ID)",
  searchText: "automatic match model id",
  ref: null,
};

export function catalogRefKey(ref) {
  return ref ? JSON.stringify([ref.source, ref.provider || "*", ref.pattern]) : "";
}

export function catalogPatternLabel(row) {
  return `[${row.source}] ${row.provider || "*"} / ${row.pattern}`;
}

export function catalogPatternOptions(catalog) {
  const rows = [
    ...(catalog?.userDefined || []).map((row) => ({ ...row, source: "user" })),
    ...((catalog?.openrouter?.models || catalog?.openrouter || [])).map((row) => ({ ...row, source: "openrouter", provider: row.provider || "*" })),
    ...(catalog?.hardcoded || []).map((row) => ({ ...row, source: "hardcoded" })),
  ];
  return rows.map((row) => {
    const label = catalogPatternLabel(row);
    return {
      key: catalogRefKey(row),
      label,
      searchText: [label, row.pattern, row.provider, row.name, row.source, row.type].filter(Boolean).join(" ").toLowerCase(),
      ref: { source: row.source, provider: row.provider || "*", pattern: row.pattern },
    };
  });
}

export function filterCatalogPatternOptions(options, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) => option.searchText.includes(normalized));
}
