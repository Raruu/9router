import { CUSTOM_MODEL_TYPES, customModelTypeLabel } from "../constants/models.js";

function modelType(model) {
  return model?.kind || model?.type || "llm";
}

/**
 * Rows for the provider page's custom models (and legacy aliases).
 *
 * `type` narrows to one service kind ("llm" default). Pass `null` to get every
 * kind at once — the Available Models section groups the result by `type`.
 */
export function getProviderCustomModelRows({
  customModels = [],
  modelAliases = {},
  providerAlias,
  builtInModels = [],
  type = "llm",
  includeLegacyAliases = true,
}) {
  const builtInIds = new Set(builtInModels.map((model) => model.id));
  const seenFullModels = new Set();
  const rows = [];

  for (const model of customModels) {
    if (!model?.id || model.providerAlias !== providerAlias) continue;
    const rowType = modelType(model);
    if (type && rowType !== type) continue;
    if (builtInIds.has(model.id)) continue;

    const fullModel = `${providerAlias}/${model.id}`;
    if (seenFullModels.has(fullModel)) continue;
    seenFullModels.add(fullModel);
    rows.push({
      id: model.id,
      name: model.name || model.id,
      fullModel,
      source: "custom",
      type: rowType,
      ...(model.locked ? { locked: true } : {}),
      ...(model.caps ? { caps: model.caps } : {}),
      ...(model.catalogRef ? { catalogRef: model.catalogRef } : {}),
      // STT realtime dispatch marker — needed to prefill the edit dialog.
      ...(model.transport ? { transport: model.transport } : {}),
    });
  }

  if (!includeLegacyAliases) return rows;

  const prefix = `${providerAlias}/`;
  for (const [alias, fullModel] of Object.entries(modelAliases || {})) {
    if (typeof fullModel !== "string" || !fullModel.startsWith(prefix)) continue;
    const id = fullModel.slice(prefix.length);
    if (!id || builtInIds.has(id) || seenFullModels.has(fullModel)) continue;

    seenFullModels.add(fullModel);
    rows.push({
      id,
      alias,
      fullModel,
      source: "legacyAlias",
      type: type || "llm",
    });
  }

  return rows;
}

// Display order of the Available Models sections: LLM first, then the media
// kinds in the dropdown's own order. Any kind the taxonomy does not know (a
// legacy stored value) lands at the end rather than disappearing.
const KIND_ORDER = new Map(CUSTOM_MODEL_TYPES.map((t, index) => [t.id, index]));

// Grouping keeps an unknown stored kind as its own section (visible + editable)
// instead of silently re-bucketing it into LLM; only an empty value is LLM.
function groupKindOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "llm";
}

function sortKinds(entries) {
  return entries.sort(([a], [b]) => {
    const ia = KIND_ORDER.has(a) ? KIND_ORDER.get(a) : CUSTOM_MODEL_TYPES.length;
    const ib = KIND_ORDER.has(b) ? KIND_ORDER.get(b) : CUSTOM_MODEL_TYPES.length;
    return ia - ib;
  });
}

/**
 * Group rows by service kind for the Available Models sections.
 * @returns {{ id: string, label: string, rows: object[] }[]} non-empty groups only
 */
export function groupCustomModelRowsByKind(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const kind = groupKindOf(row.type);
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(row);
  }
  return sortKinds([...groups.entries()])
    .map(([id, groupRows]) => ({ id, label: customModelTypeLabel(id), rows: groupRows }));
}

/** Group built-in registry models (each carrying its own kind) the same way. */
export function groupBuiltInModelsByKind(models = [], kindOf = (m) => m?.kind || m?.type) {
  const groups = new Map();
  for (const model of models) {
    const kind = groupKindOf(kindOf(model));
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(model);
  }
  return sortKinds([...groups.entries()])
    .map(([id, groupModels]) => ({ id, label: customModelTypeLabel(id), models: groupModels }));
}

/**
 * Merge custom rows and built-in models into one ordered section list, so the
 * Available Models card can render per-kind groups (LLM first, taxonomy order,
 * unknown kinds last). Empty groups are dropped; callers decide whether to
 * print headers (a single group reads better without one).
 *
 * @returns {{ id: string, label: string, customRows: object[], builtInModels: object[], count: number }[]}
 */
export function groupProviderModelsByKind({ customRows = [], builtInModels = [] } = {}) {
  const byKind = new Map();
  const ensure = (id) => {
    if (!byKind.has(id)) byKind.set(id, { id, label: customModelTypeLabel(id), customRows: [], builtInModels: [] });
    return byKind.get(id);
  };
  for (const group of groupCustomModelRowsByKind(customRows)) {
    ensure(group.id).customRows.push(...group.rows);
  }
  for (const group of groupBuiltInModelsByKind(builtInModels)) {
    ensure(group.id).builtInModels.push(...group.models);
  }
  return sortKinds([...byKind.entries()])
    .map(([, group]) => ({ ...group, count: group.customRows.length + group.builtInModels.length }));
}
