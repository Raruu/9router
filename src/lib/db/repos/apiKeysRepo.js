import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import {
  normalizeAllowedModels,
  normalizeLimitType,
  normalizeLimitValue,
} from "@/shared/constants/apiKeyLimits";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    limitType: normalizeLimitType(row.limitType),
    tokenLimit: row.tokenLimit != null ? Number(row.tokenLimit) : 0,
    usedTokens: row.usedTokens != null ? Number(row.usedTokens) : 0,
    requestLimit: row.requestLimit != null ? Number(row.requestLimit) : 0,
    usedRequests: row.usedRequests != null ? Number(row.usedRequests) : 0,
    allowedModels: row.allowedModels ? parseJson(row.allowedModels, null) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const limitType = normalizeLimitType(options.limitType);
  const tokenLimit = limitType === "none" ? 0 : normalizeLimitValue(options.tokenLimit);
  const requestLimit = limitType === "none" ? 0 : normalizeLimitValue(options.requestLimit);
  const allowedModels = normalizeAllowedModels(options.allowedModels);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    limitType,
    tokenLimit,
    usedTokens: 0,
    requestLimit,
    usedRequests: 0,
    allowedModels,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, limitType, tokenLimit, usedTokens, requestLimit, usedRequests, allowedModels, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.limitType,
      apiKey.tokenLimit,
      0,
      apiKey.requestLimit,
      0,
      allowedModels ? stringifyJson(allowedModels) : null,
      apiKey.createdAt,
      apiKey.updatedAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;

  // Rotation reissues the key value for the same record. The keyId/crc8 are
  // derived from machineId, which legacy rows may not carry, so resolve both
  // before entering the (synchronous) transaction.
  let rotatedKey = null;
  let rotatedMachineId = null;
  if (data?.rotateKey) {
    const row = db.get(`SELECT machineId FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return null;
    rotatedMachineId = row.machineId || await (await import("@/shared/utils/machineId")).getConsistentMachineId();
    const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
    rotatedKey = generateApiKeyWithMachine(rotatedMachineId).key;
  }

  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    if (rotatedKey) {
      merged.key = rotatedKey;
      merged.machineId = rotatedMachineId;
    }
    const limitType = normalizeLimitType(merged.limitType);
    const tokenLimit = limitType === "none" ? 0 : normalizeLimitValue(merged.tokenLimit);
    const requestLimit = limitType === "none" ? 0 : normalizeLimitValue(merged.requestLimit);
    const usedTokens = merged.usedTokens != null ? Math.max(0, Number(merged.usedTokens) || 0) : 0;
    const usedRequests = merged.usedRequests != null ? Math.max(0, Number(merged.usedRequests) || 0) : 0;
    const allowedModels = normalizeAllowedModels(merged.allowedModels);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, limitType = ?, tokenLimit = ?, usedTokens = ?, requestLimit = ?, usedRequests = ?, allowedModels = ?, updatedAt = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        limitType,
        tokenLimit,
        data.resetUsage ? 0 : usedTokens,
        requestLimit,
        data.resetUsage ? 0 : usedRequests,
        allowedModels ? stringifyJson(allowedModels) : null,
        merged.updatedAt,
        id,
      ]
    );
    result = {
      ...merged,
      limitType,
      tokenLimit,
      usedTokens: data.resetUsage ? 0 : usedTokens,
      requestLimit,
      usedRequests: data.resetUsage ? 0 : usedRequests,
      allowedModels,
    };
    delete result.resetUsage;
    delete result.rotateKey;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
