import { getAdapter } from "../db/driver.js";
import { parseJson, stringifyJson } from "../db/helpers/jsonCol.js";
import { normalizePattern, normalizeProvider, sanitizeCatalogData } from "./validation.js";

function mapOpenRouter(row) {
  return { ...row, data: parseJson(row.data, {}) };
}

function mapUser(row) {
  return { ...row, data: parseJson(row.data, {}) };
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
