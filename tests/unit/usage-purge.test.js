// Purge backend for the Usage → Settings tab: clearUsageHistory() and
// clearRequestDetails(). Runs against a throwaway DATA_DIR under os.tmpdir();
// never touches the real ~/.9router DB.
//
// Reports DB file size before/after each purge (VACUUM runs inside the purge
// path, so the file actually shrinks — SQLite otherwise keeps freed pages).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;
let DATA_FILE;

const sizeOf = () => {
  try { return fs.statSync(DATA_FILE).size; } catch { return null; }
};
// The WAL holds unflushed rows, so sampling the main file alone under-reports
// the "before" size. The purge endpoint checkpoints first for the same reason.
const checkpoint = () => { try { adapter?.checkpoint?.(); } catch {} };
const fmt = (n) => (n == null ? "n/a" : `${(n / (1024 * 1024)).toFixed(2)} MB`);

async function seedUsage(count) {
  for (let i = 0; i < count; i++) {
    await db.saveRequestUsage({
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      provider: "openai",
      model: `gpt-4o-mini-${i % 5}`,
      connectionId: `conn-${i % 3}`,
      apiKey: null,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 100 + i, completion_tokens: 50 + i },
      ttft: 100 + (i % 50),
      totalLatency: 500 + (i % 200),
    });
  }
}

async function seedDetails(count) {
  for (let i = 0; i < count; i++) {
    await db.saveRequestDetail({
      id: `detail-${i}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      provider: "openai",
      model: "gpt-4o-mini",
      status: "ok",
      latency: { ttft: 120, total: 640 },
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      request: { messages: [{ role: "user", content: "x".repeat(1200) + i }] },
      providerRequest: { model: "gpt-4o-mini", input: "y".repeat(1200) },
      providerResponse: { output: "z".repeat(1200) },
      response: { content: "w".repeat(1200) },
    });
  }
  // saveRequestDetail buffers; wait past the flush timer (batchSize=1 set below).
  await new Promise((r) => setTimeout(r, 200));
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-purge-"));
  process.env.DATA_DIR = tempDir;
  // driver.js caches the adapter on globalThis across module resets.
  global._dbAdapter = { instance: null, initPromise: null, logged: true };
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
  const { DATA_FILE: file } = await import("@/lib/db/paths.js");
  DATA_FILE = file;
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("clearUsageHistory", () => {
  it("wipes usageHistory + usageDaily + lifetime counter, keeps apiKeys counters", async () => {
    await seedUsage(2000);

    // A key with quota counters must survive the purge (it steers enforcement,
    // it is not display history).
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, limitType, tokenLimit, usedTokens, requestLimit, usedRequests)
       VALUES(?, ?, ?, ?, 1, ?, 'tokens', 100000, 4242, 0, 7)`,
      ["k1", "sk-test-1", "test", "m", new Date().toISOString()]
    );

    const historyBefore = adapter.get(`SELECT COUNT(*) as c FROM usageHistory`).c;
    expect(historyBefore).toBeGreaterThan(0);
    expect(adapter.get(`SELECT COUNT(*) as c FROM usageDaily`).c).toBeGreaterThan(0);
    expect(adapter.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`)).toBeTruthy();

    const before = (checkpoint(), sizeOf());
    const { deleted } = await db.clearUsageHistory();
    const after = sizeOf();

    console.log(`[purge] overview  ${fmt(before)} -> ${fmt(after)} (deleted ${deleted} history rows, freed ${(((before - after) / before) * 100).toFixed(1)}%)`);

    expect(deleted).toBe(historyBefore);
    expect(adapter.get(`SELECT COUNT(*) as c FROM usageHistory`).c).toBe(0);
    expect(adapter.get(`SELECT COUNT(*) as c FROM usageDaily`).c).toBe(0);
    expect(adapter.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`)).toBeUndefined();

    const key = adapter.get(`SELECT usedTokens, usedRequests FROM apiKeys WHERE id = 'k1'`);
    expect(key.usedTokens).toBe(4242);
    expect(key.usedRequests).toBe(7);

    expect(after).toBeLessThan(before);

    // Stats must read empty afterwards (cards/charts/tables source).
    const stats = await db.getUsageStats("all");
    expect(stats.totalRequests).toBe(0);
    expect(stats.byProvider).toEqual({});
    expect(stats.recentRequests).toEqual([]);
  });

  it("second purge is a no-op reporting 0 rows", async () => {
    const { deleted } = await db.clearUsageHistory();
    expect(deleted).toBe(0);
  });
});

