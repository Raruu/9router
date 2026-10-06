// Pure helpers for exporting/importing a provider's custom-header editor rows
// as JSON. The dashboard's CustomConfigCard owns the UI; keeping the parsing
// and validation here makes the trust-sensitive half testable and mirrors the
// server-side rules in /api/providers/[id]/overrides.
//
// Export format:
//   { "provider": "<id>", "exportedAt": "<ISO>", "headers": { "X-Name": "value" } }
// Import accepts that object or a plain { "X-Name": "value" } map.

// Mirror of the server gate — keep in sync with
// src/app/api/providers/[id]/overrides/route.js.
export const MAX_HEADERS = 20;
export const MAX_HEADER_VALUE_LENGTH = 8192;
export const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
export const BLOCKED_HEADERS = [
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "authorization",
  "cookie",
];

export const HEADER_EXPORT_FORMAT = "9router-custom-headers";

/**
 * Collect the displayed editor rows into an ordered { name: value } map.
 * Rows with a blank name are skipped; the last duplicate wins.
 * @param {Array<{name: string, value: string}>} rows
 * @returns {Object<string, string>}
 */
export function collectDisplayedHeaders(rows) {
  const headers = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name ?? "").trim();
    if (!name) continue;
    headers[name] = String(row?.value ?? "");
  }
  return headers;
}

/**
 * Build the export payload for one provider.
 * @param {string} providerId
 * @param {Object<string, string>} headers
 * @param {Date} [date]
 */
export function buildHeaderExport(providerId, headers, date = new Date()) {
  return {
    format: HEADER_EXPORT_FORMAT,
    provider: String(providerId || ""),
    exportedAt: date.toISOString(),
    headers: { ...(headers || {}) },
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * Download filename: 9router-custom-headers-<provider>-<YYYYMMDD-HHMMSS>.json
 * Provider ids are sanitized so custom-node uuids stay filename-safe.
 */
export function buildHeaderExportFilename(providerId, date = new Date()) {
  const safeProvider = String(providerId || "provider").replace(/[^a-zA-Z0-9-]/g, "-");
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `9router-custom-headers-${safeProvider}-${stamp}.json`;
}

/**
 * Parse an imported JSON document into validated header entries.
 * Accepts { headers: {...} } or a plain map. Values must be strings.
 * @param {string} text
 * @returns {{ headers: Array<{name: string, value: string}> }}
 * @throws {Error} with a user-facing message on malformed or invalid input
 */
export function parseHeaderImport(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("File is empty");

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid JSON");
  }

  let map = parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    // Wrapped export object → its headers field. A bare map has no such field.
    if (parsed.headers !== undefined) map = parsed.headers;
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("Expected a JSON object of header name/value pairs");
  }

  const entries = Object.entries(map).filter(([, value]) => value !== "" && value != null);
  if (entries.length === 0) throw new Error("No headers found in file");
  if (entries.length > MAX_HEADERS) throw new Error(`Too many headers (max ${MAX_HEADERS})`);

  const headers = [];
  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name)) throw new Error(`Invalid header name: ${name}`);
    if (typeof value !== "string") throw new Error(`Value for ${name} must be a string`);
    if (/[\r\n]/.test(value)) throw new Error(`Invalid value for header ${name}`);
    if (value.length > MAX_HEADER_VALUE_LENGTH) {
      throw new Error(`Header ${name} value too long (max ${MAX_HEADER_VALUE_LENGTH})`);
    }
    if (BLOCKED_HEADERS.includes(name.toLowerCase())) {
      throw new Error(`Header ${name} cannot be overridden`);
    }
    headers.push({ name, value });
  }

  return { headers };
}
