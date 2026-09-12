import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, n) {
  const r = nodeToRow(n);
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

export const COMPATIBLE_CHAT_NODE_TYPE = "openai-compatible";
export const COMPATIBLE_ANTHROPIC_NODE_TYPE = "anthropic-compatible";
const CONVERTIBLE_NODE_TYPES = [COMPATIBLE_CHAT_NODE_TYPE, COMPATIBLE_ANTHROPIC_NODE_TYPE];

// Build a node id using the same scheme as the provider-nodes POST route:
// openai-compatible-<chat|responses>-<uuid>, anthropic-compatible-<uuid>.
// The id prefix is what the whole stack (dashboard, executors, translators)
// uses to tell OpenAI- from Anthropic-compatible nodes apart.
export function buildCompatibleNodeId(type, apiType, suffix) {
  if (type === COMPATIBLE_ANTHROPIC_NODE_TYPE) return `anthropic-compatible-${suffix}`;
  return `openai-compatible-${apiType}-${suffix}`;
}

// Numeric counters inside a usageDaily aggregate bucket.
const USAGE_COUNTER_FIELDS = ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost"];

function mergeUsageCounter(target, source) {
  if (!target || typeof target !== "object" || !source || typeof source !== "object") return;
  for (const field of USAGE_COUNTER_FIELDS) {
    target[field] = (target[field] || 0) + (source[field] || 0);
  }
}

// Re-point one usageDaily aggregate blob from oldId to newId. Buckets keyed by
// provider ("byProvider") or embedding "model|provider" ("byModel/byApiKey/
// byEndpoint") are renamed; when the new-id bucket already exists the counters
// merge so nothing is double-counted or lost. Per-account buckets are keyed by
// connection id (which survives conversion) — only their embedded provider
// meta is updated. Returns true when the blob changed.
export function remapUsageDay(day, oldId, newId) {
  if (!day || typeof day !== "object") return false;
  let changed = false;
  const suffix = `|${oldId}`;
  for (const mapKey of ["byProvider", "byModel", "byApiKey", "byEndpoint"]) {
    const map = day[mapKey];
    if (!map || typeof map !== "object") continue;
    for (const key of Object.keys(map)) {
      let nextKey = null;
      if (key === oldId) nextKey = newId;
      else if (key.endsWith(suffix)) nextKey = key.slice(0, -oldId.length) + newId;
      if (!nextKey || nextKey === key) continue;
      const entry = map[key];
      delete map[key];
      const existing = map[nextKey];
      if (existing && typeof existing === "object" && entry && typeof entry === "object") {
        mergeUsageCounter(existing, entry);
      } else if (entry !== undefined) {
        map[nextKey] = entry;
      }
      const placed = map[nextKey];
      if (placed && typeof placed === "object" && placed.provider === oldId) {
        placed.provider = newId;
      }
      changed = true;
    }
  }
  const byAccount = day.byAccount;
  if (byAccount && typeof byAccount === "object") {
    for (const entry of Object.values(byAccount)) {
      if (entry && typeof entry === "object" && entry.provider === oldId) {
        entry.provider = newId;
        changed = true;
      }
    }
  }
  return changed;
}

function sanitizeCompatBaseUrl(type, baseUrl) {
  let out = baseUrl.trim().replace(/\/$/, "");
  if (type === COMPATIBLE_ANTHROPIC_NODE_TYPE && out.endsWith("/messages")) {
    out = out.slice(0, -"/messages".length);
  }
  return out;
}

export async function getProviderNodes(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql = `SELECT * FROM providerNodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return db.all(sql, params).map(rowToNode);
}

export async function getProviderNodeById(id) {
  const db = await getAdapter();
  return rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
}

export async function createProviderNode(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, node);
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProviderNode(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  if (removed) {
    const { deleteProviderIcon, isCompatibleProviderIconNode } = await import("@/lib/providerIcons.js");
    if (isCompatibleProviderIconNode(removed)) await deleteProviderIcon(id);
  }
  return removed;
}

// Switch a custom node between openai-compatible and anthropic-compatible.
// The kind is keyed off the node id prefix everywhere, so the node gets a new
// id and every reference moves with it in one transaction: connections
// (provider + providerSpecificData), custom models, aliases, disabled-model
// entries, pricing overrides, mitmAlias targets, combo members, provider-keyed
// settings (strategies, thinking, quota visibility, timeouts, retries,
// capacity-adapter lists), and usage history (usageHistory, requestDetails,
// usageDaily aggregates). Returns the new node, or null when
// the source node does not exist. Throws on invalid input (rolls back).
export async function convertProviderNodeType(id, { type, apiType, name, prefix, baseUrl }) {
  if (!CONVERTIBLE_NODE_TYPES.includes(type)) {
    throw new Error("Invalid provider node type");
  }
  if (type === COMPATIBLE_CHAT_NODE_TYPE && !["chat", "responses"].includes(apiType)) {
    throw new Error("Invalid OpenAI compatible API type");
  }
  if (!name?.trim()) throw new Error("Name is required");
  if (!prefix?.trim()) throw new Error("Prefix is required");
  if (!baseUrl?.trim()) throw new Error("Base URL is required");

  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const node = rowToNode(row);
    if (!CONVERTIBLE_NODE_TYPES.includes(node.type)) {
      throw new Error("Only OpenAI and Anthropic compatible nodes can switch type");
    }
    if (node.type === type) {
      throw new Error("Provider node already has this type");
    }

    const now = new Date().toISOString();
    const newId = buildCompatibleNodeId(type, apiType, uuidv4());
    const sanitizedBaseUrl = sanitizeCompatBaseUrl(type, baseUrl);
    const trimmedName = name.trim();
    const trimmedPrefix = prefix.trim();

    const newNode = {
      id: newId,
      type,
      name: trimmedName,
      prefix: trimmedPrefix,
      ...(type === COMPATIBLE_CHAT_NODE_TYPE ? { apiType } : {}),
      baseUrl: sanitizedBaseUrl,
      ...(node.iconVersion ? { iconVersion: node.iconVersion } : {}),
      createdAt: row.createdAt,
      updatedAt: now,
    };
    upsert(db, newNode);

    for (const conn of db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [id])) {
      const data = parseJson(conn.data, {});
      const specific = { ...(data.providerSpecificData || {}) };
      specific.prefix = trimmedPrefix;
      specific.baseUrl = sanitizedBaseUrl;
      specific.nodeName = trimmedName;
      if (type === COMPATIBLE_CHAT_NODE_TYPE) {
        specific.apiType = apiType;
      } else {
        delete specific.apiType;
      }
      data.providerSpecificData = specific;
      db.run(
        `UPDATE providerConnections SET provider = ?, data = ?, updatedAt = ? WHERE id = ?`,
        [newId, stringifyJson(data), now, conn.id]
      );
    }

    for (const entry of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
      if (!entry.key.startsWith(`${id}|`)) continue;
      const value = parseJson(entry.value, {});
      value.providerAlias = newId;
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [entry.key]);
      db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [`${newId}${entry.key.slice(id.length)}`, stringifyJson(value)]);
    }

    for (const entry of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
      const model = parseJson(entry.value, entry.value);
      if (typeof model !== "string" || !model.startsWith(`${id}/`)) continue;
      db.run(`UPDATE kv SET value = ? WHERE scope = 'modelAliases' AND key = ?`, [stringifyJson(`${newId}${model.slice(id.length)}`), entry.key]);
    }

    const disabled = db.get(`SELECT value FROM kv WHERE scope = 'disabledModels' AND key = ?`, [id]);
    if (disabled) {
      db.run(`DELETE FROM kv WHERE scope = 'disabledModels' AND key = ?`, [id]);
      db.run(`INSERT INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [newId, disabled.value]);
    }

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (settingsRow) {
      const settings = parseJson(settingsRow.data, {});
      let changed = false;
      for (const key of ["providerStrategies", "providerThinking", "quotaVisibility", "providerTimeouts", "providerRetries"]) {
        if (settings[key] && Object.prototype.hasOwnProperty.call(settings[key], id)) {
          settings[key] = { ...settings[key], [newId]: settings[key][id] };
          delete settings[key][id];
          changed = true;
        }
      }
      // Capacity-adapter model lists hold "provider/model" strings.
      const adapter = settings.capacityAdapter;
      if (adapter && typeof adapter === "object") {
        for (const cap of Object.values(adapter)) {
          if (!cap || !Array.isArray(cap.models)) continue;
          if (!cap.models.some((m) => typeof m === "string" && m.startsWith(`${id}/`))) continue;
          cap.models = cap.models.map((m) => (typeof m === "string" && m.startsWith(`${id}/`) ? `${newId}${m.slice(id.length)}` : m));
          changed = true;
        }
      }
      if (changed) {
        db.run(`UPDATE settings SET data = ? WHERE id = 1`, [stringifyJson(settings)]);
      }
    }

    // Combo members are plain "provider/model" strings — re-point this node's.
    for (const combo of db.all(`SELECT id, models FROM combos`)) {
      const members = parseJson(combo.models, []);
      if (!Array.isArray(members) || !members.some((m) => typeof m === "string" && m.startsWith(`${id}/`))) continue;
      const renamed = members.map((m) => (typeof m === "string" && m.startsWith(`${id}/`) ? `${newId}${m.slice(id.length)}` : m));
      db.run(`UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?`, [stringifyJson(renamed), now, combo.id]);
    }

    // Pricing overrides and mitmAlias targets keyed by / pointing at this node.
    const pricing = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [id]);
    if (pricing) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [id]);
      db.run(`INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [newId, pricing.value]);
    }
    for (const entry of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) {
      const mappings = parseJson(entry.value, null);
      if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) continue;
      let changed = false;
      const next = {};
      for (const [from, to] of Object.entries(mappings)) {
        const renamed = (typeof to === "string" && to.startsWith(`${id}/`)) ? `${newId}${to.slice(id.length)}` : to;
        if (renamed !== to) changed = true;
        next[from] = renamed;
      }
      if (changed) {
        db.run(`UPDATE kv SET value = ? WHERE scope = 'mitmAlias' AND key = ?`, [stringifyJson(next), entry.key]);
      }
    }

    // Usage history records the serving provider id at write time — re-point
    // rows so past usage stays grouped under the converted provider instead of
    // a ghost id. Daily aggregates are re-keyed (merging into an existing
    // new-id bucket when both fired on the same day).
    db.run(`UPDATE usageHistory SET provider = ? WHERE provider = ?`, [newId, id]);
    for (const detail of db.all(`SELECT id, data FROM requestDetails WHERE provider = ?`, [id])) {
      const record = parseJson(detail.data, null);
      if (record && typeof record === "object" && !Array.isArray(record)) {
        if (record.provider === id) record.provider = newId;
        db.run(`UPDATE requestDetails SET provider = ?, data = ? WHERE id = ?`, [newId, stringifyJson(record), detail.id]);
      } else {
        db.run(`UPDATE requestDetails SET provider = ? WHERE id = ?`, [newId, detail.id]);
      }
    }
    for (const day of db.all(`SELECT dateKey, data FROM usageDaily WHERE data LIKE ?`, [`%${id}%`])) {
      const blob = parseJson(day.data, null);
      if (!remapUsageDay(blob, id, newId)) continue;
      db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [stringifyJson(blob), day.dateKey]);
    }

    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
    result = { ...newNode };
  });

  // Post-commit: the raw-SQL moves above bypass the in-memory catalog runtime
  // and pricing cache — refresh both (same pattern as aliasRepo mutations).
  const [{ refreshModelCatalogRuntime }, { invalidatePricingCache }] = await Promise.all([
    import("../../modelCatalog/runtime.js"),
    import("./pricingRepo.js"),
  ]);
  invalidatePricingCache();
  if (result?.iconVersion) {
    const { moveProviderIcon } = await import("@/lib/providerIcons.js");
    await moveProviderIcon(id, result.id);
  }
  await refreshModelCatalogRuntime();
  return result;
}
