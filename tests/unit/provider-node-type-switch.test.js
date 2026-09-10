import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-node-convert-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("../../src/lib/modelCatalog/runtime.js", () => ({
    refreshModelCatalogRuntime: vi.fn(async () => null),
  }));
});

afterEach(() => {
  vi.doUnmock("../../src/lib/modelCatalog/runtime.js");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function seedOpenAiNode(db, id = "openai-compatible-chat-seed") {
  const node = await db.createProviderNode({
    id,
    type: "openai-compatible",
    name: "Seed OC",
    prefix: "oc-seed",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  await db.createProviderConnection({
    provider: node.id,
    authType: "apikey",
    name: "key-1",
    providerSpecificData: { prefix: "oc-seed", apiType: "chat", baseUrl: "https://api.openai.com/v1", nodeName: "Seed OC" },
  });
  await db.addCustomModel({ providerAlias: node.id, id: "seed-model", type: "llm" });
  await db.setModelAlias("seed-alias", `${node.id}/seed-model`);
  await db.disableModels(node.id, ["seed-model"]);
  await db.updateSettings({
    providerStrategies: { [node.id]: { fallbackStrategy: "round-robin" } },
    providerThinking: { [node.id]: { mode: "high" } },
    quotaVisibility: { [node.id]: { hidden: [] } },
    providerTimeouts: { [node.id]: { connectMs: 2000 } },
    providerRetries: { [node.id]: { enabled: true, tries: 3 } },
    capacityAdapter: { vision: { enabled: true, models: [`${node.id}/seed-model`, "other-p/other-model"] } },
  });
  await db.updatePricing({ [node.id]: { "seed-model": { input: 1.5, output: 3 } } });
  await db.createCombo({ name: "seed-combo", models: [`${node.id}/seed-model`, "other-p/other-model"] });
  await db.setMitmAliasAll("seed-tool", { Claude: `${node.id}/seed-model`, Other: "other-p/other-model" });
  // Distinct mid-day timestamps: saveRequestUsage dedupes identical rows.
  const t0 = new Date("2026-09-10T12:00:01.000Z").toISOString();
  const t1 = new Date("2026-09-10T12:00:02.000Z").toISOString();
  const usage = { model: "seed-model", connectionId: "conn-seed", endpoint: "chat/completions", tokens: { prompt_tokens: 10, completion_tokens: 5 } };
  await db.saveRequestUsage({ ...usage, timestamp: t0, provider: node.id });
  await db.saveRequestUsage({ ...usage, timestamp: t1, provider: node.id, tokens: { prompt_tokens: 20, completion_tokens: 7 } });
  await db.saveRequestUsage({ ...usage, timestamp: t1, provider: "other-p", model: "other-model", connectionId: "conn-other" });
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  const adapter = await getAdapter();
  adapter.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ["rd-seed-1", t0, node.id, "seed-model", "conn-seed", "ok", JSON.stringify({ id: "rd-seed-1", provider: node.id, model: "seed-model" })]
  );
  return node;
}

describe("buildCompatibleNodeId", () => {
  it("uses the same id scheme as node creation", async () => {
    const { buildCompatibleNodeId } = await import("../../src/lib/db/repos/nodesRepo.js");
    expect(buildCompatibleNodeId("openai-compatible", "chat", "abc")).toBe("openai-compatible-chat-abc");
    expect(buildCompatibleNodeId("openai-compatible", "responses", "abc")).toBe("openai-compatible-responses-abc");
    expect(buildCompatibleNodeId("anthropic-compatible", null, "abc")).toBe("anthropic-compatible-abc");
  });
});

describe("convertProviderNodeType", () => {
  it("moves an OpenAI node to Anthropic with every reference migrated", async () => {
    const db = await import("../../src/lib/db/index.js");
    const node = await seedOpenAiNode(db);

    const converted = await db.convertProviderNodeType(node.id, {
      type: "anthropic-compatible",
      name: "Seed AC",
      prefix: "oc-seed",
      baseUrl: "https://api.anthropic.com/v1/",
    });

    expect(converted.id).toMatch(/^anthropic-compatible-/);
    expect(converted.type).toBe("anthropic-compatible");
    expect(converted.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(converted.apiType).toBeUndefined();
    expect(await db.getProviderNodeById(node.id)).toBeNull();

    const connections = await db.getProviderConnections({ provider: converted.id });
    expect(connections).toHaveLength(1);
    expect(connections[0].providerSpecificData).toMatchObject({
      prefix: "oc-seed",
      baseUrl: "https://api.anthropic.com/v1",
      nodeName: "Seed AC",
    });
    expect(connections[0].providerSpecificData.apiType).toBeUndefined();
    expect(await db.getProviderConnections({ provider: node.id })).toEqual([]);

    expect(await db.getCustomModels()).toMatchObject([{ providerAlias: converted.id, id: "seed-model" }]);
    expect(await db.getModelAliases()).toEqual({ "seed-alias": `${converted.id}/seed-model` });
    expect(await db.getDisabledByProvider(converted.id)).toEqual(["seed-model"]);
    expect(await db.getDisabledByProvider(node.id)).toEqual([]);

    const settings = await db.getSettings();
    expect(settings.providerStrategies).toEqual({ [converted.id]: { fallbackStrategy: "round-robin" } });
    expect(settings.providerThinking).toEqual({ [converted.id]: { mode: "high" } });
    expect(settings.quotaVisibility).toEqual({ [converted.id]: { hidden: [] } });
    expect(settings.providerTimeouts).toEqual({ [converted.id]: { connectMs: 2000 } });
    expect(settings.providerRetries).toEqual({ [converted.id]: { enabled: true, tries: 3 } });
    expect(settings.capacityAdapter.vision.models).toEqual([`${converted.id}/seed-model`, "other-p/other-model"]);

    const combos = await db.getCombos();
    expect(combos.find((c) => c.name === "seed-combo").models).toEqual([`${converted.id}/seed-model`, "other-p/other-model"]);

    const pricing = await db.getPricing();
    expect(pricing[converted.id]?.["seed-model"]).toMatchObject({ input: 1.5, output: 3 });
    expect(pricing[node.id]).toBeUndefined();

    expect(await db.getMitmAlias("seed-tool")).toEqual({ Claude: `${converted.id}/seed-model`, Other: "other-p/other-model" });

    // Usage history follows the converted provider; unrelated rows untouched.
    expect(await db.getUsageHistory({ provider: node.id })).toEqual([]);
    expect(await db.getUsageHistory({ provider: converted.id })).toHaveLength(2);
    expect(await db.getUsageHistory({ provider: "other-p" })).toHaveLength(1);

    // Request details: column and embedded JSON provider both rewritten.
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter.all(`SELECT provider FROM requestDetails WHERE provider = ?`, [node.id])).toEqual([]);
    const detailRow = adapter.get(`SELECT provider, data FROM requestDetails WHERE id = 'rd-seed-1'`);
    expect(detailRow.provider).toBe(converted.id);
    expect(JSON.parse(detailRow.data).provider).toBe(converted.id);

    // Daily aggregates re-keyed under the new id (day totals unchanged).
    const blob = JSON.parse(adapter.get(`SELECT data FROM usageDaily`).data);
    expect(blob.byProvider[converted.id]?.requests).toBe(2);
    expect(blob.byProvider[node.id]).toBeUndefined();
    expect(blob.byModel[`seed-model|${converted.id}`]?.requests).toBe(2);
    expect(blob.byModel[`seed-model|${converted.id}`]?.provider).toBe(converted.id);
    expect(blob.byModel[`other-model|other-p`]?.requests).toBe(1);
    expect(blob.requests).toBe(3);
  });

  it("moves an Anthropic node to OpenAI with the requested apiType", async () => {
    const db = await import("../../src/lib/db/index.js");
    const node = await db.createProviderNode({
      id: "anthropic-compatible-seed",
      type: "anthropic-compatible",
      name: "Seed AC",
      prefix: "ac-seed",
      baseUrl: "https://api.anthropic.com/v1",
    });

    const converted = await db.convertProviderNodeType(node.id, {
      type: "openai-compatible",
      apiType: "responses",
      name: "Seed OC",
      prefix: "ac-seed",
      baseUrl: "https://oai.example.com/v1",
    });

    expect(converted.id).toMatch(/^openai-compatible-responses-/);
    expect(converted.apiType).toBe("responses");
    expect(await db.getProviderNodeById(node.id)).toBeNull();
  });

  it("returns null for a missing node", async () => {
    const db = await import("../../src/lib/db/index.js");
    await expect(db.convertProviderNodeType("openai-compatible-chat-missing", {
      type: "anthropic-compatible",
      name: "x",
      prefix: "x",
      baseUrl: "https://example.com/v1",
    })).resolves.toBeNull();
  });

  it("rejects invalid target types, missing apiType, and same-type conversion", async () => {
    const db = await import("../../src/lib/db/index.js");
    const node = await seedOpenAiNode(db, "openai-compatible-chat-guard");

    await expect(db.convertProviderNodeType(node.id, {
      type: "custom-embedding",
      name: "x",
      prefix: "x",
      baseUrl: "https://example.com/v1",
    })).rejects.toThrow("Invalid provider node type");

    await expect(db.convertProviderNodeType(node.id, {
      type: "openai-compatible",
      apiType: "chat",
      name: "x",
      prefix: "x",
      baseUrl: "https://example.com/v1",
    })).rejects.toThrow("already has this type");

    await expect(db.convertProviderNodeType(node.id, {
      type: "openai-compatible",
      name: "x",
      prefix: "x",
      baseUrl: "https://example.com/v1",
    })).rejects.toThrow("Invalid OpenAI compatible API type");

    // Failed conversions leave the source node untouched.
    expect(await db.getProviderNodeById(node.id)).not.toBeNull();
    expect(await db.getProviderConnections({ provider: node.id })).toHaveLength(1);
  });
});

describe("remapUsageDay", () => {
  it("renames provider buckets and composite keys, fixing embedded meta", async () => {
    const db = await import("../../src/lib/db/index.js");
    const day = {
      requests: 2, promptTokens: 30, completionTokens: 12, cost: 0.5,
      byProvider: { "old-p": { requests: 2, promptTokens: 30, completionTokens: 12, cachedTokens: 0, cost: 0.5 } },
      byModel: { "m|old-p": { requests: 2, promptTokens: 30, completionTokens: 12, cachedTokens: 0, cost: 0.5, rawModel: "m", provider: "old-p" } },
      byAccount: { "conn-1": { requests: 2, promptTokens: 30, completionTokens: 12, cachedTokens: 0, cost: 0.5, rawModel: "m", provider: "old-p" } },
      byApiKey: { "k|m|old-p": { requests: 2, promptTokens: 30, completionTokens: 12, cachedTokens: 0, cost: 0.5, rawModel: "m", provider: "old-p" } },
      byEndpoint: { "chat|m|old-p": { requests: 2, promptTokens: 30, completionTokens: 12, cachedTokens: 0, cost: 0.5, provider: "old-p" } },
    };
    expect(db.remapUsageDay(day, "old-p", "new-p")).toBe(true);
    expect(day.byProvider).toEqual({ "new-p": { requests: 2, promptTokens: 30, completionTokens: 12, cachedTokens: 0, cost: 0.5 } });
    expect(day.byModel["m|new-p"]).toMatchObject({ requests: 2, provider: "new-p", rawModel: "m" });
    expect(day.byModel["m|old-p"]).toBeUndefined();
    // Account buckets stay keyed by connection id; only meta moves.
    expect(day.byAccount["conn-1"]).toMatchObject({ requests: 2, provider: "new-p" });
    expect(day.byApiKey["k|m|new-p"]).toMatchObject({ requests: 2, provider: "new-p" });
    expect(day.byEndpoint["chat|m|new-p"]).toMatchObject({ requests: 2, provider: "new-p" });
    // Day-level totals are untouched by a re-key.
    expect(day.requests).toBe(2);
    expect(day.cost).toBe(0.5);
  });

  it("merges counters when the new-id bucket already exists", async () => {
    const db = await import("../../src/lib/db/index.js");
    const day = {
      requests: 3,
      byProvider: {
        "old-p": { requests: 2, promptTokens: 20, completionTokens: 10, cachedTokens: 1, cost: 0.4 },
        "new-p": { requests: 1, promptTokens: 5, completionTokens: 2, cachedTokens: 0, cost: 0.1 },
      },
      byModel: {
        "m|old-p": { requests: 2, promptTokens: 20, completionTokens: 10, cachedTokens: 1, cost: 0.4, rawModel: "m", provider: "old-p" },
        "m|new-p": { requests: 1, promptTokens: 5, completionTokens: 2, cachedTokens: 0, cost: 0.1, rawModel: "m", provider: "new-p" },
      },
    };
    expect(db.remapUsageDay(day, "old-p", "new-p")).toBe(true);
    expect(day.byProvider["new-p"]).toMatchObject({ requests: 3, promptTokens: 25, completionTokens: 12, cachedTokens: 1, cost: 0.5 });
    expect(day.byProvider["old-p"]).toBeUndefined();
    expect(day.byModel["m|new-p"]).toMatchObject({ requests: 3, promptTokens: 25, provider: "new-p" });
    expect(day.byModel["m|old-p"]).toBeUndefined();
    expect(day.requests).toBe(3);
  });

  it("returns false and changes nothing without the old id", async () => {
    const db = await import("../../src/lib/db/index.js");
    const day = { requests: 1, byProvider: { "other-p": { requests: 1 } } };
    expect(db.remapUsageDay(day, "old-p", "new-p")).toBe(false);
    expect(day).toEqual({ requests: 1, byProvider: { "other-p": { requests: 1 } } });
    expect(db.remapUsageDay(null, "old-p", "new-p")).toBe(false);
    expect(db.remapUsageDay({}, "old-p", "new-p")).toBe(false);
  });
});
