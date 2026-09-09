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
  });
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
