// Thinking Effort Classifier — DB table, repo CRUD, export/import round-trip.
// Runs on an isolated DATA_DIR like the other DB-backed suites.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-classifiers-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("thinkingClassifiers table", () => {
  it("is created on a fresh DB with its unique name index", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const tables = adapter.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tables).toContain("thinkingClassifiers");
    const indexes = adapter.all(`SELECT name FROM sqlite_master WHERE type='index'`).map((i) => i.name);
    expect(indexes).toContain("idx_tc_name");
  });
});

describe("thinkingClassifiersRepo", () => {
  it("creates a profile seeded from the generic template", async () => {
    const created = await db.createThinkingClassifier({ name: "generic", models: [{ model: "oc/jev-1.13-free" }] });
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("generic");
    expect(created.isActive).toBe(true);
    expect(created.mode).toBe("argmax");
    expect(Array.isArray(created.questions)).toBe(true);
    expect(created.questions.length).toBeGreaterThan(0);
    expect(created.fallbackLevel).toBe("medium");
    expect(created.inputMode).toBe("latest-turn");
    expect(created.tailTurns).toBe(6);
    expect(created.tailTokens).toBe(500);
    expect(created.models[0].model).toBe("oc/jev-1.13-free");
  });

  it("lists profiles in creation order and resolves by id/name", async () => {
    await db.createThinkingClassifier({ name: "laya", models: [{ model: "oc/jev-1.13-free" }] });
    const all = await db.getThinkingClassifiers();
    expect(all.map((c) => c.name)).toEqual(["generic", "laya"]);

    const byName = await db.getThinkingClassifierByName("laya");
    expect(byName.name).toBe("laya");
    const byId = await db.getThinkingClassifierById(byName.id);
    expect(byId.name).toBe("laya");
  });

  it("updates fields and toggles active", async () => {
    const before = await db.getThinkingClassifierByName("laya");
    const updated = await db.updateThinkingClassifier(before.id, { fallbackLevel: "high", isActive: false });
    expect(updated.fallbackLevel).toBe("high");
    expect(updated.isActive).toBe(false);

    const activeNames = await db.getActiveClassifierNames();
    expect(activeNames).toEqual(["generic"]);
  });

  it("enforces name uniqueness at the DB level", async () => {
    await expect(db.createThinkingClassifier({ name: "generic", models: [{ model: "oc/jev-1.13-free" }] })).rejects.toThrow();
  });

  it("deletes a profile", async () => {
    const target = await db.getThinkingClassifierByName("laya");
    expect(await db.deleteThinkingClassifier(target.id)).toBe(true);
    expect(await db.getThinkingClassifierById(target.id)).toBeNull();
    expect(await db.getThinkingClassifierByName("laya")).toBeNull();
  });

  it("round-trips through exportDb/importDb", async () => {
    await db.createThinkingClassifier({ name: "roundtrip", models: [{ model: "oc/jev-1.13-free" }], fallbackLevel: "high" });
    const dump = await db.exportDb();
    expect(Array.isArray(dump.thinkingClassifiers)).toBe(true);
    const exported = dump.thinkingClassifiers.find((c) => c.name === "roundtrip");
    expect(exported).toBeTruthy();
    expect(exported.fallbackLevel).toBe("high");

    await db.importDb(dump);
    const restored = await db.getThinkingClassifierByName("roundtrip");
    expect(restored.fallbackLevel).toBe("high");
    expect(restored.models[0].model).toBe("oc/jev-1.13-free");
  });
});
