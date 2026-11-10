// Per-connection admission control for Antigravity (ported from 9router-go#1008).
// Locks the limiter's state machine: concurrency bound, jittered backoff,
// circuit breaker with one half-open probe, TOS bypass and bounded state.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionLimiter,
  ConnectionLimitError,
  backoffDelayMs,
  isTOSViolation,
} from "../../open-sse/services/antigravityConnectionLimit.js";

function setup(overrides = {}) {
  const clock = { now: 1_000_000 };
  const limiter = new ConnectionLimiter({
    concurrency: 2,
    failureThreshold: 3,
    coolDownMs: 1000,
    baseBackoffMs: 100,
    maxBackoffMs: 800,
    maxConnections: 10,
    now: () => clock.now,
    random: () => 0.5,
    ...overrides,
  });
  return { limiter, clock };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectionLimiter — concurrency", () => {
  it("bounds in-flight calls and refuses the extra one with a labelled error", () => {
    const { limiter } = setup();
    const release1 = limiter.acquire("conn-1");
    const release2 = limiter.acquire("conn-1");

    let error = null;
    try {
      limiter.acquire("conn-1");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConnectionLimitError);
    expect(error.code).toBe("CONNECTION_LIMIT");
    expect(error.limit).toBe(2);
    expect(error.message).toContain("in-flight upstream requests (limit 2)");
    expect(limiter.inspect("conn-1").inFlight).toBe(2);

    // Release is idempotent: a double call must not free a slot twice.
    release1();
    release1();
    expect(limiter.inspect("conn-1").inFlight).toBe(1);

    release2();
    expect(limiter.inspect("conn-1").inFlight).toBe(0);
  });

  it("keeps limits per connection, not global", () => {
    const { limiter } = setup({ concurrency: 1 });
    limiter.acquire("conn-1");
    expect(() => limiter.acquire("conn-1")).toThrow(ConnectionLimitError);
    expect(() => limiter.acquire("conn-2")).not.toThrow();
  });
});

describe("ConnectionLimiter — backoff", () => {
  it("computes the exponential delay and caps it", () => {
    expect(backoffDelayMs(0, 2000, 60000)).toBe(0);
    expect(backoffDelayMs(1, 2000, 60000)).toBe(2000);
    expect(backoffDelayMs(2, 2000, 60000)).toBe(4000);
    expect(backoffDelayMs(3, 2000, 60000)).toBe(8000);
    expect(backoffDelayMs(20, 2000, 60000)).toBe(60000);
  });

  it("widens the wait after each 403 and resets only on success", () => {
    const { limiter } = setup();

    limiter.recordFailure("conn-1", 403, '{"error":{"code":403}}');
    // delay 100 + jitter floor(0.5 * 50) = 125ms
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: true, waitMs: 125 });

    limiter.recordFailure("conn-1", 403, '{"error":{"code":403}}');
    // delay 200 + jitter 50 = 250ms
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: true, waitMs: 250 });

    limiter.recordSuccess("conn-1");
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: true, waitMs: 0 });
    expect(limiter.inspect("conn-1")).toMatchObject({ failures: 0, breaker: "closed" });
  });

  it("charges only 403 and 429 — other statuses leave no state behind", () => {
    const { limiter } = setup();
    for (const status of [400, 409, 500, 502, 503]) {
      expect(limiter.recordFailure("conn-1", status, "")).toMatchObject({ ignored: true });
    }
    expect(limiter.inspect("conn-1")).toBeNull();
  });
});

describe("ConnectionLimiter — TOS violation bypass", () => {
  it("recognizes only a 403 carrying a tos_violation body", () => {
    expect(isTOSViolation(403, '{"error":{"code":"TOS_VIOLATION"}}')).toBe(true);
    expect(isTOSViolation(403, '{"error":{"message":"tos_violation detected"}}')).toBe(true);
    expect(isTOSViolation(403, '{"error":{"code":"other"}}')).toBe(false);
    expect(isTOSViolation(429, '{"error":{"code":"TOS_VIOLATION"}}')).toBe(false);
  });

  it("never charges backoff or opens the breaker", () => {
    const { limiter } = setup();
    const body = '{"error":{"code":"TOS_VIOLATION"}}';
    for (let i = 0; i < 5; i++) {
      expect(limiter.recordFailure("conn-1", 403, body)).toMatchObject({ ignored: true, reason: "tos_violation" });
    }
    expect(limiter.inspect("conn-1")).toBeNull();
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: true, waitMs: 0 });
  });
});

