import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CAPABILITY_SOURCE_KEY = Symbol.for("9router.modelCatalog.capabilitySource");
const PRICING_SOURCE_KEY = Symbol.for("9router.modelCatalog.pricingSource");

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-catalog-cold-start-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete globalThis[CAPABILITY_SOURCE_KEY];
  delete globalThis[PRICING_SOURCE_KEY];
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete globalThis[CAPABILITY_SOURCE_KEY];
  delete globalThis[PRICING_SOURCE_KEY];
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function insertCustomModel(db, id, catalogRef) {
  const value = JSON.stringify({ providerAlias: "acme", id, type: "llm", name: id, catalogRef });
  db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [`acme|${id}|llm`, value]);
}

describe("model catalog cold-start hydration", () => {
  it("shares persisted user and OpenRouter assignments with independently bundled consumers", async () => {
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const db = await getAdapter();
    const now = "2026-09-10T00:00:00.000Z";

    db.run(
      `INSERT INTO userModelCatalog(provider, pattern, name, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?)`,
      ["*", "assigned-user", "Assigned user", JSON.stringify({
        capabilities: { reasoning: true, contextWindow: 123456 },
        pricing: { input: 1.25, output: 2.5 },
      }), now, now],
    );
    db.run(
      `INSERT INTO openRouterModels(pattern, normalizedModel, sourceId, name, data, fetchedAt)
       VALUES(?, ?, ?, ?, ?, ?)`,
      ["*assigned-openrouter*", "assigned-openrouter", "acme/assigned-openrouter", "Assigned OpenRouter", JSON.stringify({
        capabilities: { vision: true, maxOutput: 6543 },
        pricing: { input: 3.5, output: 7 },
      }), now],
    );
    insertCustomModel(db, "opaque-user", { source: "user", provider: "*", pattern: "assigned-user" });
    insertCustomModel(db, "opaque-openrouter", { source: "openrouter", provider: "*", pattern: "*assigned-openrouter*" });

    // Instrumentation installs the resolver in one webpack chunk at startup.
    const { installModelCatalogRuntime } = await import("../../src/lib/modelCatalog/runtime.js");
    await installModelCatalogRuntime();

    // Next production routes load capabilities/pricing from separate chunks.
    // Resetting modules reproduces that independent module instance while the
    // process (and the resolver installed during startup) remains alive.
    vi.resetModules();
    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");

    expect(getCapabilitiesForModel("acme", "opaque-user")).toMatchObject({
      reasoning: true,
      contextWindow: 123456,
    });
    expect(getPricingForModel("acme", "opaque-user")).toEqual({ input: 1.25, output: 2.5 });
    expect(getCapabilitiesForModel("acme", "opaque-openrouter")).toMatchObject({
      vision: true,
      maxOutput: 6543,
    });
    expect(getPricingForModel("acme", "opaque-openrouter")).toEqual({ input: 3.5, output: 7 });
  });
});
