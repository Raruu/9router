// Per-key model access and usage limits (based on #4073 by @miqonee):
// `allowedModels` restricts which models a key may call and which entries
// /v1/models lists, while `limitType` selects which counter is enforced —
// tokens, requests, or `either` (whichever trips first). Limits are tracked on
// completed requests and can be reset from the dashboard without a new key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const keyStore = vi.hoisted(() => ({ record: null }));

vi.mock("@/lib/db/repos/apiKeysRepo.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getApiKeyByKey: async () => keyStore.record,
}));

const { isModelAllowedForKey, validateApiKeyWithRules, filterModelsForKey } = await import("@/sse/services/auth.js");
const { checkApiKeyLimit, normalizeLimitType } = await import("@/shared/constants/apiKeyLimits.js");

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-per-key-"));
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

const requestWithKey = (key) => ({
  headers: { get: (name) => (name.toLowerCase() === "authorization" ? `Bearer ${key}` : null) },
});

describe("isModelAllowedForKey", () => {
  it("allows any model when allowedModels is null or empty", () => {
    expect(isModelAllowedForKey("gpt-4o", null)).toBe(true);
    expect(isModelAllowedForKey("gpt-4o", [])).toBe(true);
    expect(isModelAllowedForKey("oc/muse-spark-1.2-contributor-free", undefined)).toBe(true);
  });

  it("rejects when requestedModel is empty", () => {
    expect(isModelAllowedForKey("", ["gpt-4o"])).toBe(false);
    expect(isModelAllowedForKey(null, ["gpt-4o"])).toBe(false);
  });

  it("matches exact model name and provider-prefixed model name", () => {
    const allowed = ["gpt-4o", "oc/muse-spark-1.2-contributor-free"];
    expect(isModelAllowedForKey("gpt-4o", allowed)).toBe(true);
    expect(isModelAllowedForKey("openai/gpt-4o", allowed)).toBe(true);
    expect(isModelAllowedForKey("oc/muse-spark-1.2-contributor-free", allowed)).toBe(true);
    expect(isModelAllowedForKey("muse-spark-1.2-contributor-free", allowed)).toBe(true);
    expect(isModelAllowedForKey("claude-3-5-sonnet", allowed)).toBe(false);
  });

  it("matches wildcard provider prefix (e.g. oc/*, openai/*)", () => {
    const allowed = ["oc/*", "deepseek/*"];
    expect(isModelAllowedForKey("oc/muse-spark-1.2-contributor-free", allowed)).toBe(true);
    expect(isModelAllowedForKey("oc/any-other-model", allowed)).toBe(true);
    expect(isModelAllowedForKey("deepseek/deepseek-chat", allowed)).toBe(true);
    expect(isModelAllowedForKey("openai/gpt-4o", allowed)).toBe(false);
  });

  it("matches wildcard pattern (e.g. *claude*, *flash*)", () => {
    const allowed = ["*claude*", "*flash*"];
    expect(isModelAllowedForKey("anthropic/claude-3-5-sonnet", allowed)).toBe(true);
    expect(isModelAllowedForKey("claude-3-opus", allowed)).toBe(true);
    expect(isModelAllowedForKey("gemini-1.5-flash", allowed)).toBe(true);
    expect(isModelAllowedForKey("gpt-4o", allowed)).toBe(false);
  });

  it("matches universal wildcard *", () => {
    expect(isModelAllowedForKey("any-model-123", ["*"])).toBe(true);
  });
});

describe("checkApiKeyLimit", () => {
  const usage = {
    tokenLimit: 100,
    usedTokens: 100,
    requestLimit: 5,
    usedRequests: 1,
  };

  it("enforces only the counters selected by limitType", () => {
    expect(checkApiKeyLimit({ ...usage, limitType: "none" })).toBeNull();
    expect(checkApiKeyLimit({ ...usage, limitType: "tokens" })).toContain("Token limit exceeded");
    expect(checkApiKeyLimit({ ...usage, limitType: "requests" })).toBeNull();
    expect(checkApiKeyLimit({ ...usage, limitType: "either" })).toContain("Token limit exceeded");
  });

  it("trips on whichever limit is reached first under either", () => {
    const requestsFirst = checkApiKeyLimit({
      limitType: "either",
      tokenLimit: 1000,
      usedTokens: 10,
      requestLimit: 2,
      usedRequests: 2,
    });
    expect(requestsFirst).toContain("Request limit exceeded");
  });

  it("treats a zero limit as unlimited", () => {
    expect(checkApiKeyLimit({ limitType: "tokens", tokenLimit: 0, usedTokens: 999999 })).toBeNull();
    expect(checkApiKeyLimit({ limitType: "requests", requestLimit: 0, usedRequests: 999999 })).toBeNull();
  });

  it("normalizes unknown limit types to none", () => {
    expect(normalizeLimitType("bogus")).toBe("none");
    expect(normalizeLimitType(undefined)).toBe("none");
    expect(checkApiKeyLimit({ ...usage, limitType: "bogus" })).toBeNull();
  });
});