describe("ConnectionLimiter — circuit breaker", () => {
  it("opens after the failure threshold and refuses without upstream calls", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure("conn-1", 403, "{}");

    expect(limiter.inspect("conn-1")).toMatchObject({ breaker: "open", failures: 3 });
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: false, waitMs: 1000, breaker: "open" });
  });

  it("admits exactly one half-open probe after the cool-down", () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure("conn-1", 403, "{}");

    clock.now += 1000;
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: true, waitMs: 0, breaker: "half_open" });
    // The single probe was consumed by the transition itself.
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: false, breaker: "half_open" });

    limiter.recordSuccess("conn-1");
    expect(limiter.inspect("conn-1")).toMatchObject({ breaker: "closed", failures: 0 });
    expect(limiter.allow("conn-1")).toMatchObject({ allowed: true, waitMs: 0 });
  });

  it("reopens when the half-open probe fails", () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure("conn-1", 403, "{}");
    clock.now += 1000;
    expect(limiter.allow("conn-1").allowed).toBe(true);

    limiter.recordFailure("conn-1", 403, "{}");
    expect(limiter.inspect("conn-1")).toMatchObject({ breaker: "open", failures: 4 });
    expect(limiter.allow("conn-1").allowed).toBe(false);
  });

  it("reopens a stuck half-open probe after one cool-down", () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure("conn-1", 403, "{}");

    clock.now += 1000;
    expect(limiter.allow("conn-1").allowed).toBe(true); // probe admitted, never reports
    clock.now += 1001;

    expect(limiter.allow("conn-1")).toMatchObject({ allowed: false, waitMs: 1000, breaker: "open" });
  });
});

describe("ConnectionLimiter — admission helper", () => {
  it("returns a labelled 429 when the concurrency bound is full", async () => {
    const { limiter } = setup({ concurrency: 1 });
    limiter.acquire("conn-1");

    const admission = await limiter.admit("conn-1");
    expect(admission.release).toBeUndefined();
    expect(admission.blocked).toMatchObject({ status: 429, kind: "connection_limit", retryAfterMs: 1000 });
    expect(admission.blocked.message).toContain("limit 1");
  });

  it("returns a labelled 503 when the breaker is open", async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure("conn-1", 403, "{}");

    const admission = await limiter.admit("conn-1");
    expect(admission.blocked).toMatchObject({
      status: 503,
      kind: "circuit_breaker_open",
      retryAfterMs: 1000,
    });
  });

  it("waits out the backoff before taking a slot", async () => {
    vi.useFakeTimers();
    const { limiter } = setup();
    limiter.recordFailure("conn-1", 403, "{}");

    const pending = limiter.admit("conn-1");
    await vi.advanceTimersByTimeAsync(125);

    const admission = await pending;
    expect(typeof admission.release).toBe("function");
    expect(limiter.inspect("conn-1").inFlight).toBe(1);
    admission.release();
  });

  it("rejects with AbortError when the request aborts during a backoff wait", async () => {
    vi.useFakeTimers();
    const { limiter } = setup();
    limiter.recordFailure("conn-1", 403, "{}");

    const controller = new AbortController();
    const pending = limiter.admit("conn-1", { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();

    await assertion;
    expect(limiter.inspect("conn-1").inFlight).toBe(0);
  });
});

describe("ConnectionLimiter — lifecycle and bounds", () => {
  it("drops a connection's state on close", () => {
    const { limiter } = setup();
    limiter.recordFailure("conn-1", 403, "{}");
    expect(limiter.size).toBe(1);

    limiter.close("conn-1");
    expect(limiter.size).toBe(0);
    expect(limiter.inspect("conn-1")).toBeNull();
  });

  it("evicts the least-recently-active entry at capacity", () => {
    const { limiter, clock } = setup({ maxConnections: 2, concurrency: 5 });

    limiter.acquire("old")();
    clock.now += 10;
    limiter.acquire("middle")();
    clock.now += 10;
    limiter.acquire("new")();

    expect(limiter.size).toBe(2);
    expect(limiter.inspect("old")).toBeNull();
    expect(limiter.inspect("middle")).not.toBeNull();
    expect(limiter.inspect("new")).not.toBeNull();
  });

  it("ignores missing connection IDs", async () => {
    const { limiter } = setup();
    expect(limiter.allow("")).toMatchObject({ allowed: true, waitMs: 0 });
    expect(() => limiter.acquire("")()).not.toThrow();
    await expect(limiter.admit("", { signal: new AbortController().signal })).resolves.toHaveProperty("release");
    expect(limiter.size).toBe(0);
  });
});
