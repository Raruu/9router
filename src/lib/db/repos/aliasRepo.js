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
// `transport` (STT realtime dispatch marker) is persisted when provided and
// otherwise left untouched, matching caps/name semantics.
//
// `previousType` (edit flow): the kind is part of the KV key, so changing it
// would otherwise write a second record and orphan the old one. When it
// differs from `type`, the old key is deleted inside the same transaction and
// its metadata (name/caps/catalogRef/transport/locked) carries over to the new
// key — a rename, not a duplicate.
export async function addCustomModel({ providerAlias, id, type = "llm", name, caps, catalogRef, clearCatalogMetadata = false, locked, transport, previousType = null }) {
  const k = customKey(providerAlias, id, type);
  const oldKey = previousType && previousType !== type ? customKey(providerAlias, id, previousType) : null;
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    // A type change moves the record: read the old row first so its metadata
    // survives, then drop the stale key before the upsert below.
    let prevRow = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (!prevRow && oldKey) {
      prevRow = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [oldKey]);
      if (prevRow) db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [oldKey]);
    }
    if (prevRow) {
      const prev = parseJson(prevRow.value) || {};
      // `type` is part of the record as well as the key — on a rename it must
      // track the new key, or getModelKind() would still report the old kind.
      const next = { ...prev, type, ...(name ? { name } : {}) };
      if (clearCatalogMetadata) {
        delete next.caps;
        delete next.catalogRef;
      }
      if (caps) next.caps = caps;
      if (catalogRef) {
        next.catalogRef = catalogRef;
        delete next.caps;
      }
      // Transport is only meaningful on type "stt". An explicit "" clears it
      // (the modal's "provider default"); a string persists; anything else —
      // including an omitted key from a caller that doesn't manage transports —
      // leaves the stored marker untouched (T14: a dropped unknown value must
      // not clobber a working one). A type change always drops it.
      if (type !== "stt") {
        delete next.transport;
      } else if (transport === "") {
        delete next.transport;
      } else if (typeof transport === "string") {
        next.transport = transport;
      }
      if (locked !== undefined) {
        if (locked) next.locked = true;
        else delete next.locked;
      }
      // Upsert, not UPDATE: on a rename the target key does not exist yet
      // (the stale key was just deleted), so an UPDATE would drop the record.
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [k, stringifyJson(next)]
      );
      return;
    }
    const value = stringifyJson({ providerAlias, id, type, name: name || id, ...(caps ? { caps } : {}), ...(catalogRef ? { catalogRef } : {}), ...(transport ? { transport } : {}), ...(locked ? { locked: true } : {}) });
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
