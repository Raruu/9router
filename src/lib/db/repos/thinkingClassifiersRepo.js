import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { genericClassifierTemplate } from "@/shared/constants/thinkingClassifier.js";

function rowToClassifier(row) {
  if (!row) return null;
  const data = parseJson(row.data, {});
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive !== 0,
    ...data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Row payload = everything except the columns (mirrors proxyPoolsRepo).
function classifierToData(classifier) {
  const { id, name, isActive, createdAt, updatedAt, ...rest } = classifier;
  return rest;
}

export async function getThinkingClassifiers() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM thinkingClassifiers ORDER BY createdAt ASC`);
  return rows.map(rowToClassifier);
}

export async function getThinkingClassifierById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM thinkingClassifiers WHERE id = ?`, [id]);
  return rowToClassifier(row);
}

export async function getThinkingClassifierByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM thinkingClassifiers WHERE name = ?`, [name]);
  return rowToClassifier(row);
}

// Active profile names, creation order — the exact list advertised in
// `capabilities.effort_tiers` and the only names interception accepts.
export async function getActiveClassifierNames() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT name FROM thinkingClassifiers WHERE isActive = 1 ORDER BY createdAt ASC`
  );
  return rows.map((row) => row.name);
}

export async function createThinkingClassifier(input) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const profile = {
    ...genericClassifierTemplate(),
    ...input,
    id: uuidv4(),
    isActive: input?.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO thinkingClassifiers(id, name, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [profile.id, profile.name, profile.isActive ? 1 : 0, stringifyJson(classifierToData(profile)), now, now]
  );
  return profile;
}

export async function updateThinkingClassifier(id, input) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM thinkingClassifiers WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToClassifier(row), ...input, id, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE thinkingClassifiers SET name = ?, isActive = ?, data = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.isActive === false ? 0 : 1, stringifyJson(classifierToData(merged)), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteThinkingClassifier(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM thinkingClassifiers WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
