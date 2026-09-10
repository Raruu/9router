import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-clear-lock-"));
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

describe("custom model lock", () => {
  it("toggles locked and reports missing models", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.addCustomModel({ providerAlias: "node-a", id: "m1" });

    expect(await db.setCustomModelLocked({ providerAlias: "node-a", id: "m1", locked: true })).toBe(true);
    expect(await db.getCustomModels()).toMatchObject([{ id: "m1", locked: true }]);

    expect(await db.setCustomModelLocked({ providerAlias: "node-a", id: "m1", locked: false })).toBe(true);
    expect((await db.getCustomModels())[0].locked).toBeUndefined();

    expect(await db.setCustomModelLocked({ providerAlias: "node-a", id: "nope", locked: true })).toBe(false);
  });

  it("preserves the lock across re-adds unless explicitly changed", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.addCustomModel({ providerAlias: "node-a", id: "m1" });
    await db.setCustomModelLocked({ providerAlias: "node-a", id: "m1", locked: true });

    await db.addCustomModel({ providerAlias: "node-a", id: "m1", name: "Renamed" });
    expect(await db.getCustomModels()).toMatchObject([{ id: "m1", name: "Renamed", locked: true }]);

    await db.addCustomModel({ providerAlias: "node-a", id: "m1", locked: false });
    expect((await db.getCustomModels())[0].locked).toBeUndefined();
  });
});

describe("clearProviderModels", () => {
  it("removes customs and aliases but keeps locked models, with counts", async () => {
    const db = await import("../../src/lib/db/index.js");
    await db.addCustomModel({ providerAlias: "node-a", id: "keep" });
    await db.addCustomModel({ providerAlias: "node-a", id: "drop" });
    await db.addCustomModel({ providerAlias: "node-b", id: "other" });
    await db.setCustomModelLocked({ providerAlias: "node-a", id: "keep", locked: true });
    await db.setModelAlias("alias-a", "node-a/drop");
    await db.setModelAlias("alias-b", "node-b/other");

    const result = await db.clearProviderModels("node-a");
    expect(result).toEqual({ deleted: 1, skippedLocked: 1, aliasesDeleted: 1 });

    expect(await db.getCustomModels()).toMatchObject([
      { providerAlias: "node-a", id: "keep" },
      { providerAlias: "node-b", id: "other" },
    ]);
    expect(await db.getModelAliases()).toEqual({ "alias-b": "node-b/other" });
  });

  it("is a no-op with zero counts for an unknown provider", async () => {
    const db = await import("../../src/lib/db/index.js");
    await expect(db.clearProviderModels("node-missing")).resolves.toEqual({
      deleted: 0,
      skippedLocked: 0,
      aliasesDeleted: 0,
    });
  });
});

describe("combo member matching", () => {
  it("matches either id form and strips members while keeping the combo", async () => {
    const { filterCombosUsingModel, stripModelsFromComboMembers } = await import("../../src/shared/utils/comboMembers.js");
    const combos = [
      { id: "c1", name: "one", models: ["node-id-1/m1", "openai/gpt-4o"] },
      { id: "c2", name: "two", models: ["other/m9"] },
      { id: "c3", name: "three" },
    ];

    expect(filterCombosUsingModel(combos, ["node-id-1/m1"])).toMatchObject([{ id: "c1" }]);
    expect(filterCombosUsingModel(combos, ["prefix-1/m1"])).toEqual([]);
    expect(filterCombosUsingModel(combos, ["prefix-1/m1", "node-id-1/m1"])).toMatchObject([{ id: "c1" }]);
    expect(filterCombosUsingModel(combos, [])).toEqual([]);
    expect(filterCombosUsingModel(null, ["node-id-1/m1"])).toEqual([]);

    expect(stripModelsFromComboMembers(["node-id-1/m1", "openai/gpt-4o"], ["node-id-1/m1"])).toEqual(["openai/gpt-4o"]);
    expect(stripModelsFromComboMembers(["node-id-1/m1"], ["node-id-1/m1", "prefix-1/m1"])).toEqual([]);
    expect(stripModelsFromComboMembers(null, ["node-id-1/m1"])).toEqual([]);
  });
});
