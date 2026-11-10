// Antigravity executor admission wiring (ported from 9router-go#1008).
// Verifies the transport-level guarantees: concurrency bound, breaker with no
// upstream calls while open, one half-open probe, TOS bypass and success reset.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { ConnectionLimiter } = await import("../../open-sse/services/antigravityConnectionLimit.js");

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function args(connectionId = "conn-1") {
  return {
    model: "claude-sonnet-4-6",
    body: { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
    stream: false,
    credentials: { accessToken: "tok", projectId: "project-1", connectionId },
    log,
  };
}

function jsonResponse(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fastLimiter(overrides = {}) {
  return new ConnectionLimiter({
    concurrency: 2,
    failureThreshold: 3,
    coolDownMs: 1000,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    now: Date.now,
    random: () => 0.5,
    ...overrides,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  log.debug.mockReset();
  log.warn.mockReset();
});

describe("AntigravityExecutor — concurrency admission", () => {
  it("caps concurrent upstream calls per connection and refuses the extra one", async () => {
    const limiter = fastLimiter({ concurrency: 2 });
    const executor = new AntigravityExecutor(limiter);
    const releases = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      releases.push(() => resolve(jsonResponse(200, { ok: true })));
    }));

    const first = executor.execute(args());
    const second = executor.execute(args());
    const third = executor.execute(args());

    // Admission is synchronous up to the slot acquisition, so the third call
    // must already be refused before any mocked fetch settles.
    const blocked = await third;
    expect(blocked.response.status).toBe(429);
    expect(blocked.admission).toBe("connection_limit");
    expect(blocked.response.headers.get("retry-after")).toBe("1");
    expect(await blocked.response.json()).toMatchObject({
      error: { type: "connection_limit", code: 429 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    releases.forEach((release) => release());
    const [one, two] = await Promise.all([first, second]);
    expect(one.response.status).toBe(200);
    expect(two.response.status).toBe(200);
    expect(limiter.inspect("conn-1").inFlight).toBe(0);
  });

  it("keeps the bound per connection ID", async () => {
    const limiter = fastLimiter({ concurrency: 1 });
    const executor = new AntigravityExecutor(limiter);
    const releases = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      releases.push(() => resolve(jsonResponse(200, { ok: true })));
    }));

    const first = executor.execute(args("conn-a"));
    const second = executor.execute(args("conn-b"));
    const third = executor.execute(args("conn-a"));

    const blocked = await third;
    expect(blocked.admission).toBe("connection_limit");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    releases.forEach((release) => release());
    await Promise.all([first, second]);
  });

  it("skips admission when the execution has no connection ID", async () => {
    const executor = new AntigravityExecutor(fastLimiter({ concurrency: 1 }));
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const request = args();
    delete request.credentials.connectionId;

    const results = await Promise.all([1, 2, 3].map(() => executor.execute(request)));
    expect(results.every((result) => result.response.status === 200)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("AntigravityExecutor — backoff and circuit breaker", () => {
  it("opens after three consecutive 403s and then makes zero upstream calls", async () => {
    const limiter = fastLimiter();
    const executor = new AntigravityExecutor(limiter);
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { code: 403, message: "denied" } }));

    for (let i = 0; i < 3; i++) {
      const result = await executor.execute(args());
      expect(result.response.status).toBe(403);
    }

    expect(limiter.inspect("conn-1")).toMatchObject({ breaker: "open", failures: 3 });
    expect(log.warn).toHaveBeenCalledWith("AG_LIMIT", expect.stringContaining("breaker OPEN"));

    fetchMock.mockClear();
    const blocked = await executor.execute(args());
    expect(blocked.response.status).toBe(503);
    expect(blocked.admission).toBe("circuit_breaker_open");
    expect(blocked.response.headers.get("retry-after")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets one half-open probe through after the cool-down and closes on success", async () => {
    let now = 1_000_000;
    const limiter = fastLimiter({ coolDownMs: 500, now: () => now });
    const executor = new AntigravityExecutor(limiter);
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { code: 403 } }));

    for (let i = 0; i < 3; i++) await executor.execute(args());
    expect(limiter.inspect("conn-1").breaker).toBe("open");

    now += 500;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const probe = await executor.execute(args());
    expect(probe.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(limiter.inspect("conn-1").breaker).toBe("closed");

    // Closed again: the next request reaches upstream normally.
    fetchMock.mockClear();
    await executor.execute(args());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not charge a 403 TOS_VIOLATION to the breaker", async () => {
    const limiter = fastLimiter();
    const executor = new AntigravityExecutor(limiter);
    fetchMock.mockResolvedValue(jsonResponse(403, {
      error: { code: "TOS_VIOLATION", message: "terms of service" },
    }));

    for (let i = 0; i < 4; i++) {
      const result = await executor.execute(args());
      expect(result.response.status).toBe(403);
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(limiter.inspect("conn-1")).toMatchObject({ breaker: "closed", failures: 0 });
  });

  it("resets failures/breaker on a successful response", async () => {
    const limiter = fastLimiter();
    const executor = new AntigravityExecutor(limiter);
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      return calls === 3
        ? jsonResponse(200, { ok: true })
        : jsonResponse(403, { error: { code: 403 } });
    });

    await executor.execute(args());
    await executor.execute(args());
    expect(limiter.inspect("conn-1").failures).toBe(2);

    const success = await executor.execute(args());
    expect(success.response.status).toBe(200);
    expect(limiter.inspect("conn-1")).toMatchObject({ failures: 0, breaker: "closed" });

    // Two more failures must not open a breaker that was reset by the success.
    await executor.execute(args());
    await executor.execute(args());
    expect(limiter.inspect("conn-1")).toMatchObject({ failures: 2, breaker: "closed" });
  });
});
