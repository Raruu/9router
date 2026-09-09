import { getAdapter } from "../db/driver.js";
import { parseJson, stringifyJson } from "../db/helpers/jsonCol.js";
import { normalizePattern, normalizeProvider, sanitizeCatalogData } from "./validation.js";

function mapOpenRouter(row) {
  return { ...row, data: parseJson(row.data, {}) };
}

function mapUser(row) {
  return { ...row, data: parseJson(row.data, {}) };
}

export class ModelCatalogConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelCatalogConflictError";
    this.code = "MODEL_CATALOG_CONFLICT";
  }
}

export class ModelCatalogNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelCatalogNotFoundError";
    this.code = "MODEL_CATALOG_NOT_FOUND";
  }
}

async function refreshRuntime() {
  const { refreshModelCatalogRuntime } = await import("./runtime.js");
  await refreshModelCatalogRuntime();
}

export async function getOpenRouterModels() {
  const db = await getAdapter();
  return db.all(`SELECT pattern, normalizedModel, sourceId, name, data, fetchedAt FROM openRouterModels ORDER BY normalizedModel`).map(mapOpenRouter);
}

export async function replaceOpenRouterModels(rows) {
  if (!Array.isArray(rows)) throw new Error("OpenRouter models must be an array");
  const normalizedRows = rows.map((row) => ({
    ...row,
    pattern: normalizePattern(row.pattern),
    normalizedModel: String(row.normalizedModel || "").trim(),
    sourceId: String(row.sourceId || "").trim(),
    fetchedAt: String(row.fetchedAt || "").trim(),
    data: sanitizeCatalogData(row.data),
  }));
  if (normalizedRows.some((row) => !row.normalizedModel || !row.sourceId || !row.fetchedAt)) {
    throw new Error("Invalid OpenRouter model catalog row");
  }
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM openRouterModels`);
    for (const row of normalizedRows) {
      db.run(
        `INSERT INTO openRouterModels(pattern, normalizedModel, sourceId, name, data, fetchedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [row.pattern, row.normalizedModel, row.sourceId, row.name || null, stringifyJson(row.data), row.fetchedAt],
      );
    }
  });
  await refreshRuntime();
  return normalizedRows.length;
}

export async function upsertOpenRouterModels(rows) {
  const db = await getAdapter();
  db.transaction(() => {
    for (const row of rows) {
      db.run(
        `INSERT INTO openRouterModels(pattern, normalizedModel, sourceId, name, data, fetchedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(pattern) DO UPDATE SET normalizedModel = excluded.normalizedModel, sourceId = excluded.sourceId,
           name = excluded.name, data = excluded.data, fetchedAt = excluded.fetchedAt`,
        [normalizePattern(row.pattern), row.normalizedModel, row.sourceId, row.name || null, stringifyJson(sanitizeCatalogData(row.data)), row.fetchedAt],
      );
    }
  });
  await refreshRuntime();
  return rows.length;
}

export async function clearOpenRouterModels() {
  const db = await getAdapter();
  db.run(`DELETE FROM openRouterModels`);
  await refreshRuntime();
}

export async function deleteOpenRouterModel(pattern) {
  const db = await getAdapter();
  const result = db.run(`DELETE FROM openRouterModels WHERE pattern = ?`, [normalizePattern(pattern)]);
  await refreshRuntime();
  return result.changes > 0;
}

export async function getUserModelCatalog() {
  const db = await getAdapter();
  return db.all(`SELECT provider, pattern, name, data, createdAt, updatedAt FROM userModelCatalog ORDER BY provider, pattern`).map(mapUser);
}

function normalizedUserRule({ provider = "*", pattern, name = null, data }) {
  return {
    provider: normalizeProvider(provider),
    pattern: normalizePattern(pattern),
    name: name ? String(name).trim() : null,
    data: sanitizeCatalogData(data),
  };
}

function findUserRuleCaseInsensitive(db, provider, pattern) {
  return db.get(
    `SELECT provider, pattern, name, data, createdAt, updatedAt
     FROM userModelCatalog WHERE provider = ? AND LOWER(pattern) = LOWER(?)`,
    [provider, pattern],
  );
}

