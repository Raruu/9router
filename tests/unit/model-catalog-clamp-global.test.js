// Global output-clamp toggle — Model Catalog → "Clamp output to Max output".
//
// The page-level toggle stores `modelCatalogClampMaxOutput` in settings and is
// injected by the runtime resolver as `clampMaxOutput: true` for models whose
// rules say nothing (undefined). A rule's own true/false always wins. This
// exercises the real DB → runtime → refine() chain with an isolated DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-clamp-global-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function seedRule(capabilities) {
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  const db = await getAdapter();
  const now = "2026-10-06T00:00:00.000Z";
  db.run(
    `INSERT INTO userModelCatalog(provider, pattern, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)`,
    ["acme", "big-*", "Big", JSON.stringify({ capabilities }), now, now],
  );
}

describe("global clamp toggle through the runtime", () => {
  it("injects clampMaxOutput for rules that inherit, off by default", async () => {
    await seedRule({ maxOutput: 128000 });
    const { installModelCatalogRuntime } = await import("../../src/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    const caps = getCapabilitiesForModel("acme", "big-1");
    expect(caps.maxOutput).toBe(128000);
    expect(caps.maxOutputClamp).toBeUndefined();
  });

  it("engages when the setting is on and the rule says nothing", async () => {
    await seedRule({ maxOutput: 128000 });
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, [JSON.stringify({ modelCatalogClampMaxOutput: true })]);

    const { installModelCatalogRuntime } = await import("../../src/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    expect(getCapabilitiesForModel("acme", "big-1").maxOutputClamp).toBe(128000);
  });

  it("lets a rule opt out even when the setting is on", async () => {
    await seedRule({ maxOutput: 128000, clampMaxOutput: false });
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, [JSON.stringify({ modelCatalogClampMaxOutput: true })]);

    const { installModelCatalogRuntime } = await import("../../src/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    expect(getCapabilitiesForModel("acme", "big-1").maxOutputClamp).toBeUndefined();
  });

  it("never clamps a model without an explicit ceiling", async () => {
    await seedRule({ reasoning: true });
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, [JSON.stringify({ modelCatalogClampMaxOutput: true })]);

    const { installModelCatalogRuntime } = await import("../../src/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    const caps = getCapabilitiesForModel("acme", "big-1");
    expect(caps.maxOutput).toBe(64000);
    expect(caps.maxOutputClamp).toBeUndefined();
  });

  it("setClampMaxOutput persists and rejects non-booleans", async () => {
    const backend = await import("../../src/app/api/models/catalog/_backend.js");
    await backend.setClampMaxOutput(true);
    expect((await backend.getCatalog()).clampMaxOutput).toBe(true);
    await expect(backend.setClampMaxOutput("yes")).rejects.toMatchObject({ status: 400 });
  });
});
