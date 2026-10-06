// Console log retention bounds — shared by the server buffer, the settings API
// and the dashboard control so all three clamp identically.
//
// The limit is a runtime setting (settings.consoleLogMaxLines): persisted via
// /api/settings, applied to the live buffer without a restart, and re-applied
// on boot / DB import. Values outside [min, max] are clamped; anything that is
// not a whole number is rejected (null) so callers can keep their current value.
export const CONSOLE_LOG_LIMITS = {
  default: 200,
  min: 10,
  max: 10000,
};

/**
 * Normalize a console-log max-lines value.
 * Accepts a number or numeric string; returns a clamped integer, or null when
 * the input is not a whole number (callers treat null as "no change").
 * @param {number|string} value
 * @returns {number|null}
 */
export function normalizeConsoleLogMaxLines(value) {
  // Only primitives: Number([]) === 0 and Number(null) === 0 would otherwise
  // pass as valid "zero" values.
  if (typeof value !== "number" && typeof value !== "string") return null;
  // Number("") === 0 — an empty field must be rejected, not silently clamped.
  if (typeof value === "string" && value.trim() === "") return null;
  const num = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return Math.min(CONSOLE_LOG_LIMITS.max, Math.max(CONSOLE_LOG_LIMITS.min, num));
}
