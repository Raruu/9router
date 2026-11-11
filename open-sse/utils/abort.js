/**
 * Client-cancellation helpers.
 *
 * A request handler must stop doing work as soon as the client is gone: the
 * abort signal fires on disconnect, but retry loops, backoff sleeps and
 * failover chains otherwise keep calling upstream providers for a response
 * nobody will read.
 *
 * Every helper here is a no-op when no signal is supplied, so engine callers
 * that never had a signal (standalone use, tests, no-auth virtual connections)
 * keep their current behaviour.
 */

import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { errorResponse } from "./error.js";

/** True when the caller already cancelled the request. */
export function isAborted(signal) {
  return !!(signal && signal.aborted);
}

/**
 * An AbortError-shaped error for the given signal. Reuses the signal's own
 * reason when it is an Error (so callers see the real cause) and otherwise
 * builds a minimal one, matching what fetch throws on abort.
 */
export function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Sleep for `ms`, resolving `false` as soon as the signal aborts.
 *
 * The listener is one-shot and removed on every settle path so a long-lived
 * request signal never accumulates listeners. The post-registration re-check
 * covers an abort that lands between the initial check and addEventListener
 * (an already-aborted signal does not fire a late listener).
 *
 * @returns {Promise<boolean>} true when the full delay elapsed, false on abort
 */
export function sleepUnlessAborted(ms, signal) {
  if (!(ms > 0)) return Promise.resolve(!isAborted(signal));
  if (isAborted(signal)) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (isAborted(signal)) finish(false);
  });
}

/**
 * The response a cancelled request unwinds with. The client is gone, so this
 * is an internal terminal marker: it stops the combo/account loops and is
 * reported by the request log as 499 (Client Closed Request).
 */
export function abortedResponse() {
  return errorResponse(HTTP_STATUS.CLIENT_CLOSED_REQUEST, "Request aborted");
}
