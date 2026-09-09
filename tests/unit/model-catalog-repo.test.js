import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-catalog-"));
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

describe("model catalog repository", () => {
  it("upserts user rules, replaces cache, and exports only portable rules", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.upsertUserModelCatalogRule({ provider: "Acme", pattern: "foo-*", name: "Foo", data: { capabilities: { vision: false }, pricing: { input: 3 } } });
    await db.replaceOpenRouterModels([{ pattern: "*foo*", normalizedModel: "foo", sourceId: "acme/foo", name: "Foo", data: { capabilities: { vision: true } }, fetchedAt: "2026-01-01T00:00:00.000Z" }]);

    const exported = await db.exportDb();
    expect(exported.userModelCatalog).toHaveLength(1);
    expect(exported.openRouterModels).toBeUndefined();

    await db.importDb(exported);
    expect(await db.getUserModelCatalog()).toMatchObject([{ provider: "acme", pattern: "foo-*" }]);
    expect(await db.getOpenRouterModels()).toEqual([]);
  });

  it("stores normalized OpenRouter pricing without mixing it into user overrides", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.replaceOpenRouterModels([{ pattern: "*catalog-price*", normalizedModel: "catalog-price", sourceId: "acme/catalog-price", name: null, data: { pricing: { input: 2, output: 4 } }, fetchedAt: "2026-01-01T00:00:00.000Z" }]);
    await db.updatePricing({ acme: { "catalog-price": { output: 9 } } });
    expect(await db.getOpenRouterModels()).toMatchObject([{ data: { pricing: { input: 2, output: 4 } } }]);
    const { getUserPricingTables } = await import("../../src/lib/db/repos/pricingRepo.js");
    expect(await getUserPricingTables()).toEqual({ acme: { "catalog-price": { output: 9 } } });
  });

  it("deletes one OpenRouter pattern without clearing the cache", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.replaceOpenRouterModels([
      { pattern: "*first*", normalizedModel: "first", sourceId: "acme/first", data: {}, fetchedAt: "2026-01-01T00:00:00.000Z" },
      { pattern: "*second*", normalizedModel: "second", sourceId: "acme/second", data: {}, fetchedAt: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(await db.deleteOpenRouterModel("*first*")).toBe(true);
    expect(await db.getOpenRouterModels()).toMatchObject([{ pattern: "*second*" }]);
  });

  it("stores and clears a custom model catalog reference", async () => {
    const db = await import("../../src/lib/db/index.js");
    const catalogRef = { source: "openrouter", provider: "*", pattern: "*claude*" };
    await db.addCustomModel({ providerAlias: "acme", id: "opaque", caps: { vision: true } });
    await db.addCustomModel({ providerAlias: "acme", id: "opaque", catalogRef });

    expect(await db.getCustomModels()).toMatchObject([{ id: "opaque", catalogRef }]);
    expect((await db.getCustomModels())[0].caps).toBeUndefined();

    await db.addCustomModel({ providerAlias: "acme", id: "opaque", clearCatalogMetadata: true });
    expect((await db.getCustomModels())[0].catalogRef).toBeUndefined();
  });

  it("renames user patterns and migrates matching custom model references atomically", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.createUserModelCatalogRule({
      provider: "*",
      pattern: "old-*",
      data: { capabilities: { vision: true } },
    });
    await db.addCustomModel({
      providerAlias: "acme",
      id: "opaque",
      catalogRef: { source: "user", provider: "*", pattern: "old-*" },
    });
    await db.addCustomModel({
      providerAlias: "acme",
      id: "other",
      catalogRef: { source: "openrouter", provider: "*", pattern: "old-*" },
    });

    await db.updateUserModelCatalogRule(
      { provider: "*", pattern: "old-*" },
      { provider: "*", pattern: "new-*", data: { capabilities: { reasoning: true } } },
    );

    expect(await db.getUserModelCatalog()).toMatchObject([{
      provider: "*",
      pattern: "new-*",
      data: { capabilities: { reasoning: true } },
    }]);
    const models = await db.getCustomModels();
    expect(models.find((model) => model.id === "opaque").catalogRef).toEqual({
      source: "user",
      provider: "*",
      pattern: "new-*",
    });
    expect(models.find((model) => model.id === "other").catalogRef.pattern).toBe("old-*");
  });

  it("leaves rules and references unchanged after a conflicting rename", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.createUserModelCatalogRule({ provider: "*", pattern: "first-*", data: {} });
    await db.createUserModelCatalogRule({ provider: "*", pattern: "second-*", data: {} });
    await db.addCustomModel({
      providerAlias: "acme",
      id: "opaque",
      catalogRef: { source: "user", provider: "*", pattern: "first-*" },
    });

    await expect(db.updateUserModelCatalogRule(
      { provider: "*", pattern: "first-*" },
      { provider: "*", pattern: "SECOND-*", data: {} },
    )).rejects.toMatchObject({ code: "MODEL_CATALOG_CONFLICT" });

    expect((await db.getUserModelCatalog()).map((rule) => rule.pattern)).toEqual(["first-*", "second-*"]);
    expect((await db.getCustomModels())[0].catalogRef.pattern).toBe("first-*");
  });
});
