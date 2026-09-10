// Per-provider combo member retry config.
// Stored in settings as providerRetries:
// { [providerId]: { enabled?: boolean, tries?: number, maxBackoffSeconds?: number } }.
// tries = extra same-member attempts after the first failure; only transient
// failures (rate limit, overloaded, network) are ever retried.
// A missing entry, enabled !== true, or an unusable tries value always means
// "single try, then advance" — retries are strictly opt-in.

// Upstream HTTP statuses worth a same-member retry. Anything else (auth,
// quota locks that outlast the wait cap, bad request, no credentials) advances
// to the next combo member immediately.
export const RETRYABLE_STATUS = [429, 502, 503, 504];

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
  return { enabled: true, tries, maxBackoffMs };
}
