import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRetryableStatus,
  resolveProviderRetries,
  MAX_MEMBER_RETRIES,
  MAX_RETRY_WAIT_MS,
  DEFAULT_MEMBER_RETRIES,
  DEFAULT_RETRY_BACKOFF_MS,
  MIN_RETRY_BACKOFF_MS,
} from "../../open-sse/config/retries.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const authMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderConnections: authMocks.getProviderConnections,
  updateProviderConnection: authMocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

describe("resolveProviderRetries", () => {
  it("returns tries for an enabled config", () => {
    expect(resolveProviderRetries({ enabled: true, tries: 3 })).toEqual({
      enabled: true,
      tries: 3,
      maxBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
    });
  });

  it("defaults tries when enabled without a usable count", () => {
    expect(resolveProviderRetries({ enabled: true })).toMatchObject({ tries: DEFAULT_MEMBER_RETRIES });
    expect(resolveProviderRetries({ enabled: true, tries: "many" })).toMatchObject({ tries: DEFAULT_MEMBER_RETRIES });
  });

  it("clamps tries into 1..MAX_MEMBER_RETRIES", () => {
    expect(resolveProviderRetries({ enabled: true, tries: 99 }).tries).toBe(MAX_MEMBER_RETRIES);
    expect(resolveProviderRetries({ enabled: true, tries: 0 }).tries).toBe(1);
    expect(resolveProviderRetries({ enabled: true, tries: -4 }).tries).toBe(1);
    expect(resolveProviderRetries({ enabled: true, tries: 2.7 }).tries).toBe(2);
  });

  it("returns null for missing, disabled, or malformed input", () => {
    expect(resolveProviderRetries(null)).toBeNull();
    expect(resolveProviderRetries(undefined)).toBeNull();
    expect(resolveProviderRetries([])).toBeNull();
    expect(resolveProviderRetries({})).toBeNull();
    expect(resolveProviderRetries({ enabled: false, tries: 3 })).toBeNull();
    expect(resolveProviderRetries({ enabled: "yes", tries: 3 })).toBeNull();
  });

  it("defaults and clamps the configurable retry backoff", () => {
    expect(resolveProviderRetries({ enabled: true }).maxBackoffMs).toBe(DEFAULT_RETRY_BACKOFF_MS);
    expect(resolveProviderRetries({ enabled: true, maxBackoffSeconds: 7.8 }).maxBackoffMs).toBe(7000);
    expect(resolveProviderRetries({ enabled: true, maxBackoffSeconds: 0 }).maxBackoffMs).toBe(MIN_RETRY_BACKOFF_MS);
    expect(resolveProviderRetries({ enabled: true, maxBackoffSeconds: 999 }).maxBackoffMs).toBe(MAX_RETRY_WAIT_MS);
    expect(resolveProviderRetries({ enabled: true, maxBackoffSeconds: "invalid" }).maxBackoffMs).toBe(DEFAULT_RETRY_BACKOFF_MS);
  });
});

