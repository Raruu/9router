// Regression: the Breakdown tab's "By Provider" chart used to print the raw
// generated node id ("openai-compatible-chat-<uuid>") instead of the node's
// routing prefix. getUsageStats now attaches a display-only `label` to every
// byProvider bucket on both aggregation paths (live history for today/24h,
// daily rollup for 7d/30d/60d/all), while the bucket key stays the raw id so
// byModel/byAccount keys keep joining against it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

const NODE_ID = "openai-compatible-chat-007fabcf-0cc4-4f85-bf26-b57fc42681ea";

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-label-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();

  const { createProviderNode } = await import("@/lib/db/repos/nodesRepo.js");
  await createProviderNode({
    id: NODE_ID,
    type: "openai-compatible",
    name: "JustWoker",
    prefix: "just-woker",
    apiType: "chat",
    baseUrl: "https://example.invalid/v1",
  });
  // Node without a prefix: label must fall back to the raw id.
  await createProviderNode({
    id: "anthropic-compatible-11111111-2222-3333-4444-555555555555",
    type: "anthropic-compatible",
    name: "NoPrefix",
    baseUrl: "https://example.invalid",
  });

  const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
  await saveRequestUsage({
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    provider: NODE_ID,
    model: "glm-4.7",
    tokens: { prompt_tokens: 100, completion_tokens: 50 },
    ttft: 120,
    totalLatency: 400,
  });
  await saveRequestUsage({
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    provider: "anthropic-compatible-11111111-2222-3333-4444-555555555555",
    model: "claude-opus-5",
    tokens: { prompt_tokens: 10, completion_tokens: 5 },
  });
  await saveRequestUsage({
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    tokens: { prompt_tokens: 20, completion_tokens: 10 },
  });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("byProvider display label", () => {
  it("labels a custom node with its prefix on the live (24h) path", async () => {
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");

    expect(stats.byProvider[NODE_ID]).toBeDefined();
    expect(stats.byProvider[NODE_ID].label).toBe("just-woker");
    // Key must stay the raw id: the chart keys rows by it, and byModel joins
    // against the same string.
    expect(Object.keys(stats.byProvider)).toContain(NODE_ID);
  });

  it("labels a custom node with its prefix on the daily (7d) path", async () => {
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("7d");

    expect(stats.byProvider[NODE_ID].label).toBe("just-woker");
    expect(stats.byProvider[NODE_ID].requests).toBe(1);
    // Daily blob must not persist the label — it is derived at read time.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const row = adapter.get(`SELECT data FROM usageDaily ORDER BY dateKey DESC LIMIT 1`);
    const day = JSON.parse(row.data);
    expect(day.byProvider[NODE_ID].label).toBeUndefined();
  });

  it("falls back to the raw id when the node has no prefix", async () => {
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");
    const noPrefixId = "anthropic-compatible-11111111-2222-3333-4444-555555555555";
    expect(stats.byProvider[noPrefixId].label).toBe(noPrefixId);
  });

  it("falls back to the raw id for built-in providers", async () => {
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");
    expect(stats.byProvider.anthropic.label).toBe("anthropic");
  });

  it("keeps the byModel join keyed by the raw provider id", async () => {
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const stats = await getUsageStats("24h");
    expect(stats.byModel[`glm-4.7 (${NODE_ID})`]).toBeDefined();
    // Node name, not prefix — the table's Badge shows the node name.
    expect(stats.byModel[`glm-4.7 (${NODE_ID})`].provider).toBe("JustWoker");
  });
});