describe("validateApiKeyWithRules", () => {
  beforeEach(() => {
    keyStore.record = null;
  });

  it("returns error when API key is missing", async () => {
    const result = await validateApiKeyWithRules(null, "gpt-4o");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("Missing API key");
  });

  it("returns error when API key is not found in database", async () => {
    keyStore.record = null;
    const result = await validateApiKeyWithRules("invalid-key", "gpt-4o");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("Invalid API key");
  });

  it("returns error when API key is paused (isActive: false)", async () => {
    keyStore.record = {
      id: "key-1",
      key: "test-key",
      name: "Test",
      isActive: false,
      limitType: "none",
      allowedModels: null,
    };
    const result = await validateApiKeyWithRules("test-key", "gpt-4o");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("paused");
  });

  it("returns 429 when the token limit is exceeded", async () => {
    keyStore.record = {
      id: "key-1",
      key: "test-key",
      name: "Quota Key",
      isActive: true,
      limitType: "tokens",
      tokenLimit: 50000,
      usedTokens: 50001,
      allowedModels: null,
    };
    const result = await validateApiKeyWithRules("test-key", "gpt-4o");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("Token limit exceeded");
  });

  it("returns 429 when the request limit is exceeded", async () => {
    keyStore.record = {
      id: "key-1",
      key: "test-key",
      name: "Request Key",
      isActive: true,
      limitType: "requests",
      requestLimit: 10,
      usedRequests: 10,
      allowedModels: null,
    };
    const result = await validateApiKeyWithRules("test-key", "gpt-4o");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("Request limit exceeded");
  });

  it("ignores counters that the limit type does not watch", async () => {
    keyStore.record = {
      id: "key-1",
      key: "test-key",
      name: "Unlimited Key",
      isActive: true,
      limitType: "none",
      tokenLimit: 10,
      usedTokens: 999999,
      requestLimit: 1,
      usedRequests: 999999,
      allowedModels: null,
    };
    const result = await validateApiKeyWithRules("test-key", "gpt-4o");
    expect(result.valid).toBe(true);
  });

  it("returns 403 when the requested model is not in allowedModels", async () => {
    keyStore.record = {
      id: "key-1",
      key: "test-key",
      name: "Restricted Key",
      isActive: true,
      limitType: "tokens",
      tokenLimit: 100000,
      usedTokens: 500,
      allowedModels: ["oc/*", "gpt-4o-mini"],
    };
    const result = await validateApiKeyWithRules("test-key", "claude-3-5-sonnet");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("Model 'claude-3-5-sonnet' is not allowed");
  });

  it("succeeds when key is active, within its limits, and the model is allowed", async () => {
    keyStore.record = {
      id: "key-1",
      key: "test-key",
      name: "Good Key",
      isActive: true,
      limitType: "either",
      tokenLimit: 100000,
      usedTokens: 500,
      requestLimit: 50,
      usedRequests: 3,
      allowedModels: ["oc/*", "gpt-4o"],
    };
    const result = await validateApiKeyWithRules("test-key", "gpt-4o");
    expect(result.valid).toBe(true);
    expect(result.keyRecord.name).toBe("Good Key");
  });
});

describe("filterModelsForKey", () => {
  const catalog = [
    { id: "oc/muse-spark-1.2-contributor-free" },
    { id: "openai/gpt-4o" },
    { id: "code-xhigh" },
  ];

  it("keeps the exposure-driven catalog for unrestricted keys and anonymous callers", async () => {
    keyStore.record = { isActive: true, limitType: "none", allowedModels: null };
    expect(await filterModelsForKey(requestWithKey("k"), catalog)).toEqual(catalog);

    keyStore.record = null;
    expect(await filterModelsForKey({ headers: { get: () => null } }, catalog)).toEqual(catalog);
  });

  it("narrows the catalog to the key's allowed patterns", async () => {
    keyStore.record = { isActive: true, limitType: "none", allowedModels: ["oc/*", "gpt-4o"] };
    const filtered = await filterModelsForKey(requestWithKey("k"), catalog);
    expect(filtered.map((m) => m.id)).toEqual(["oc/muse-spark-1.2-contributor-free", "openai/gpt-4o"]);
  });
});