describe("isRetryableStatus", () => {
  it("accepts transient statuses only", () => {
    for (const s of [429, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 402, 403, 404, 500, null, undefined]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });
});

describe("combo retry account lock backoff", () => {
  it("caps local exponential backoff but preserves exact provider resets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
    try {
      authMocks.getProviderConnections.mockResolvedValue([{
        id: "custom-a",
        provider: "custom",
        name: "custom-a",
        backoffLevel: 8,
      }]);
      authMocks.updateProviderConnection.mockClear();

      const local = await markAccountUnavailable(
        "custom-a", 429, "rate limit", "custom", "model-a", null,
        { maxBackoffMs: DEFAULT_RETRY_BACKOFF_MS },
      );
      expect(local.cooldownMs).toBe(DEFAULT_RETRY_BACKOFF_MS);
      expect(authMocks.updateProviderConnection).toHaveBeenLastCalledWith(
        "custom-a",
        expect.objectContaining({
          "modelLock_model-a": "2026-09-11T00:00:16.000Z",
          backoffLevel: 9,
        }),
      );

      const exactReset = Date.now() + 120_000;
      const exact = await markAccountUnavailable(
        "custom-a", 429, "rate limit", "custom", "model-a", exactReset,
        { maxBackoffMs: DEFAULT_RETRY_BACKOFF_MS },
      );
      expect(exact.cooldownMs).toBe(120_000);
      expect(authMocks.updateProviderConnection).toHaveBeenLastCalledWith(
        "custom-a",
        expect.objectContaining({ "modelLock_model-a": "2026-09-11T00:02:00.000Z" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

const silentLog = { info: () => {}, warn: () => {} };

function failResponse({ status = 503, signal = null, message = "boom" } = {}) {
  const res = new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (signal) res.retrySignal = signal;
  return res;
}

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const transientSignal = (over = {}) => ({
  providerId: "p1",
  status: 429,
  retryAfterMs: 0,
  ...over,
});

describe("handleComboChat same-member retries", () => {
  it("advances after one try when no resolver is given", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        return m === "p2/b" ? okResponse() : failResponse({ signal: transientSignal() });
      },
      log: silentLog,
      comboName: "retry-none",
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p2/b"]);
  });

  it("retries the same member then succeeds", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        if (m === "p1/a" && calls.filter((c) => c === "p1/a").length < 3) {
          return failResponse({ signal: transientSignal() });
        }
        return okResponse();
      },
      log: silentLog,
      comboName: "retry-success",
      resolveMemberRetries: () => ({ enabled: true, tries: 2 }),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p1/a", "p1/a"]);
  });

  it("advances after tries are exhausted", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        return m === "p2/b" ? okResponse() : failResponse({ signal: transientSignal() });
      },
      log: silentLog,
      comboName: "retry-exhaust",
      resolveMemberRetries: () => ({ enabled: true, tries: 2 }),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p1/a", "p1/a", "p2/b"]);
  });

  it("uses all 10 retries when each lock is capped at 16 seconds", async () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const resultPromise = handleComboChat({
        body: {},
        models: ["p1/a", "p2/b"],
        handleSingleModel: async (body, member) => {
          calls.push(member);
          return member === "p2/b"
            ? okResponse()
            : failResponse({ signal: transientSignal({ retryAfterMs: DEFAULT_RETRY_BACKOFF_MS }) });
        },
        log: silentLog,
        comboName: "retry-ten",
        resolveMemberRetries: () => resolveProviderRetries({
          enabled: true,
          tries: 10,
          maxBackoffSeconds: 16,
        }),
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(calls.filter((member) => member === "p1/a")).toHaveLength(11);
      expect(calls.at(-1)).toBe("p2/b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances immediately on a non-transient underlying status", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        // Outer status is 503 (all accounts locked) but the cause is auth.
        return m === "p2/b"
          ? okResponse()
          : failResponse({ status: 503, signal: transientSignal({ status: 401 }) });
      },
      log: silentLog,
      comboName: "retry-fatal",
      resolveMemberRetries: () => ({ enabled: true, tries: 3 }),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p2/b"]);
  });

  it("advances immediately when the wait exceeds the cap", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        return m === "p2/b"
          ? okResponse()
          : failResponse({ signal: transientSignal({ retryAfterMs: MAX_RETRY_WAIT_MS + 1 }) });
      },
      log: silentLog,
      comboName: "retry-long-wait",
      resolveMemberRetries: () => ({ enabled: true, tries: 3 }),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p2/b"]);
  });

  it("re-reads the signal every attempt", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        if (m === "p2/b") return okResponse();
        // First failure transient, second failure auth-locked.
        return calls.length === 1
          ? failResponse({ signal: transientSignal() })
          : failResponse({ status: 503, signal: transientSignal({ status: 403 }) });
      },
      log: silentLog,
      comboName: "retry-reread",
      resolveMemberRetries: () => ({ enabled: true, tries: 3 }),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p1/a", "p2/b"]);
  });

  it("advances when the resolver throws or returns nothing", async () => {
    for (const resolver of [() => { throw new Error("db down"); }, () => null, () => ({ enabled: false, tries: 5 })]) {
      const calls = [];
      const res = await handleComboChat({
        body: {},
        models: ["p1/a", "p2/b"],
        handleSingleModel: async (b, m) => {
          calls.push(m);
          return m === "p2/b" ? okResponse() : failResponse({ signal: transientSignal() });
        },
        log: silentLog,
        comboName: "retry-resolver-fail",
        resolveMemberRetries: resolver,
      });
      expect(res.ok).toBe(true);
      expect(calls).toEqual(["p1/a", "p2/b"]);
    }
  });

  it("never retries thrown exceptions", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        if (m === "p1/a") throw new Error("unexpected");
        return okResponse();
      },
      log: silentLog,
      comboName: "retry-throw",
      resolveMemberRetries: () => ({ enabled: true, tries: 3 }),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p1/a", "p2/b"]);
  });
});

