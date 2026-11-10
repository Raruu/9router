/**
 * Per-connection admission control for Antigravity.
 *
 * A retry storm (parallel clients, combo retries, token-refresh loops) can push
 * many simultaneous upstream calls onto one Google account. To Google's abuse
 * filters that looks like automated probing and can get the account banned, so
 * this module bounds and slows the calls instead of queueing them:
 *
 * - concurrency: `concurrency` in-flight upstream calls per connection ID. Over
 *   the limit the caller gets a labelled error and no upstream call is made —
 *   fail fast, never an unbounded queue.
 * - backoff: each consecutive 403/429 widens an exponential, jittered wait
 *   (baseBackoffMs → 2× → 4× … capped at maxBackoffMs). Only a real 2xx resets
 *   it; a token refresh never does.
 * - circuit breaker: `failureThreshold` consecutive 403/429 open the breaker.
 *   While open nothing reaches upstream; after `coolDownMs` exactly one
 *   half-open probe is admitted. Probe 2xx closes it, probe failure reopens it.
 * - TOS_VIOLATION: a 403 carrying a ToS violation is permanent, so it bypasses
 *   backoff and breaker entirely instead of being retried into a ban.
 *
 * State is keyed by connection ID, held in one process-wide limiter, and
 * bounded: the registry is capped and evicts the least-recently-active entry.
 * Connection delete and re-authentication call `close()` so nothing leaks.
 *
 * All bookkeeping is in-memory and per process. It is deliberately not
 * persisted: a restart should start from a clean admission state.
 */

import { ANTIGRAVITY_CONNECTION_LIMITS, HTTP_STATUS } from "../config/runtimeConfig.js";

const TOS_VIOLATION_PATTERN = /tos_violation/i;
const BREAKER_CLOSED = "closed";
const BREAKER_OPEN = "open";
const BREAKER_HALF_OPEN = "half_open";

/**
 * Labelled refusal for a connection that already has the maximum number of
 * in-flight upstream requests. The message names the limit so callers and logs
 * can identify it without string-matching on an upstream body.
 */
export class ConnectionLimitError extends Error {
  constructor({ connectionId, limit }) {
    super(`connection concurrency limit reached: connection ${connectionId} has ${limit} in-flight upstream requests (limit ${limit})`);
    this.name = "ConnectionLimitError";
    this.code = "CONNECTION_LIMIT";
    this.connectionId = connectionId;
    this.limit = limit;
  }
}

/**
 * A permanent 403 ToS violation must never be charged to the backoff/breaker.
 * @param {number} status
 * @param {string} bodyText
 * @returns {boolean}
 */
export function isTOSViolation(status, bodyText) {
  return status === HTTP_STATUS.FORBIDDEN
    && typeof bodyText === "string"
    && TOS_VIOLATION_PATTERN.test(bodyText);
}

/**
 * Base (pre-jitter) backoff after `failures` consecutive 403/429s:
 * 1 → base, 2 → 2×, 3 → 4× … capped at max. Exported so tests can compute the
 * expected delay without sleeping.
 */