describe("per-key counters (DB round trip)", () => {
  it("increments tokens and requests per completed request and resets on demand", async () => {
    const key = await db.createApiKey("Metered", "machine-1", {
      limitType: "either",
      tokenLimit: 1000,
      requestLimit: 5,
      allowedModels: ["gpt-4o"],
    });
    expect(key.limitType).toBe("either");
    expect(key.tokenLimit).toBe(1000);
    expect(key.requestLimit).toBe(5);
    expect(key.allowedModels).toEqual(["gpt-4o"]);

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: key.key,
      tokens: { prompt_tokens: 100, completion_tokens: 20 },
      status: "ok",
      endpoint: "/v1/chat/completions",
    });

    let stored = await db.getApiKeyById(key.id);
    expect(stored.usedTokens).toBe(120);
    expect(stored.usedRequests).toBe(1);

    await db.updateApiKey(key.id, { resetUsage: true });
    stored = await db.getApiKeyById(key.id);
    expect(stored.usedTokens).toBe(0);
    expect(stored.usedRequests).toBe(0);

    // A key created without a limit type stays unlimited and keeps its counters.
    const plain = await db.createApiKey("Plain", "machine-1", { tokenLimit: 42 });
    expect(plain.limitType).toBe("none");
    expect(plain.tokenLimit).toBe(0);
    expect(plain.requestLimit).toBe(0);
  });

  it("rotates the key value without touching identity, limits or counters", async () => {
    const key = await db.createApiKey("Rotating", "machine-2", {
      limitType: "requests",
      requestLimit: 10,
      allowedModels: ["oc/*"],
    });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      status: "ok",
      endpoint: "/v1/chat/completions",
    });

    const rotated = await db.updateApiKey(key.id, { rotateKey: true });
    expect(rotated.key).not.toBe(key.key);
    expect(rotated.key).toMatch(/^sk-machine-2-/);
    expect(rotated.id).toBe(key.id);
    expect(rotated.name).toBe("Rotating");
    expect(rotated.limitType).toBe("requests");
    expect(rotated.requestLimit).toBe(10);
    expect(rotated.allowedModels).toEqual(["oc/*"]);
    expect(rotated.createdAt).toBe(key.createdAt);
    expect(rotated.usedTokens).toBe(15);
    expect(rotated.usedRequests).toBe(1);

    // The old value stops validating immediately; the new one works.
    expect(await db.validateApiKey(key.key)).toBe(false);
    expect(await db.validateApiKey(rotated.key)).toBe(true);

    // Reset + rotate in one call zeroes the counters and reissues again.
    const both = await db.updateApiKey(key.id, { resetUsage: true, rotateKey: true });
    expect(both.key).not.toBe(rotated.key);
    expect(both.usedTokens).toBe(0);
    expect(both.usedRequests).toBe(0);
    expect(both.requestLimit).toBe(10);
  });

  it("does not track counters for unlimited keys, and freezes them once switched to unlimited", async () => {
    const unlimited = await db.createApiKey("Untracked", "machine-3", {});
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: unlimited.key,
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      status: "ok",
      endpoint: "/v1/chat/completions",
    });
    let stored = await db.getApiKeyById(unlimited.id);
    expect(stored.usedTokens).toBe(0);
    expect(stored.usedRequests).toBe(0);

    const metered = await db.createApiKey("Metered", "machine-3", { limitType: "tokens", tokenLimit: 1000 });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: metered.key,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      status: "ok",
      endpoint: "/v1/chat/completions",
    });
    stored = await db.getApiKeyById(metered.id);
    expect(stored.usedTokens).toBe(30);
    expect(stored.usedRequests).toBe(1);

    await db.updateApiKey(metered.id, { limitType: "none" });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: metered.key,
      tokens: { prompt_tokens: 400, completion_tokens: 100 },
      status: "ok",
      endpoint: "/v1/chat/completions",
    });
    stored = await db.getApiKeyById(metered.id);
    expect(stored.usedTokens).toBe(30);
    expect(stored.usedRequests).toBe(1);
  });
});