describe("clearRequestDetails", () => {
  it("wipes requestDetails and drops buffered-but-unflushed entries", async () => {
    await seedDetails(600);
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(600);

    const before = (checkpoint(), sizeOf());

    // getObservabilityConfig caches for 5s, so the big batch size only takes
    // effect in a fresh module instance. Reset the graph; driver.js keeps the
    // adapter on globalThis, so both instances share the same DB handle.
    await db.updateSettings({ observabilityBatchSize: 1000, observabilityFlushIntervalMs: 60000 });
    vi.resetModules();
    const fresh = await import("@/lib/db/index.js");

    // Push a detail that stays in the write buffer (1 < batchSize 1000).
    await fresh.saveRequestDetail({
      id: "buffered-after-purge",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4o-mini",
      request: { messages: [{ role: "user", content: "buffered" }] },
    });
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(600);

    const { deleted } = await fresh.clearRequestDetails();
    const after = sizeOf();

    console.log(`[purge] details   ${fmt(before)} -> ${fmt(after)} (deleted ${deleted} detail rows, freed ${(((before - after) / before) * 100).toFixed(1)}%)`);

    expect(deleted).toBe(600);
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(0);
    expect(after).toBeLessThan(before);

    // The buffered row must never land: wait, then assert it stayed gone.
    await new Promise((r) => setTimeout(r, 250));
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(0);
    const res = await fresh.getRequestDetails({});
    expect(res.pagination.totalItems).toBe(0);
  });

  it("details purge leaves usage history intact", async () => {
    await seedUsage(20);
    await seedDetails(5);
    await db.clearRequestDetails();
    expect(adapter.get(`SELECT COUNT(*) as c FROM usageHistory`).c).toBe(20);
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(0);
  });
});

describe("POST /api/usage/purge", () => {
  it("rejects a missing or unknown target with 400", async () => {
    const { POST } = await import("../../src/app/api/usage/purge/route.js");

    const missing = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({}),
    }));
    expect(missing.status).toBe(400);

    const unknown = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({ target: "everything" }),
    }));
    expect(unknown.status).toBe(400);
  });

  it("returns deleted count + before/after sizes for each target", async () => {
    const { POST } = await import("../../src/app/api/usage/purge/route.js");

    await seedUsage(30);
    await seedDetails(10);
    const historyRows = adapter.get(`SELECT COUNT(*) as c FROM usageHistory`).c;
    const detailRows = adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c;

    const overview = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({ target: "overview" }),
    }));
    expect(overview.status).toBe(200);
    const overviewBody = await overview.json();
    expect(overviewBody.success).toBe(true);
    expect(overviewBody.target).toBe("overview");
    expect(overviewBody.deleted).toBe(historyRows);
    expect(overviewBody.sizeAfter).toBeLessThan(overviewBody.sizeBefore);
    // Details survive an overview-only purge.
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(detailRows);

    const details = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({ target: "details" }),
    }));
    expect(details.status).toBe(200);
    const detailsBody = await details.json();
    expect(detailsBody.deleted).toBe(detailRows);
    expect(detailsBody.sizeAfter).toBeLessThan(detailsBody.sizeBefore);
  });
});

