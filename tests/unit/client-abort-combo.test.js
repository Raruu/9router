// Client cancellation must stop combo/fusion retries immediately.
//
// Regression: a cancelled request kept trying every remaining combo member,
// slept through the same-member retry backoff and the transient cooldown, and
// kept a 45s empty-stream peek alive — all for a response nobody would read.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleComboChat, handleFusionChat } from "../../open-sse/services/combo.js";
import { peekStreamForContent } from "../../open-sse/services/emptyFailover.js";
import { sleepUnlessAborted } from "../../open-sse/utils/abort.js";

const silentLog = { info: () => {}, warn: () => {}, debug: () => {} };

function jsonResponse(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function failResponse({ status = 503, retrySignal = null } = {}) {
  const res = jsonResponse(status, { error: { message: "boom" } });
  if (retrySignal) res.retrySignal = retrySignal;
  return res;
}

function okResponse(content = "ok") {
  return jsonResponse(200, { choices: [{ message: { role: "assistant", content } }] });
}

/** A streaming response that stays open forever (no frames, no close). */
function silentSseResponse() {
  const stream = new ReadableStream({ pull() { /* never enqueues */ } });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const memberRetries = (overrides = {}) => () => ({
  enabled: true,
  tries: 3,
  maxBackoffMs: 10_000,
  statuses: [429, 502, 503],
  mode: "member",
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sleepUnlessAborted", () => {
  it("resolves true once the delay elapses", async () => {
    await expect(sleepUnlessAborted(5)).resolves.toBe(true);
  });

  it("resolves false as soon as the signal aborts", async () => {
    const ac = new AbortController();
    const pending = sleepUnlessAborted(5000, ac.signal);
    ac.abort();
    await expect(pending).resolves.toBe(false);
  });

  it("resolves false immediately for an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleepUnlessAborted(5000, ac.signal)).resolves.toBe(false);
    await expect(sleepUnlessAborted(0, ac.signal)).resolves.toBe(false);
  });
});

describe("handleComboChat — client abort", () => {
  it("does not start any member when the request is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const handleSingleModel = vi.fn();

    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel,
      log: silentLog,
      comboName: "aborted-combo",
      signal: ac.signal,
    });

    expect(handleSingleModel).not.toHaveBeenCalled();
    expect(res.status).toBe(499);
    await expect(res.json()).resolves.toMatchObject({ error: { message: "Request aborted" } });
  });

  it("stops the same-member retry backoff when the client aborts mid-wait", async () => {
    const ac = new AbortController();
    let calls = 0;

    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async () => {
        calls += 1;
        setTimeout(() => ac.abort(), 10);
        return failResponse({
          status: 429,
          retrySignal: { providerId: "p1", status: 429, retryAfterMs: 5000 },
        });
      },
      log: silentLog,
      comboName: "abort-during-backoff",
      resolveMemberRetries: memberRetries(),
      signal: ac.signal,
    });

    expect(calls).toBe(1);
    expect(res.status).toBe(499);
  });

  it("does not advance to the next member when the client aborts during an attempt", async () => {
    const ac = new AbortController();
    const calls = [];

    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b", "p3/c"],
      handleSingleModel: async (body, modelStr) => {
        calls.push(modelStr);
        ac.abort();
        return failResponse({ status: 503 });
      },
      log: silentLog,
      comboName: "abort-during-attempt",
      resolveMemberRetries: memberRetries(),
      signal: ac.signal,
    });

    expect(calls).toEqual(["p1/a"]);
    expect(res.status).toBe(499);
  });

  it("treats a 499 member result as terminal instead of request-scoped", async () => {
    const calls = [];

    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (body, modelStr) => {
        calls.push(modelStr);
        return jsonResponse(499, { error: { message: "Request aborted" } });
      },
      log: silentLog,
      comboName: "member-aborted",
    });

    // 499 classifies as request-scoped for checkFallbackError; without the
    // explicit guard the combo would try p2/b before returning.
    expect(calls).toEqual(["p1/a"]);
    expect(res.status).toBe(499);
  });

  it("aborts the empty-stream peek instead of waiting for its deadline", async () => {
    const ac = new AbortController();
    const calls = [];

    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (body, modelStr) => {
        calls.push(modelStr);
        setTimeout(() => ac.abort(), 5);
        return silentSseResponse();
      },
      log: silentLog,
      comboName: "abort-during-peek",
      signal: ac.signal,
    });

    expect(calls).toEqual(["p1/a"]);
    expect(res.status).toBe(499);
  });

  it("keeps normal failover behaviour when no signal is passed", async () => {
    const calls = [];

    const res = await handleComboChat({
      body: {},
      models: ["p1/a", "p2/b"],
      handleSingleModel: async (body, modelStr) => {
        calls.push(modelStr);
        return modelStr === "p2/b" ? okResponse() : failResponse({ status: 503 });
      },
      log: silentLog,
      comboName: "no-signal",
    });

    expect(calls).toEqual(["p1/a", "p2/b"]);
    expect(res.status).toBe(200);
  });
});

describe("peekStreamForContent — client abort", () => {
  it("resolves with outcome aborted and hands the reader back", async () => {
    const ac = new AbortController();
    const stream = new ReadableStream({ pull() { /* never enqueues */ } });

    const pending = peekStreamForContent(stream, { signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    const peeked = await pending;

    expect(peeked.outcome).toBe("aborted");
    await expect(peeked.reader.cancel()).resolves.toBeUndefined();
  });

  it("keeps the deadline behaviour when no signal is supplied", async () => {
    const stream = new ReadableStream({ pull() { /* never enqueues */ } });
    const peeked = await peekStreamForContent(stream, { deadlineMs: 20 });
    expect(peeked.outcome).toBe("content");
    expect(peeked.timedOut).toBe(true);
    await peeked.reader.cancel();
  });
});

describe("handleFusionChat — client abort", () => {
  it("does not fan out when the request is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const handleSingleModel = vi.fn();

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log: silentLog,
      comboName: "fusion-aborted",
      signal: ac.signal,
    });

    expect(handleSingleModel).not.toHaveBeenCalled();
    expect(res.status).toBe(499);
  });

  it("skips the judge when the client aborts during the panel", async () => {
    const ac = new AbortController();
    const calls = [];

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      judgeModel: "p/judge",
      handleSingleModel: async (body, modelStr) => {
        calls.push(modelStr);
        if (calls.length === 1) ac.abort();
        return okResponse(`ans-${modelStr}`);
      },
      log: silentLog,
      comboName: "fusion-abort-panel",
      signal: ac.signal,
    });

    expect(calls).not.toContain("p/judge");
    expect(res.status).toBe(499);
  });
});
