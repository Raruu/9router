// Global DATA_DIR isolation for the unit suite.
//
// src/lib/db resolves its SQLite file from DATA_DIR at import time. A test file
// that imports the DB without pointing DATA_DIR at a temp dir silently writes
// into the user's real database — provider-priority-insert-cost.test.js seeded
// 200+ rows into ~/.9router before this guard existed.
//
// setupFiles run once per test file, before the file's imports, so setting
// DATA_DIR here covers every test. Files that set their own DATA_DIR still
// override it (their saved "original" is this temp dir, which they restore to
// and which we remove afterwards).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const PREFIX = "9router-test-data-";
const STALE_MS = 60 * 60 * 1000; // 1h — older than any live test run

// Sweep dirs left behind by previous crashed/killed runs. Only stale ones:
// concurrent test files each create their own fresh dir, and deleting those
// would break them mid-run.
function sweepStaleDirs() {
  let entries;
  try { entries = fs.readdirSync(os.tmpdir()); } catch { return; }
  const cutoff = Date.now() - STALE_MS;
  for (const name of entries) {
    if (!name.startsWith(PREFIX)) continue;
    const full = path.join(os.tmpdir(), name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

const previousDataDir = process.env.DATA_DIR;
const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
process.env.DATA_DIR = guardDir;
sweepStaleDirs();

function cleanup() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { fs.rmSync(guardDir, { recursive: true, force: true }); } catch {}
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
}

// afterAll covers the normal path; the signal/exit hooks catch files that fail
// during collection or whose worker is terminated, where afterAll never runs
// and the temp dir would otherwise leak.
afterAll(cleanup);
process.once("exit", cleanup);
process.once("SIGTERM", cleanup);
process.once("SIGINT", cleanup);


