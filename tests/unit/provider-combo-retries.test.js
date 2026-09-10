import { describe, expect, it } from "vitest";
import {
  isRetryableStatus,
  resolveProviderRetries,
  MAX_MEMBER_RETRIES,
  MAX_RETRY_WAIT_MS,
  DEFAULT_MEMBER_RETRIES,
} from "../../open-sse/config/retries.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("resolveProviderRetries", () => {
  it("returns tries for an enabled config", () => {
    expect(resolveProviderRetries({ enabled: true, tries: 3 })).toEqual({ enabled: true, tries: 3 });
  });

  it("defaults tries when enabled without a usable count", () => {
    expect(resolveProviderRetries({ enabled: true })).toEqual({ enabled: true, tries: DEFAULT_MEMBER_RETRIES });
    expect(resolveProviderRetries({ enabled: true, tries: "many" })).toEqual({ enabled: true, tries: DEFAULT_MEMBER_RETRIES });
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
});

describe("isRetryableStatus", () => {
  it("accepts transient statuses only", () => {
    for (const s of [429, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 402, 403, 404, 500, null, undefined]) {
      expect(isRetryableStatus(s)).toBe(false);
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