export async function createUserModelCatalogRule(entry) {
  const rule = normalizedUserRule(entry);
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    if (findUserRuleCaseInsensitive(db, rule.provider, rule.pattern)) {
      throw new ModelCatalogConflictError(`Pattern already exists: ${rule.pattern}`);
    }
    db.run(
      `INSERT INTO userModelCatalog(provider, pattern, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [rule.provider, rule.pattern, rule.name, stringifyJson(rule.data), now, now],
    );
  });
  await refreshRuntime();
  return mapUser(db.get(
    `SELECT provider, pattern, name, data, createdAt, updatedAt FROM userModelCatalog WHERE provider = ? AND pattern = ?`,
    [rule.provider, rule.pattern],
  ));
}

export async function updateUserModelCatalogRule(originalIdentity, entry) {
  const original = {
    provider: normalizeProvider(originalIdentity?.provider),
    pattern: normalizePattern(originalIdentity?.pattern),
  };
  const rule = normalizedUserRule(entry);
  const db = await getAdapter();
  const now = new Date().toISOString();

  db.transaction(() => {
    const existing = db.get(
      `SELECT provider, pattern FROM userModelCatalog WHERE provider = ? AND pattern = ?`,
      [original.provider, original.pattern],
    );
    if (!existing) throw new ModelCatalogNotFoundError(`Pattern not found: ${original.pattern}`);

    const target = findUserRuleCaseInsensitive(db, rule.provider, rule.pattern);
    const targetIsOriginal = target
      && target.provider === original.provider
      && target.pattern.toLowerCase() === original.pattern.toLowerCase();
    if (target && !targetIsOriginal) {
      throw new ModelCatalogConflictError(`Pattern already exists: ${rule.pattern}`);
    }

    db.run(
      `UPDATE userModelCatalog
       SET provider = ?, pattern = ?, name = ?, data = ?, updatedAt = ?
       WHERE provider = ? AND pattern = ?`,
      [rule.provider, rule.pattern, rule.name, stringifyJson(rule.data), now, original.provider, original.pattern],
    );

    const originalPattern = original.pattern.toLowerCase();
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
      const model = parseJson(row.value, {});
      const ref = model.catalogRef;
      if (ref?.source !== "user") continue;
      if (String(ref.provider || "*").trim().toLowerCase() !== original.provider) continue;
      if (String(ref.pattern || "").trim().toLowerCase() !== originalPattern) continue;
      model.catalogRef = { ...ref, provider: rule.provider, pattern: rule.pattern };
      db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [stringifyJson(model), row.key]);
    }
  });

  await refreshRuntime();
  return mapUser(db.get(
    `SELECT provider, pattern, name, data, createdAt, updatedAt FROM userModelCatalog WHERE provider = ? AND pattern = ?`,
    [rule.provider, rule.pattern],
  ));
}

export async function upsertUserModelCatalogRule({ provider = "*", pattern, name = null, data }) {
  const db = await getAdapter();
  const normalizedProvider = normalizeProvider(provider);
  const normalizedPattern = normalizePattern(pattern);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO userModelCatalog(provider, pattern, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, pattern) DO UPDATE SET name = excluded.name, data = excluded.data, updatedAt = excluded.updatedAt`,
    [normalizedProvider, normalizedPattern, name ? String(name).trim() : null, stringifyJson(sanitizeCatalogData(data)), now, now],
  );
  await refreshRuntime();
  return (await getUserModelCatalog()).find((rule) => rule.provider === normalizedProvider && rule.pattern === normalizedPattern);
}

export async function deleteUserModelCatalogRule(provider, pattern) {
  const db = await getAdapter();
  const result = db.run(`DELETE FROM userModelCatalog WHERE provider = ? AND pattern = ?`, [normalizeProvider(provider), normalizePattern(pattern)]);
  await refreshRuntime();
  return result.changes > 0;
}

export async function replaceUserModelCatalog(rules) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM userModelCatalog`);
    for (const rule of rules || []) {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO userModelCatalog(provider, pattern, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [normalizeProvider(rule.provider), normalizePattern(rule.pattern), rule.name || null, stringifyJson(sanitizeCatalogData(rule.data)), rule.createdAt || now, rule.updatedAt || now],
      );
    }
  });
  await refreshRuntime();
  return await getUserModelCatalog();
}
