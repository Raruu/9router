// Per-provider combo member retry config.
// Stored in settings as providerRetries:
// { [providerId]: { enabled?: boolean, tries?: number, maxBackoffSeconds?: number, mode?: string } }.
// tries = extra same-member attempts after the first failure; only transient
// failures (rate limit, overloaded, network) are ever retried.
// A missing entry, enabled !== true, or an unusable tries value always means
// "single try, then advance" — retries are strictly opt-in.
//
// mode picks where the retries land:
//   "member"  (default) — the whole member is re-run: its account loop walks
//                          every key first, then the combo waits and retries.
//   "per-key"           — each key gets its own `tries` extra attempts before
//                          rotating to the next key; once every key is
//                          exhausted the combo advances (no member retry).

// Upstream HTTP statuses worth a same-member retry. Anything else (auth,
// quota locks that outlast the wait cap, bad request, no credentials) advances
// to the next combo member immediately.
export const RETRYABLE_STATUS = [429, 502, 503, 504];

export const RETRY_MODE_MEMBER = "member";
export const RETRY_MODE_PER_KEY = "per-key";

// Unknown/missing modes keep the historical member behaviour.
export function resolveRetryMode(raw) {
  return raw === RETRY_MODE_PER_KEY ? RETRY_MODE_PER_KEY : RETRY_MODE_MEMBER;
}

// Whether a failed key should be retried in place (per-key mode) instead of
// rotating to the next key. Long locks (exact provider resets) skip, matching
// the member-level cap.
export function shouldRetrySameKey({ mode, status, attemptsUsed, tries, cooldownMs, maxBackoffMs }) {
  if (mode !== RETRY_MODE_PER_KEY) return false;
  if (!isRetryableStatus(status)) return false;
  if (!Number.isFinite(tries) || attemptsUsed >= tries) return false;
  if (!Number.isFinite(cooldownMs)) return false;
  return cooldownMs <= maxBackoffMs;
}

// Upper bound on the tries input so a misconfigured provider can't stall a
// combo request for minutes before falling through.
export const MAX_MEMBER_RETRIES = 10;
export const DEFAULT_MEMBER_RETRIES = 2;

// A single retry never sleeps longer than this. When the underlying lock
// outlasts the cap (e.g. quota exhausted for an hour), the member is skipped
// instead of burning tries on sleeps.
export const MAX_RETRY_WAIT_MS = 30000;
export const DEFAULT_RETRY_BACKOFF_MS = 16000;
export const MIN_RETRY_BACKOFF_MS = 1000;

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS.includes(status);
}

export function resolveProviderRetries(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.enabled !== true) return null;
  let tries = DEFAULT_MEMBER_RETRIES;
  if (typeof raw.tries === "number" && Number.isFinite(raw.tries)) {
    tries = Math.min(MAX_MEMBER_RETRIES, Math.max(1, Math.floor(raw.tries)));
  }
  let maxBackoffMs = DEFAULT_RETRY_BACKOFF_MS;
  if (typeof raw.maxBackoffSeconds === "number" && Number.isFinite(raw.maxBackoffSeconds)) {
    maxBackoffMs = Math.min(
      MAX_RETRY_WAIT_MS,
      Math.max(MIN_RETRY_BACKOFF_MS, Math.floor(raw.maxBackoffSeconds) * 1000),
    );
  }
  return { enabled: true, tries, maxBackoffMs, mode: resolveRetryMode(raw.mode) };
}
