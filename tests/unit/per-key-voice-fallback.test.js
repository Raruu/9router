// TTS per-key whitelists must match the voice-suffixed model string.
//
// A TTS request addresses a voice as a trailing segment
// ("openai/tts-1/alloy"), while a key's allowedModels names the model
// ("openai/tts-1"). Validating the raw string 403'd correctly-configured keys,
// which is why validateApiKeyWithVoiceFallback exists.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let validateApiKeyWithVoiceFallback;
let validateApiKeyWithRules;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-voice-fallback-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ validateApiKeyWithVoiceFallback, validateApiKeyWithRules } = await import("@/sse/services/auth.js"));
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function makeKey(allowedModels) {
  const key = await db.createApiKey(`k-${Math.random().toString(36).slice(2, 8)}`, "machine-1", {
    limitType: "none",
    allowedModels,
  });
  return key.key;
}

describe("validateApiKeyWithVoiceFallback", () => {
  it("accepts a voice-suffixed request when the whitelist names the model", async () => {
    const apiKey = await makeKey(["openai/tts-1"]);
    const result = await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1/alloy");
    expect(result.valid).toBe(true);
  });

  it("accepts a voice-suffixed request with a multi-segment voice id", async () => {
    const apiKey = await makeKey(["openai/tts-1"]);
    const result = await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1/en-US-anna");
    expect(result.valid).toBe(true);
  });

  it("accepts a bare model string (no voice) as before", async () => {
    const apiKey = await makeKey(["openai/tts-1"]);
    expect((await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1")).valid).toBe(true);
  });

  it("still rejects a model that is not whitelisted", async () => {
    const apiKey = await makeKey(["openai/tts-1"]);
    const result = await validateApiKeyWithVoiceFallback(apiKey, "openai/gpt-4o-mini-tts/alloy");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(403);
    // The error names the originally requested value.
    expect(result.error).toContain("openai/gpt-4o-mini-tts/alloy");
  });

  it("does not weaken other rules — an unknown key stays 401", async () => {
    const result = await validateApiKeyWithVoiceFallback("sk-nope", "openai/tts-1/alloy");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
  });

  it("does not resurrect a paused key", async () => {
    const apiKey = await makeKey(["openai/tts-1"]);
    const { getApiKeys } = await import("@/lib/localDb");
    const [record] = (await getApiKeys()).filter((k) => k.key === apiKey);
    await db.updateApiKey(record.id, { isActive: false });
    const result = await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1/alloy");
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
  });

  it("leaves keys without a whitelist untouched", async () => {
    const apiKey = await makeKey(null);
    expect((await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1/alloy")).valid).toBe(true);
  });

  it("supports provider wildcards with a voice suffix", async () => {
    const apiKey = await makeKey(["openai/*"]);
    expect((await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1/alloy")).valid).toBe(true);
  });

  it("passes through results that are already valid (no double lookup needed)", async () => {
    const apiKey = await makeKey(["openai/tts-1/alloy"]);
    // An explicit voice entry in the whitelist also works, via the direct path.
    expect((await validateApiKeyWithRules(apiKey, "openai/tts-1/alloy")).valid).toBe(true);
    expect((await validateApiKeyWithVoiceFallback(apiKey, "openai/tts-1/alloy")).valid).toBe(true);
  });
});
