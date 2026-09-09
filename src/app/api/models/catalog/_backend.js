import {
  clearOpenRouterModels,
  createUserModelCatalogRule,
  deleteOpenRouterModel,
  deleteUserModelCatalogRule,
  getOpenRouterModels,
  getSettings,
  getUserModelCatalog,
  replaceOpenRouterModels,
  updateUserModelCatalogRule,
  updateSettings,
} from "@/lib/db/index.js";
import { ModelCatalogConflictError, ModelCatalogNotFoundError } from "@/lib/modelCatalog/repository.js";
import { getHardcodedCatalogEntries } from "@/lib/modelCatalog/catalog.js";
import { normalizeOpenRouterModels } from "@/lib/modelCatalog/normalize.js";
import { sanitizeCatalogData } from "@/lib/modelCatalog/validation.js";

export const PRIORITIES = [
  "user-openrouter-hardcoded",
  "user-hardcoded-openrouter",
];

const BOOLEAN_CAPABILITIES = [
  "vision",
  "pdf",
  "audioInput",
  "videoInput",
  "imageOutput",
  "audioOutput",
  "tools",
  "reasoning",
];

const PRICING_FIELDS = [
  "input",
  "output",
  "cached",
  "reasoning",
  "cache_creation",
];

export class CatalogBackendError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "CatalogBackendError";
    this.status = status;
  }
}

function hardcodedEntries() {
  return getHardcodedCatalogEntries();
}

export async function getCatalog() {
  const [settings, users, openrouter] = await Promise.all([
    getSettings(),
    getUserModelCatalog(),
    getOpenRouterModels(),
  ]);
  return {
    priority: settings.modelCatalogPriority,
    userDefined: users.map((row) => ({ source: "user", ...row, ...row.data, pricingPerMillion: true })),
    openrouter: {
      models: openrouter.map((row) => ({ source: "openrouter", provider: "*", matchType: "glob", ...row, ...row.data, pricingPerMillion: true })),
      count: openrouter.length,
      fetchedAt: openrouter[0]?.fetchedAt || null,
    },
    hardcoded: hardcodedEntries(),
  };
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new CatalogBackendError(`${field} must be a string`, 400);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new CatalogBackendError(`${field} must be between 1 and ${maxLength} characters`, 400);
  }
  return normalized;
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new CatalogBackendError(`${field} must be a non-negative number`, 400);
  }
  return number;
}

export function validateUserEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogBackendError("A model catalog entry is required", 400);
  }
  const provider = optionalString(value.provider, "provider", 100);
  const pattern = optionalString(value.pattern, "pattern", 300);
  const matchType = value.matchType;
  if (!provider || !pattern) throw new CatalogBackendError("provider and pattern are required", 400);
  if (matchType !== "exact" && matchType !== "glob") {
    throw new CatalogBackendError("matchType must be exact or glob", 400);
  }
  if (matchType === "exact" && pattern.includes("*")) {
    throw new CatalogBackendError("Exact patterns cannot contain *", 400);
  }
  if (matchType === "glob" && !pattern.includes("*")) {
    throw new CatalogBackendError("Glob patterns must contain *", 400);
  }

  const capabilities = {};
  for (const field of BOOLEAN_CAPABILITIES) {
    const setting = value.capabilities?.[field];
    if (setting !== null && setting !== undefined && typeof setting !== "boolean") {
      throw new CatalogBackendError(`${field} must be inherit, yes, or no`, 400);
    }
    if (setting !== null && setting !== undefined) capabilities[field] = setting;
  }

  const pricing = {};
  for (const field of PRICING_FIELDS) {
    const number = optionalNumber(value.pricing?.[field], `pricing.${field}`);
    if (number !== null) pricing[field] = number;
  }

  return {
    provider,
    pattern,
    matchType,
    name: optionalString(value.name, "name", 200),
    data: sanitizeCatalogData({
      capabilities: {
        ...capabilities,
        ...(optionalNumber(value.contextWindow, "contextWindow") !== null ? { contextWindow: Number(value.contextWindow) } : {}),
        ...(optionalNumber(value.maxOutput, "maxOutput") !== null ? { maxOutput: Number(value.maxOutput) } : {}),
      },
      pricing,
    }),
  };
}

export async function saveUserEntry(entry) {
  try {
    return await createUserModelCatalogRule(entry);
  } catch (error) {
    if (error instanceof ModelCatalogConflictError) {
      throw new CatalogBackendError(error.message, 409);
    }
    throw error;
  }
}

export async function updateUserEntry(originalIdentity, entry) {
  const provider = optionalString(originalIdentity?.provider, "originalIdentity.provider", 100);
  const pattern = optionalString(originalIdentity?.pattern, "originalIdentity.pattern", 512);
  if (!provider || !pattern) {
    throw new CatalogBackendError("Original provider and pattern are required", 400);
  }
  try {
    return await updateUserModelCatalogRule({ provider, pattern }, entry);
  } catch (error) {
    if (error instanceof ModelCatalogConflictError) {
      throw new CatalogBackendError(error.message, 409);
    }
    if (error instanceof ModelCatalogNotFoundError) {
      throw new CatalogBackendError(error.message, 404);
    }
    throw error;
  }
}

export async function deleteUserEntry(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new CatalogBackendError("Entry identity is required", 400);
  }
  const provider = optionalString(identity.provider, "provider", 100);
  const pattern = optionalString(identity.pattern, "pattern", 300);
  if (!provider || !pattern) {
    throw new CatalogBackendError("provider and pattern are required", 400);
  }
  return await deleteUserModelCatalogRule(provider, pattern);
}

export async function setPriority(priority) {
  if (!PRIORITIES.includes(priority)) {
    throw new CatalogBackendError("Invalid catalog priority", 400);
  }
  return await updateSettings({ modelCatalogPriority: priority });
}

export function validateOpenRouterResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.data)) {
    throw new CatalogBackendError("OpenRouter returned an invalid model catalog", 502);
  }
  if (payload.data.some((model) => !model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim())) {
    throw new CatalogBackendError("OpenRouter returned an incomplete model catalog", 502);
  }
  return payload.data;
}

export async function replaceOpenRouter(models, fetchedAt) {
  const rows = normalizeOpenRouterModels({ data: models }, fetchedAt);
  await replaceOpenRouterModels(rows);
  return { count: rows.length };
}

export async function clearOpenRouter() {
  return await clearOpenRouterModels();
}

export async function deleteOpenRouterEntry(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new CatalogBackendError("Entry identity is required", 400);
  }
  const pattern = optionalString(identity.pattern, "pattern", 300);
  if (!pattern) throw new CatalogBackendError("pattern is required", 400);
  return await deleteOpenRouterModel(pattern);
}

export function errorResponse(error) {
  const status = error instanceof CatalogBackendError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Model catalog operation failed";
  return { status, body: { error: message } };
}