export function backoffDelayMs(failures, baseMs = ANTIGRAVITY_CONNECTION_LIMITS.baseBackoffMs, maxMs = ANTIGRAVITY_CONNECTION_LIMITS.maxBackoffMs) {
  if (!(failures > 0)) return 0;
  let delay = baseMs;
  for (let i = 1; i < failures; i++) {
    if (delay >= maxMs) return maxMs;
    delay *= 2;
  }
  return Math.min(delay, maxMs);
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Sleep that rejects with AbortError when the client signal aborts. */
function sleepWithSignal(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let settled = false;
    const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function createState(now) {
  return {
    inFlight: 0,
    failures: 0,
    breaker: BREAKER_CLOSED,
    openedAt: 0,
    halfOpenAt: 0,
    backoffUntil: 0,
    lastActivity: now,
  };
}

export class ConnectionLimiter {
  constructor(options = {}) {
    const defaults = ANTIGRAVITY_CONNECTION_LIMITS;
    this.concurrency = positiveInteger(options.concurrency, defaults.concurrency);
    this.failureThreshold = positiveInteger(options.failureThreshold, defaults.failureThreshold);
    this.coolDownMs = positiveInteger(options.coolDownMs, defaults.coolDownMs);
    this.baseBackoffMs = Number.isFinite(options.baseBackoffMs) && options.baseBackoffMs >= 0
      ? options.baseBackoffMs
      : defaults.baseBackoffMs;
    this.maxBackoffMs = positiveInteger(options.maxBackoffMs, defaults.maxBackoffMs);
    this.maxConnections = positiveInteger(options.maxConnections, defaults.maxConnections);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.random = typeof options.random === "function" ? options.random : Math.random;
    this.conns = new Map();
  }

  /**
   * May a new attempt on `connectionId` proceed now, and how long should the
   * caller wait first? An open breaker refuses (allowed=false); a closed one
   * with an active backoff window allows but asks for a wait.
   */
  allow(connectionId) {
    if (!connectionId) return { allowed: true, waitMs: 0, breaker: BREAKER_CLOSED };

    const state = this._getOrCreate(connectionId);
    const now = this.now();
    state.lastActivity = now;

    if (state.breaker === BREAKER_OPEN) {
      const until = state.openedAt + this.coolDownMs;
      if (now < until) {
        return { allowed: false, waitMs: until - now, breaker: BREAKER_OPEN };
      }
      // Cool-down elapsed: the transition itself is the single half-open probe.
      // Admit it and leave none remaining so the breaker cannot stay half-open
      // admitting more than one request.
      state.breaker = BREAKER_HALF_OPEN;
      state.halfOpenAt = now;
      return { allowed: true, waitMs: 0, breaker: BREAKER_HALF_OPEN };
    }

    if (state.breaker === BREAKER_HALF_OPEN) {
      // The single probe was admitted on the OPEN→HALF_OPEN transition; the
      // state resolves on recordSuccess/recordFailure. If the probe never
      // reports back, the cool-down since its admission reopens the breaker so
      // it cannot stall in HALF_OPEN forever.
      if (state.halfOpenAt && now > state.halfOpenAt + this.coolDownMs) {
        state.breaker = BREAKER_OPEN;
        state.openedAt = now;
        state.halfOpenAt = 0;
        return { allowed: false, waitMs: this.coolDownMs, breaker: BREAKER_OPEN };
      }
      return { allowed: false, waitMs: 0, breaker: BREAKER_HALF_OPEN };
    }

    if (state.backoffUntil > now) {
      return { allowed: true, waitMs: state.backoffUntil - now, breaker: BREAKER_CLOSED };
    }
    return { allowed: true, waitMs: 0, breaker: BREAKER_CLOSED };
  }

  /**
   * Reserve one in-flight slot. Never blocks: at the limit it throws a labelled
   * ConnectionLimitError instead of queueing. The returned release must be
   * called exactly once on every path; it is idempotent.
   */
  acquire(connectionId) {
    if (!connectionId) return () => {};

    const state = this._getOrCreate(connectionId);
    if (state.inFlight >= this.concurrency) {
      throw new ConnectionLimitError({ connectionId, limit: this.concurrency });
    }

    state.inFlight += 1;
    state.lastActivity = this.now();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.inFlight = Math.max(0, state.inFlight - 1);
    };
  }

  /**
   * One-call admission used by the executor hook: breaker check, optional
   * backoff wait honouring the client signal, then a concurrency slot.
   *
   * @returns {Promise<{ release: () => void } | { blocked: {
   *   status: number, kind: string, message: string, retryAfterMs: number
   * } }>}
   */
  async admit(connectionId, { signal, wait = true } = {}) {
    if (!connectionId) return { release: () => {} };

    const decision = this.allow(connectionId);
    if (!decision.allowed) {
      const retryAfterMs = Math.max(0, decision.waitMs);
      const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return {
        blocked: {
          status: HTTP_STATUS.SERVICE_UNAVAILABLE,
          kind: "circuit_breaker_open",
          message: `antigravity circuit breaker open for connection ${connectionId} — retry in ${seconds}s`,
          retryAfterMs,
        },
      };
    }

    if (wait && decision.waitMs > 0) {
      await sleepWithSignal(decision.waitMs, signal);
    }

    try {
      return { release: this.acquire(connectionId) };
    } catch (error) {
      if (error instanceof ConnectionLimitError) {
        return {
          blocked: {
            status: HTTP_STATUS.RATE_LIMITED,
            kind: "connection_limit",
            message: error.message,
            retryAfterMs: 1000,
          },
        };
      }
      throw error;
    }
  }

  /** A real 2xx response resets failures, backoff and breaker. */
  recordSuccess(connectionId) {
    if (!connectionId) return;
    const state = this.conns.get(connectionId);
    if (!state) return;
    state.failures = 0;
    state.backoffUntil = 0;
    state.breaker = BREAKER_CLOSED;
    state.openedAt = 0;
    state.halfOpenAt = 0;
    state.lastActivity = this.now();
  }

  /**
   * Charge a 403/429 to the connection: widen the backoff and, at the
   * threshold, open the breaker. Any other status (and a TOS_VIOLATION 403)
   * is ignored.
   */
  recordFailure(connectionId, status, bodyText = "") {
    if (!connectionId) return { ignored: true, reason: "no_connection" };
    if (isTOSViolation(status, bodyText)) return { ignored: true, reason: "tos_violation" };
    if (status !== HTTP_STATUS.FORBIDDEN && status !== HTTP_STATUS.RATE_LIMITED) {
      return { ignored: true, reason: "status" };
    }

    const state = this._getOrCreate(connectionId);
    const now = this.now();
    state.failures += 1;
    state.lastActivity = now;

    // Exponential, capped, plus up to 50% jitter so concurrent connections do
    // not retry in lockstep.
    const delay = backoffDelayMs(state.failures, this.baseBackoffMs, this.maxBackoffMs);
    const jitter = Math.floor(this.random() * (delay / 2));
    state.backoffUntil = now + delay + jitter;

    let opened = false;
    if (state.failures >= this.failureThreshold) {
      opened = state.breaker !== BREAKER_OPEN;
      state.breaker = BREAKER_OPEN;
      state.openedAt = now;
      state.halfOpenAt = 0;
    }

    return {
      failures: state.failures,
      opened,
      backoffUntilMs: state.backoffUntil,
      cooldownMs: this.coolDownMs,
    };
  }

  /** Drop a connection's breaker/backoff state (delete or re-authentication). */
  close(connectionId) {
    if (!connectionId) return;
    this.conns.delete(connectionId);
  }

  /** Read-only snapshot for tests/observability; null when untracked. */
  inspect(connectionId) {
    const state = this.conns.get(connectionId);
    if (!state) return null;
    return {
      breaker: state.breaker,
      failures: state.failures,
      inFlight: state.inFlight,
      backoffUntilMs: state.backoffUntil,
      lastActivity: state.lastActivity,
    };
  }

  get size() {
    return this.conns.size;
  }

  _getOrCreate(connectionId) {
    const existing = this.conns.get(connectionId);
    if (existing) return existing;
    if (this.conns.size >= this.maxConnections) this._evictStale();
    const state = createState(this.now());
    this.conns.set(connectionId, state);
    return state;
  }

  /** Evict the least-recently-active entry so client-supplied IDs cannot grow the map. */
  _evictStale() {
    let victim = null;
    let oldest = Infinity;
    for (const [id, state] of this.conns) {
      if (state.lastActivity < oldest) {
        oldest = state.lastActivity;
        victim = id;
      }
    }
    if (victim !== null) this.conns.delete(victim);
  }
}

export const antigravityConnectionLimiter = new ConnectionLimiter();

/** Release a connection's admission state after delete or re-authentication. */
export function closeAntigravityConnection(connectionId) {
  antigravityConnectionLimiter.close(connectionId);
}