describe("clearRequestDetailContent", () => {
  it("redacts only the selected sections, keeps rows and metadata", async () => {
    await seedUsage(10);
    await seedDetails(40);
    const rowCount = adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c;
    expect(rowCount).toBe(40);

    const before = (checkpoint(), sizeOf());
    const { updated } = await db.clearRequestDetailContent(["request", "response"]);
    const after = sizeOf();

    console.log(`[purge] content   ${fmt(before)} -> ${fmt(after)} (redacted ${updated} rows, freed ${(((before - after) / before) * 100).toFixed(1)}%)`);

    expect(updated).toBe(40);
    // Rows are kept.
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(40);
    expect(after).toBeLessThan(before);

    const { details } = await db.getRequestDetails({ pageSize: 100 });
    for (const d of details) {
      expect(d.request).toEqual({ redacted: true });
      expect(d.response).toEqual({ redacted: true });
      // Untouched sections keep their payloads.
      expect(typeof d.providerRequest).toBe("object");
      expect(d.providerRequest.redacted).toBeUndefined();
      expect(typeof d.providerResponse).toBe("object");
      // Metadata survives.
      expect(d.tokens.prompt_tokens).toBe(100);
      expect(d.latency.ttft).toBe(120);
      expect(d.status).toBe("ok");
      expect(d.model).toBe("gpt-4o-mini");
    }
  });

  it("ignores unknown sections and no-ops when none match", async () => {
    // Self-contained: start from a clean table so earlier tests' purge state
    // doesn't decide this test's outcome.
    await db.clearRequestDetails();
    await seedDetails(20);

    const unknown = await db.clearRequestDetailContent(["bogus", "nope"]);
    expect(unknown.updated).toBe(0);

    const first = await db.clearRequestDetailContent(["providerRequest", "providerResponse"]);
    expect(first.updated).toBe(20);

    const { details } = await db.getRequestDetails({ pageSize: 5 });
    for (const d of details) {
      expect(d.providerRequest).toEqual({ redacted: true });
      expect(d.providerResponse).toEqual({ redacted: true });
      // Sections that were not selected keep their payloads.
      expect(d.request.redacted).toBeUndefined();
    }

    // Everything is already redacted: a repeat is a no-op.
    const again = await db.clearRequestDetailContent(["providerRequest", "providerResponse"]);
    expect(again.updated).toBe(0);
  });

  it("flushes buffered details before redacting so nothing lands unredacted", async () => {
    // Large batch + long interval: the next save stays in the write buffer.
    await db.updateSettings({ observabilityBatchSize: 1000, observabilityFlushIntervalMs: 60000 });
    vi.resetModules();
    const fresh = await import("@/lib/db/index.js");
    await fresh.updateSettings({ observabilityBatchSize: 1000, observabilityFlushIntervalMs: 60000 });

    await fresh.saveRequestDetail({
      id: "buffered-content",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4o-mini",
      request: { messages: [{ role: "user", content: "secret-buffered" }] },
      response: { content: "secret-buffered-out" },
    });

    await fresh.clearRequestDetailContent(["request", "response"]);

    const stored = adapter.get(`SELECT data FROM requestDetails WHERE id = 'buffered-content'`);
    expect(stored).toBeTruthy();
    const record = JSON.parse(stored.data);
    expect(record.request).toEqual({ redacted: true });
    expect(record.response).toEqual({ redacted: true });
    expect(JSON.stringify(record)).not.toContain("secret-buffered");
  });
});

