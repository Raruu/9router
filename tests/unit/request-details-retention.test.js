// requestDetails retention + observability config precedence.
// Retention: age-based window (primary) then row ceiling (backstop), matching
// the Overview period selector's local-midnight day boundaries.
// Precedence: stored UI toggle > OBSERVABILITY_ENABLED env > opt-in default.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalObs = process.env.OBSERVABILITY_ENABLED;
const tempDirs = [];

async function freshDb({ obsEnabled } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-details-retention-"));
  tempDirs.push(tempDir);
  process.env.DATA_DIR = tempDir;
  if (obsEnabled === undefined) delete process.env.OBSERVABILITY_ENABLED;
  else process.env.OBSERVABILITY_ENABLED = obsEnabled;
  // driver.js hangs the adapter off globalThis (dev hot-reload guard), so
  // resetModules alone keeps the previous scenario's open DB handle.
  global._dbAdapter = { instance: null, initPromise: null, logged: true };
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  // Flush on every save; the 5s fallback timer would otherwise outlive the test.
  // Only batchSize is touched — enableObservability stays unstored where a
  // precedence test needs it that way.
  await db.updateSettings({ observabilityBatchSize: 1 });
  return db;
}

async function saveDetail(db, detail) {
  await db.saveRequestDetail(detail);
  await new Promise((r) => setTimeout(r, 120));
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalObs === undefined) delete process.env.OBSERVABILITY_ENABLED;
  else process.env.OBSERVABILITY_ENABLED = originalObs;
});

describe("requestDetails retention", () => {
  it("prunes rows older than the retention window, keeps in-window rows", async () => {
    const db = await freshDb();
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1, observabilityRetentionDays: 7 });

    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    await saveDetail(db, { id: "ret-ancient", timestamp: daysAgo(35), model: "m" });
    expect((await db.getRequestDetails({})).details).toHaveLength(0);

    await saveDetail(db, { id: "ret-recent", timestamp: daysAgo(3), model: "m" });
    let res = await db.getRequestDetails({});
    expect(res.details.map((d) => d.id)).toEqual(["ret-recent"]);

    await saveDetail(db, { id: "ret-ancient-2", timestamp: daysAgo(40), model: "m" });
    res = await db.getRequestDetails({});
    expect(res.details.map((d) => d.id)).toEqual(["ret-recent"]);
  });

  it("retentionDays 0 disables age-based pruning (ceiling only)", async () => {
    const db = await freshDb();
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1, observabilityMaxRecords: 5, observabilityRetentionDays: 0 });

    for (let i = 0; i < 8; i++) {
      await saveDetail(db, { id: `cap-${i}`, timestamp: new Date(Date.now() - (100 - i) * 60000).toISOString(), model: "m" });
    }
    const res = await db.getRequestDetails({ pageSize: 100 });
    expect(res.pagination.totalItems).toBe(5);
    expect(res.details.map((d) => d.id)).toEqual(["cap-7", "cap-6", "cap-5", "cap-4", "cap-3"]);
  });

  it("getRetentionCutoff matches the Overview window semantics", async () => {
    const { getRetentionCutoff } = await import("@/lib/db/repos/usageRepo.js");
    expect(getRetentionCutoff(60)).toBe(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 59).toISOString());
    expect(getRetentionCutoff(0)).toBeNull();
    expect(getRetentionCutoff(-1)).toBeNull();
    expect(getRetentionCutoff("bogus")).toBeNull();
  });
});

describe("observability config precedence", () => {
  it("OBSERVABILITY_ENABLED=true opts in when the toggle was never stored", async () => {
    const db = await freshDb({ obsEnabled: "true" });
    await saveDetail(db, { id: "env-on", model: "m" });
    const res = await db.getRequestDetails({});
    expect(res.details.map((d) => d.id)).toEqual(["env-on"]);
  });

  it("OBSERVABILITY_ENABLED=false disables when the toggle was never stored", async () => {
    const db = await freshDb({ obsEnabled: "false" });
    await saveDetail(db, { id: "env-off", model: "m" });
    expect((await db.getRequestDetails({})).details).toHaveLength(0);
  });

  it("stored enableObservability:false overrides OBSERVABILITY_ENABLED=true", async () => {
    const db = await freshDb({ obsEnabled: "true" });
    await db.updateSettings({ enableObservability: false });
    await saveDetail(db, { id: "ui-off", model: "m" });
    expect((await db.getRequestDetails({})).details).toHaveLength(0);
  });

  it("default is opt-in when neither the toggle nor the env var is set", async () => {
    const db = await freshDb();
    await saveDetail(db, { id: "default-off", model: "m" });
    expect((await db.getRequestDetails({})).details).toHaveLength(0);
  });
});
