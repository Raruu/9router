// Helpers for deciding whether a provider model row is referenced anywhere
// outside the provider's own model list. All comparisons use full
// "provider/model" forms — callers pass every known form of each row because
// a reference may be stored under the storage alias (node id) or the display
// alias (prefix).

// Build the set of referenced full-model strings. Every input is optional;
// missing sources simply contribute nothing.
export function buildUsedFormSet({
  combos = [],
  aliasTargets = [],
  mitmTargets = [],
  pricingForms = [],
  capacityForms = [],
  disabledForms = [],
} = {}) {
  const used = new Set();
  const add = (value) => {
    if (typeof value === "string" && value) used.add(value);
  };
  for (const combo of combos || []) {
    for (const member of combo?.models || []) add(member);
  }
  for (const list of [aliasTargets, mitmTargets, pricingForms, capacityForms, disabledForms]) {
    for (const value of list || []) add(value);
  }
  return used;
}

// Flatten nested {group: {key: "provider/model"}} maps (mitmAlias, pricing
// tables) into a plain list of referenced full-model strings.
export function flattenReferenceMap(map) {
  const out = [];
  if (!map || typeof map !== "object") return out;
  for (const group of Object.values(map)) {
    if (!group || typeof group !== "object") continue;
    for (const value of Object.values(group)) {
      if (typeof value === "string" && value) out.push(value);
    }
  }
  return out;
}

// User pricing tables are {provider: {modelId: rates}} — expand to full forms.
export function pricingTableForms(tables) {
  const out = [];
  if (!tables || typeof tables !== "object") return out;
  for (const [provider, models] of Object.entries(tables)) {
    if (!models || typeof models !== "object") continue;
    for (const modelId of Object.keys(models)) {
      if (modelId) out.push(`${provider}/${modelId}`);
    }
  }
  return out;
}

// Capacity-adapter settings are {kind: {models: [...]}} — collect the lists.
export function capacityAdapterForms(capacityAdapter) {
  const out = [];
  if (!capacityAdapter || typeof capacityAdapter !== "object") return out;
  for (const entry of Object.values(capacityAdapter)) {
    for (const model of entry?.models || []) {
      if (typeof model === "string" && model) out.push(model);
    }
  }
  return out;
}

// A row is used when any of its known forms is referenced.
export function isRowUsed(rowForms, usedSet) {
  return (rowForms || []).some((form) => usedSet.has(form));
}

// Split rows into used/unused. getForms maps a row to its known full-model
// forms (e.g. storage + display alias forms).
export function partitionRowsByUsage(rows, getForms, usedSet) {
  const used = [];
  const unused = [];
  for (const row of rows || []) {
    (isRowUsed(getForms(row), usedSet) ? used : unused).push(row);
  }
  return { used, unused };
}
