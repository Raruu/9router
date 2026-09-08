import { setCatalogSource } from "open-sse/providers/capabilities.js";
import { setCatalogPricingSource } from "open-sse/providers/pricing.js";
import { getCatalogLimits, getCatalogModalities } from "open-sse/providers/catalogOverride.js";
import { getAdapter } from "../db/driver.js";
import { parseJson } from "../db/helpers/jsonCol.js";
import { mergeWithDefaults } from "../db/repos/settingsRepo.js";
import { createCatalogResolver } from "./resolution.js";
import { getHardcodedCatalogEntries } from "./catalog.js";
import { resolveProviderId } from "@/shared/constants/providers";

function loadUserRules(db) {
  return db.all(`SELECT provider, pattern, data FROM userModelCatalog`).map((row) => ({ ...row, data: parseJson(row.data, {}) }));
}

function loadOpenRouterRules(db) {
  return db.all(`SELECT pattern, data FROM openRouterModels`).map((row) => ({ provider: "*", ...row, data: parseJson(row.data, {}) }));
}

function loadCustomModels(db) {
  return db.all(`SELECT value FROM kv WHERE scope = 'customModels'`).map((row) => parseJson(row.value, {}));
}

function modelsDevCapabilities(provider, model) {
  return { ...(getCatalogModalities(model) || {}), ...(getCatalogLimits(provider, model) || {}) };
}

export async function refreshModelCatalogRuntime() {
  const db = await getAdapter();
  const settings = mergeWithDefaults(parseJson(db.get(`SELECT data FROM settings WHERE id = 1`)?.data, {}));
  const userRules = loadUserRules(db);
  const openRouterRules = loadOpenRouterRules(db);
  const customModels = loadCustomModels(db);
  const resolver = createCatalogResolver({
    userRules,
    openRouterRules,
    hardcodedRules: getHardcodedCatalogEntries().map((row) => ({ ...row, data: { capabilities: row.capabilities, pricing: row.pricing } })),
    customModels,
    priority: settings.modelCatalogPriority,
    normalizeProviderId: resolveProviderId,
  });
  const source = {
    getCapabilities(provider, model, hardcoded) {
      return resolver.getCapabilities(provider, model, { ...hardcoded, ...modelsDevCapabilities(provider, model) });
    },
    getPricing: resolver.getPricing,
  };
  setCatalogSource(source);
  setCatalogPricingSource(source);
  return source;
}

export const installModelCatalogRuntime = refreshModelCatalogRuntime;
