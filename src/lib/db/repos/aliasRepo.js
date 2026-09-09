import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");
const mitmKv = makeKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias, model) {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias) {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Atomic upsert inside transaction to prevent duplicate races.
// Re-adding an existing model updates metadata without changing its identity.
// `locked` is only overwritten when explicitly provided, so edits never drop it.
export async function addCustomModel({ providerAlias, id, type = "llm", name, caps, catalogRef, clearCatalogMetadata = false, locked }) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) {
      const prev = parseJson(row.value) || {};
      const next = { ...prev, ...(name ? { name } : {}) };
      if (clearCatalogMetadata) {
        delete next.caps;
        delete next.catalogRef;
      }
      if (caps) next.caps = caps;
      if (catalogRef) {
        next.catalogRef = catalogRef;
        delete next.caps;
      }
      if (locked !== undefined) {
        if (locked) next.locked = true;
        else delete next.locked;
      }
      db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [stringifyJson(next), k]);
      return;
    }
    const value = stringifyJson({ providerAlias, id, type, name: name || id, ...(caps ? { caps } : {}), ...(catalogRef ? { catalogRef } : {}), ...(locked ? { locked: true } : {}) });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  const { refreshModelCatalogRuntime } = await import("../../modelCatalog/runtime.js");
  await refreshModelCatalogRuntime();
  return added;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(customKey(providerAlias, id, type));
  const { refreshModelCatalogRuntime } = await import("../../modelCatalog/runtime.js");
  await refreshModelCatalogRuntime();
}

// Toggle the locked flag (bulk-clear protection) on one custom model.
// Returns false when the model does not exist.
export async function setCustomModelLocked({ providerAlias, id, type = "llm", locked }) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let found = false;
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (!row) return;
    const next = { ...(parseJson(row.value) || {}), providerAlias, id, type };
    if (locked) next.locked = true;
    else delete next.locked;
    db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [stringifyJson(next), k]);
    found = true;
  });
  return found;
}

// Remove every custom model of one provider except locked ones, plus all
// legacy aliases pointing at that provider. Returns operation counts.
export async function clearProviderModels(providerAlias) {
  const db = await getAdapter();
  const result = { deleted: 0, skippedLocked: 0, aliasesDeleted: 0 };
  db.transaction(() => {
    for (const entry of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
      if (!entry.key.startsWith(`${providerAlias}|`)) continue;
      const value = parseJson(entry.value, {});
      if (value?.locked) {
        result.skippedLocked += 1;
        continue;
      }
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [entry.key]);
      result.deleted += 1;
    }
    for (const entry of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
      const model = parseJson(entry.value, entry.value);
      if (typeof model !== "string" || !model.startsWith(`${providerAlias}/`)) continue;
      db.run(`DELETE FROM kv WHERE scope = 'modelAliases' AND key = ?`, [entry.key]);
      result.aliasesDeleted += 1;
    }
  });
  const { refreshModelCatalogRuntime } = await import("../../modelCatalog/runtime.js");
  await refreshModelCatalogRuntime();
  return result;
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName) {
  if (toolName) {
    const v = await mitmKv.get(toolName);
    return v || {};
  }
  return await mitmKv.getAll();
}

export async function setMitmAliasAll(toolName, mappings) {
  await mitmKv.set(toolName, mappings || {});
}