describe("POST /api/usage/purge — details-content", () => {
  it("rejects missing or invalid sections with 400", async () => {
    const { POST } = await import("../../src/app/api/usage/purge/route.js");

    const missing = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({ target: "details-content" }),
    }));
    expect(missing.status).toBe(400);

    const bogus = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({ target: "details-content", sections: ["bogus"] }),
    }));
    expect(bogus.status).toBe(400);
  });

  it("returns updated count + sizes and keeps rows", async () => {
    const { POST } = await import("../../src/app/api/usage/purge/route.js");

    // Self-contained: earlier tests may have redacted some sections already.
    await db.clearRequestDetails();
    await seedUsage(5);
    await seedDetails(15);
    const detailRows = adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c;
    const historyRows = adapter.get(`SELECT COUNT(*) as c FROM usageHistory`).c;
    expect(detailRows).toBe(15);

    const res = await POST(new Request("http://localhost/api/usage/purge", {
      method: "POST",
      body: JSON.stringify({ target: "details-content", sections: ["providerRequest", "providerResponse"] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.target).toBe("details-content");
    expect(body.sections).toEqual(["providerRequest", "providerResponse"]);
    expect(body.updated).toBe(detailRows);
    expect(body.sizeAfter).toBeLessThan(body.sizeBefore);

    // Rows survive; usage history untouched.
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(detailRows);
    expect(adapter.get(`SELECT COUNT(*) as c FROM usageHistory`).c).toBe(historyRows);

    const { details } = await db.getRequestDetails({ pageSize: 100 });
    for (const d of details) {
      expect(d.providerRequest).toEqual({ redacted: true });
      expect(d.providerResponse).toEqual({ redacted: true });
    }
  });
});

describe("purge size estimate", () => {
  // The estimate is a dry run on a temp copy (VACUUM INTO + ATTACH + VACUUM).
  // Both paths end as compacted DBs of identical content, so the prediction
  // must match the real outcome; allow one page (4 KB) of slack for the
  // page-accounting differences between the attached and live VACUUM.
  const PAGE = 4096;

  it("predicts the real Overview purge outcome", async () => {
    await db.clearRequestDetails();
    await seedUsage(1500);
    await seedDetails(200);

    const { estimatePurgeSize } = await import("@/lib/db/helpers/maintenance.js");
    const est = await estimatePurgeSize("overview");
    expect(est.reason).toBeNull();
    expect(est.sizeAfter).toBeLessThan(est.sizeBefore);

    await db.clearUsageHistory();
    const realAfter = sizeOf();

    console.log(`[estimate] overview  predicted ${fmt(est.sizeAfter)} | real ${fmt(realAfter)} | before ${fmt(est.sizeBefore)}`);
    expect(Math.abs(est.sizeAfter - realAfter)).toBeLessThanOrEqual(PAGE);
  });

  it("predicts the real request-details purge outcome", async () => {
    await db.clearRequestDetails();
    await seedUsage(50);
    await seedDetails(300);

    const { estimatePurgeSize } = await import("@/lib/db/helpers/maintenance.js");
    const est = await estimatePurgeSize("details");
    expect(est.reason).toBeNull();

    await db.clearRequestDetails();
    const realAfter = sizeOf();

    console.log(`[estimate] details   predicted ${fmt(est.sizeAfter)} | real ${fmt(realAfter)} | before ${fmt(est.sizeBefore)}`);
    expect(Math.abs(est.sizeAfter - realAfter)).toBeLessThanOrEqual(PAGE);
  });

  it("content estimate tracks the section selection and matches the real purge", async () => {
    await db.clearRequestDetails();
    await seedDetails(200);

    const { estimatePurgeSize } = await import("@/lib/db/helpers/maintenance.js");
    const all = await estimatePurgeSize("details-content", ["request", "providerRequest", "providerResponse", "response"]);
    const one = await estimatePurgeSize("details-content", ["request"]);

    // Purging fewer sections leaves more data behind.
    expect(one.sizeAfter).toBeGreaterThan(all.sizeAfter);

    await db.clearRequestDetailContent(["request", "providerRequest", "providerResponse", "response"]);
    const realAfter = sizeOf();

    console.log(`[estimate] content   all4 ${fmt(all.sizeAfter)} | one ${fmt(one.sizeAfter)} | real ${fmt(realAfter)} | before ${fmt(all.sizeBefore)}`);
    expect(Math.abs(all.sizeAfter - realAfter)).toBeLessThanOrEqual(PAGE);
  });

  it("caches repeat estimates and does not touch the live DB", async () => {
    await db.clearRequestDetails();
    await seedDetails(40);
    const { estimatePurgeSize } = await import("@/lib/db/helpers/maintenance.js");

    const before = adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c;
    const first = await estimatePurgeSize("details");
    const second = await estimatePurgeSize("details");

    // Cached hit returns the identical object/values and no rows were removed.
    expect(second).toEqual(first);
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(before);
  });

  it("leaves no temp estimate dirs behind", async () => {
    await db.clearRequestDetails();
    await seedDetails(10);
    const { estimatePurgeSize } = await import("@/lib/db/helpers/maintenance.js");
    await estimatePurgeSize("details");

    const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("9router-estimate-"));
    expect(leftovers).toEqual([]);
  });

  it("skips oversized DBs via the pure size guard", async () => {
    const { estimateSkipReason } = await import("@/lib/db/helpers/maintenance.js");
    expect(estimateSkipReason(1024)).toBeNull();
    expect(estimateSkipReason(undefined)).toBe("unavailable");
    // 1 GB cap; pass a smaller max so no real file is needed.
    expect(estimateSkipReason(2048, 1024)).toBe("too-large");
  });
});

describe("POST /api/usage/purge/estimate", () => {
  it("rejects invalid targets and sections with 400", async () => {
    const { POST } = await import("../../src/app/api/usage/purge/estimate/route.js");

    const badTarget = await POST(new Request("http://localhost/api/usage/purge/estimate", {
      method: "POST",
      body: JSON.stringify({ target: "everything" }),
    }));
    expect(badTarget.status).toBe(400);

    const badSections = await POST(new Request("http://localhost/api/usage/purge/estimate", {
      method: "POST",
      body: JSON.stringify({ target: "details-content", sections: [] }),
    }));
    expect(badSections.status).toBe(400);
  });

  it("returns before/after for each target", async () => {
    const { POST } = await import("../../src/app/api/usage/purge/estimate/route.js");

    await db.clearRequestDetails();
    await seedUsage(100);
    await seedDetails(50);

    for (const body of [
      { target: "overview" },
      { target: "details" },
      { target: "details-content", sections: ["request"] },
    ]) {
      const res = await POST(new Request("http://localhost/api/usage/purge/estimate", {
        method: "POST",
        body: JSON.stringify(body),
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.sizeBefore).toBeGreaterThan(0);
      expect(data.sizeAfter).toBeLessThan(data.sizeBefore);
      expect(data.sizeAfter).toBeGreaterThan(0);
    }

    // The estimate must not have removed anything.
    expect(adapter.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(50);
  });
});
