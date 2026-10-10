// Per-provider combo member retry config.
// Stored in settings as providerRetries:
// { [providerId]: { enabled?: boolean, tries?: number, maxBackoffSeconds?: number,
//                   mode?: string, statusMode?: string, statusList?: number[]|string } }.
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
//
// statusMode narrows which failures are retryable:
//   "all"    (default) — any status in RETRYABLE_STATUS.
//   "only"              — exactly the codes in statusList (replaces the set).
//   "except"            — RETRYABLE_STATUS minus the codes in statusList.

// Upstream HTTP statuses worth a same-member retry. Anything else (auth,
// quota locks that outlast the wait cap, bad request, no credentials) advances
// to the next combo member immediately.
export const RETRYABLE_STATUS = [429, 502, 503, 504];

export const RETRY_MODE_MEMBER = "member";
export const RETRY_MODE_PER_KEY = "per-key";

export const RETRY_STATUS_ALL = "all";
export const RETRY_STATUS_ONLY = "only";
export const RETRY_STATUS_EXCEPT = "except";
export const RETRY_STATUS_LIST_MAX = 32;

// Unknown/missing modes keep the historical member behaviour.
export function resolveRetryMode(raw) {
  return raw === RETRY_MODE_PER_KEY ? RETRY_MODE_PER_KEY : RETRY_MODE_MEMBER;
}

// Unknown/missing status scopes keep the historical "all transient" behaviour.
export function resolveStatusMode(raw) {
  if (raw === RETRY_STATUS_ONLY) return RETRY_STATUS_ONLY;
  if (raw === RETRY_STATUS_EXCEPT) return RETRY_STATUS_EXCEPT;
  return RETRY_STATUS_ALL;
}

// Parse a user-entered status list (array or comma-separated string) into a
// sorted, deduped list of plausible HTTP error codes. Fail-open: any junk
// yields [] so the caller falls back to the default transient set.
export function resolveStatusList(raw) {
  try {
    const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,]+/);
    const codes = new Set();
    for (const part of parts) {
      if (part === "" || part == null) continue;
      const n = Number(part);
      if (!Number.isInteger(n) || n < 400 || n > 599) continue;
      codes.add(n);
    }
    return [...codes].sort((a, b) => a - b).slice(0, RETRY_STATUS_LIST_MAX);
  } catch {
    return [];
  }
}

// Effective set of retryable statuses for a resolved config.
function resolveStatuses(statusMode, rawList) {
  if (statusMode === RETRY_STATUS_ONLY) {
    const only = resolveStatusList(rawList);
    return only.length > 0 ? only : [...RETRYABLE_STATUS];
  }
  if (statusMode === RETRY_STATUS_EXCEPT) {
    const except = new Set(resolveStatusList(rawList));
    return RETRYABLE_STATUS.filter((s) => !except.has(s));
  }
  return [...RETRYABLE_STATUS];
}

// Whether a failed key should be retried in place (per-key mode) instead of
// rotating to the next key. Long locks (exact provider resets) skip, matching
// the member-level cap. `statuses` (optional) narrows the retryable set; when
// absent the default transient statuses apply.
export function shouldRetrySameKey({ mode, status, attemptsUsed, tries, cooldownMs, maxBackoffMs, statuses }) {
  if (mode !== RETRY_MODE_PER_KEY) return false;
  const allowed = Array.isArray(statuses) ? statuses.includes(status) : isRetryableStatus(status);
  if (!allowed) return false;
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
  const statusMode = resolveStatusMode(raw.statusMode);
  return {
    enabled: true,
    tries,
    maxBackoffMs,
    mode: resolveRetryMode(raw.mode),
    statusMode,
    statuses: resolveStatuses(statusMode, raw.statusList),
  };
}
