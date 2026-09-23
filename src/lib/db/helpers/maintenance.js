// DB maintenance helpers shared by the purge paths (usage + request details).
//
// SQLite never returns freed pages to the filesystem on DELETE — the file only
// shrinks after VACUUM, which rewrites the database. That is best-effort here:
// VACUUM needs an exclusive lock (fails under a concurrent writer) and sql.js
// persists asynchronously, so callers must treat a failed VACUUM as non-fatal.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_FILE } from "../paths.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";
import { normalizeSections, purgeDeleteStatements, redactRecord } from "./purgeOps.js";

export function getDbFileSize() {
  try {
    return fs.statSync(DATA_FILE).size;
  } catch {
    return null;
  }
}

// Flush the WAL into the main file before sampling a "before" size. Without
// this, rows still living in the -wal file make the main file look small, and
// the post-purge VACUUM would then report a *larger* size than "before".
export async function checkpointDb() {
  try {
    const db = await getAdapter();
    db.checkpoint?.();
  } catch {
    // Size reporting is advisory — never fail a purge over it.
  }
}

export function vacuumAdapter(adapter) {
  try {
    adapter.exec("VACUUM");
    adapter.checkpoint?.();
    return true;
  } catch (e) {
    console.warn("[DB] VACUUM failed (freed pages kept):", e?.message || e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Purge size estimate
//
// The dialogs show "current -> estimated after". A plain byte-sum (dbstat) is
// off by tens of percent — it counts partially-filled and free pages — so the
// estimate is a dry run instead: snapshot the live DB with VACUUM INTO (a
// compacted copy that includes uncheckpointed WAL content), replay the purge
// statements against the attached copy, VACUUM it, and stat the result. Both
// paths end as fully-compacted DBs of identical content, so the number matches
// the real outcome to the byte.
//
// Cost: one snapshot + one VACUUM of the copy. Guarded by a size cap, a free
// disk check, and a TTL cache so toggling dialog checkboxes stays cheap.
// ---------------------------------------------------------------------------

const MAX_ESTIMATE_BYTES = 1024 * 1024 * 1024; // 1 GB
const ESTIMATE_CACHE_TTL_MS = 30_000;
// Headroom for the snapshot plus SQLite's temp files during VACUUM.
const REQUIRED_FREE_FACTOR = 1.5;

let estimateChain = Promise.resolve();
const estimateCache = new Map(); // key -> { ts, value }

function cacheKey(target, sections, size, mtimeMs) {
  return `${target}|${(sections || []).join(",")}|${size}|${mtimeMs}`;
}

function fileStat() {
  try {
    return fs.statSync(DATA_FILE);
  } catch {
    return null;
  }
}

function hasFreeSpace(dir, neededBytes) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize >= neededBytes;
  } catch {
    // statfs unavailable (older Node / exotic FS): assume there is room and let
    // the snapshot fail into the catch below if there isn't.
    return true;
  }
}

// Why an estimate is skipped for a given DB size, or null when it can run.
// Pure so the size cap is testable without materializing a huge file.
export function estimateSkipReason(sizeBytes, maxBytes = MAX_ESTIMATE_BYTES) {
  if (!Number.isFinite(sizeBytes)) return "unavailable";
  if (sizeBytes > maxBytes) return "too-large";
  return null;
}

// Applies the purge to the attached copy. Delete-only targets are plain SQL;
// details-content rewrites each row's JSON, mirroring clearRequestDetailContent.
function applyPurgeToCopy(db, target, sections) {
  const statements = purgeDeleteStatements(target, "est.");
  if (statements) {
    db.exec("SAVEPOINT est_sp");
    try {
      for (const sql of statements) db.exec(sql);
      db.exec("RELEASE est_sp");
    } catch (e) {
      try { db.exec("ROLLBACK TO est_sp"); db.exec("RELEASE est_sp"); } catch {}
      throw e;
    }
    return;
  }

  const keys = normalizeSections(sections);
  const rows = db.all(`SELECT id, data FROM est.requestDetails`);
  db.exec("SAVEPOINT est_sp");
  try {
    for (const row of rows) {
      const record = parseJson(row.data, null);
      if (!redactRecord(record, keys)) continue;
      db.run(`UPDATE est.requestDetails SET data = ? WHERE id = ?`, [stringifyJson(record), row.id]);
    }
    db.exec("RELEASE est_sp");
  } catch (e) {
    try { db.exec("ROLLBACK TO est_sp"); db.exec("RELEASE est_sp"); } catch {}
    throw e;
  }
}

async function runEstimate(target, sections) {
  const stat = fileStat();
  const skip = estimateSkipReason(stat?.size);
  if (skip) return { sizeBefore: stat?.size ?? null, sizeAfter: null, reason: skip };

  const db = await getAdapter();
  // sql.js keeps the whole DB in memory and writes via its own debounced
  // export; VACUUM INTO/ATTACH against the file would measure a stale image.
  if (db.driver === "sql.js" || typeof db.exec !== "function") {
    return { sizeBefore: stat.size, sizeAfter: null, reason: "unsupported" };
  }
  if (!hasFreeSpace(os.tmpdir(), stat.size * REQUIRED_FREE_FACTOR)) {
    return { sizeBefore: stat.size, sizeAfter: null, reason: "no-space" };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-estimate-"));
  const snap = path.join(dir, "snap.sqlite");
  try {
    // Snapshot first (also flushes the WAL into the copy), then attach.
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    db.exec(`ATTACH DATABASE '${snap.replace(/'/g, "''")}' AS est`);
    try {
      applyPurgeToCopy(db, target, sections);
      db.exec("VACUUM est");
    } finally {
      try { db.exec("DETACH DATABASE est"); } catch {}
    }
    const after = fs.statSync(snap).size;
    return { sizeBefore: stat.size, sizeAfter: after, reason: null };
  } catch (e) {
    console.warn("[DB] purge size estimate failed:", e?.message || e);
    return { sizeBefore: stat.size, sizeAfter: null, reason: "failed" };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Estimate the DB file size after a purge, without modifying the live DB.
 * Returns { sizeBefore, sizeAfter, reason }: sizeAfter is null when an estimate
 * is not possible (unsupported driver, too large, no temp space, failure).
 * Runs are serialized — two concurrent estimates would collide on the `est`
 * alias — and cached briefly so rapid dialog toggles reuse the result.
 */
export async function estimatePurgeSize(target, sections = null) {
  const normalized = target === "details-content" ? normalizeSections(sections) : null;
  // Same baseline as the real purge: flush the WAL first, or the main file
  // under-reports and "before" wouldn't match what the purge later reports.
  await checkpointDb();
  const stat = fileStat();
  const key = cacheKey(target, normalized, stat?.size, stat?.mtimeMs);

  const cached = estimateCache.get(key);
  if (cached && Date.now() - cached.ts < ESTIMATE_CACHE_TTL_MS) return cached.value;

  const run = estimateChain.then(() => runEstimate(target, normalized));
  // Keep the chain alive after a failure so later estimates still run.
  estimateChain = run.catch(() => {});
  const value = await run;

  estimateCache.clear(); // one entry is enough; avoids unbounded growth
  estimateCache.set(key, { ts: Date.now(), value });
  return value;
}
