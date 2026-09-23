// Shared purge definitions. The live purge (repos) and the size estimate
// (maintenance.estimatePurgeSize, which replays the same mutations on an
// attached copy) both build from these, so the two can never drift apart.

export const PURGE_TARGETS = ["overview", "details", "details-content"];

// The four payload fields a request detail can carry. Everything else in the
// stored record is metadata (tokens/latency/status/pxpipe) and survives a
// content purge.
export const CONTENT_SECTIONS = ["request", "providerRequest", "providerResponse", "response"];

// De-duplicated, validated section list; [] when nothing valid was requested.
export function normalizeSections(input) {
  const requested = Array.isArray(input) ? input : [];
  return [...new Set(requested)].filter((s) => CONTENT_SECTIONS.includes(s));
}

// DELETE statements for the delete-only targets, against `prefix` ("" for the
// live schema, "est." for the estimate copy). Returns null for details-content,
// which rewrites per-row JSON instead of deleting rows.
export function purgeDeleteStatements(target, prefix = "") {
  if (target === "overview") {
    return [
      `DELETE FROM ${prefix}usageHistory`,
      `DELETE FROM ${prefix}usageDaily`,
      `DELETE FROM ${prefix}_meta WHERE key = 'totalRequestsLifetime'`,
    ];
  }
  if (target === "details") {
    return [`DELETE FROM ${prefix}requestDetails`];
  }
  return null;
}

// Rewrite `keys` in a stored detail record to { redacted: true }. Returns true
// when the record changed; already-redacted sections are left alone so a repeat
// purge reports 0 rows.
export function redactRecord(record, keys) {
  if (!record || typeof record !== "object") return false;
  let changed = false;
  for (const key of keys) {
    if (record[key] !== undefined && record[key]?.redacted !== true) {
      record[key] = { redacted: true };
      changed = true;
    }
  }
  return changed;
}