describe("provider combo retries after restart", () => {
  const providerId = "openai-compatible-chat-restart-test";
  const model = "glm-5.3-flash";
  let tempDir;
  let originalDataDir;

  beforeEach(() => {
    originalDataDir = process.env.DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-retries-restart-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("resets persisted backoff on boot so an enabled custom provider retries again", async () => {
    const db = await import("../../src/lib/db/index.js");
    const connection = await db.createProviderConnection({
      provider: providerId,
      authType: "apikey",
      name: "Restart test",
      apiKey: "test-key",
    });
    const activeLock = new Date(Date.now() + 60_000).toISOString();
    const expiredLock = new Date(Date.now() - 60_000).toISOString();
    await db.updateProviderConnection(connection.id, {
      backoffLevel: 6,
      [`modelLock_${model}`]: activeLock,
      modelLock_expired: expiredLock,
      lastError: "rate limited",
    });
    await db.updateSettings({
      providerRetries: { [providerId]: { enabled: true, tries: 2, maxBackoffSeconds: 12 } },
    });

    // Real restart: close the adapter, discard every loaded DB module, then
    // reopen the same SQLite file and run the awaited startup cleanup.
    global._dbAdapter.instance.close();
    delete global._dbAdapter;
    vi.resetModules();

    const { resetProviderRetryBackoffOnStartup, getProviderConnectionById } = await import(
      "../../src/lib/db/repos/connectionsRepo.js"
    );
    await resetProviderRetryBackoffOnStartup();

    const restarted = await getProviderConnectionById(connection.id);
    expect(restarted.backoffLevel).toBe(0);
    expect(restarted[`modelLock_${model}`]).toBe(activeLock);
    expect(restarted.modelLock_expired).toBeUndefined();
    expect(restarted.lastError).toBe("rate limited");

    const { getSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const resolveMemberRetries = (id) => resolveProviderRetries(settings.providerRetries?.[id]);
    expect(resolveMemberRetries(providerId)).toEqual({
      enabled: true,
      tries: 2,
      maxBackoffMs: 12_000,
    });

    // Once the pre-restart lock expires, the next 429 starts at level 1 (2s),
    // not the persisted level 7 (64s). Combo retries cap later local backoff at
    // the configured default while preserving genuine long reset timestamps.
    const next429 = checkFallbackError(429, "openai_error", restarted.backoffLevel);
    expect(next429.cooldownMs).toBeLessThanOrEqual(resolveMemberRetries(providerId).maxBackoffMs);

    vi.useFakeTimers();
    const calls = [];
    const resultPromise = handleComboChat({
      body: {},
      models: [`seek-ai/${model}`, "p2/fallback"],
      handleSingleModel: async (body, member) => {
        calls.push(member);
        if (member === "p2/fallback" || calls.length > 1) return okResponse();
        return failResponse({
          signal: transientSignal({
            providerId,
            retryAfterMs: next429.cooldownMs,
          }),
        });
      },
      log: silentLog,
      comboName: "restart-retry",
      resolveMemberRetries,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(calls).toEqual([`seek-ai/${model}`, `seek-ai/${model}`]);
  });
});
