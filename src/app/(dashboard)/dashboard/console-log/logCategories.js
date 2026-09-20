// Pure client-side classifiers for dashboard/console-log tabs.
// Console logs arrive as unstructured strings, so filtering is regex/text
// based. Predicates are intentionally independent: one line may match
// multiple tabs.
const REQUEST_RE = /📥|📤|💥|▶|📊|✗|FMT:|🌊 \[STREAM\]|BLOCKED|ABORTED|⚙/;
// `❌` is the shared subsystem-error glyph (log.error in sse/utils/logger.js),
// not a request marker — token-refresh and auth failures use it too. Only the
// provider account-lock line is request-scoped, so match that shape explicitly.
const REQUEST_LOCK_RE = /❌ .+ \[\d{3}\]:/;
const TOKEN_REFRESH_RE = /TOKEN_REFRESH|BG_TOKEN_REFRESH|\bTOKEN\b|🔑 TOKEN REFRESHED|refresh.*token|token.*refresh|successfully refreshed|refreshing provider credentials/i;
const ERROR_RE = /❌|✗|⚠️|ERROR|Error|failed|FAIL|WARN|BLOCKED|ABORTED|aborted/;

export const LOG_CATEGORIES = [
  { id: "all", label: "All", match: () => true },
  { id: "requests", label: "Requests", match: (line) => REQUEST_RE.test(line) || REQUEST_LOCK_RE.test(line) },
  { id: "refresh", label: "Token refresh", match: (line) => TOKEN_REFRESH_RE.test(line) },
  { id: "errors", label: "Errors", match: (line) => ERROR_RE.test(line) },
];

function pad2(value) {
  return String(value).padStart(2, "0");
}

// Local-time timestamp for download filenames: YYYYMMDD-HHMMSS.
export function formatConsoleLogTimestamp(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function normalizeConsoleLogTabName(tab) {
  return String(tab || "all").trim().toLowerCase().replace(/\s+/g, "-") || "all";
}

export function buildConsoleLogFilename(tab, date = new Date()) {
  return `console-log-${normalizeConsoleLogTabName(tab)}-${formatConsoleLogTimestamp(date)}.txt`;
}

export function buildConsoleLogText(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}
