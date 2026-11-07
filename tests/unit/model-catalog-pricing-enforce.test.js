import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Model Catalog → "Enforce catalog pricing": when on, usage cost follows the
// catalog Resolution order and a Pricing-page override stops winning while the
// catalog resolves a price. Off keeps the historical precedence.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

const CAPABILITY_SOURCE_KEY = Symbol.for("9router.modelCatalog.capabilitySource");
const PRICING_SOURCE_KEY = Symbol.for("9router.modelCatalog.pricingSource");

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-catalog-pricing-"));
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

// Catalog rule priced 1/2 for acme/priced-model, plus a Pricing-page override
// priced 9/9 for the same model and 5/6 for a model the catalog cannot price.
async function seedPricing({ enforce = false } = {}) {
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO userModelCatalog(provider, pattern, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)`,
    ["acme", "priced-model", "Priced", JSON.stringify({ pricing: { input: 1, output: 2 } }), now, now],
  );

  const { updatePricing } = await import("../../src/lib/db/repos/pricingRepo.js");
  await updatePricing({
    acme: {
      "priced-model": { input: 9, output: 9 },
      "zzz-unpriced-model": { input: 5, output: 6 },
    },
  });

  const { installModelCatalogRuntime } = await import("../../src/lib/modelCatalog/runtime.js");
  await installModelCatalogRuntime();

  if (enforce) {
    const { updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
    await updateSettings({ modelCatalogEnforcePricing: true });
  }
}

describe("model catalog pricing enforcement", () => {
  it("defaults off and rejects a non-boolean update", async () => {
    const { getSettings, updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
    expect((await getSettings()).modelCatalogEnforcePricing).toBe(false);

    await updateSettings({ modelCatalogEnforcePricing: true });
    expect((await getSettings()).modelCatalogEnforcePricing).toBe(true);

    await expect(updateSettings({ modelCatalogEnforcePricing: "yes" })).rejects.toThrow(/pricing enforce/i);
  });

  it("round-trips through the catalog backend and validates the setter", async () => {
    const backend = await import("../../src/app/api/models/catalog/_backend.js");
    expect((await backend.getCatalog()).pricingEnforce).toBe(false);

    await backend.setEnforcePricing(true);
    expect((await backend.getCatalog()).pricingEnforce).toBe(true);

    await expect(backend.setEnforcePricing("yes")).rejects.toThrow(/boolean/i);
  });

  it("keeps the Pricing-page override while the switch is off", async () => {
    await seedPricing({ enforce: false });
    const { getPricingForModel } = await import("../../src/lib/db/repos/pricingRepo.js");
    expect(await getPricingForModel("acme", "priced-model")).toEqual({ input: 9, output: 9 });
  });

  it("lets the resolved catalog price win once enforcement is on", async () => {
    await seedPricing({ enforce: true });
    const { getPricingForModel } = await import("../../src/lib/db/repos/pricingRepo.js");
    expect(await getPricingForModel("acme", "priced-model")).toEqual({ input: 1, output: 2 });
  });

  it("still applies the override for a model the catalog cannot price", async () => {
    await seedPricing({ enforce: true });
    const { getPricingForModel } = await import("../../src/lib/db/repos/pricingRepo.js");
    expect(await getPricingForModel("acme", "zzz-unpriced-model")).toEqual({ input: 5, output: 6 });
  });

  it("exposes the flag to independently bundled pricing modules", async () => {
    await seedPricing({ enforce: true });
    // Next loads cost code from its own chunk; reset the module registry to
    // reproduce that independent instance while the process-global source stays.
    vi.resetModules();
    const { isCatalogPricingEnforced } = await import("../../open-sse/providers/pricing.js");
    expect(isCatalogPricingEnforced()).toBe(true);
  });
});
