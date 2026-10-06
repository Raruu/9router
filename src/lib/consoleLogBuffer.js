import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";
import { normalizeConsoleLogMaxLines } from "@/shared/utils/consoleLogLimits.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

if (!state.pendingLines) state.pendingLines = [];
if (!state.flushTimer) state.flushTimer = null;
// Live retention limit — seeded from the constant, replaced by the persisted
// setting via applyConsoleLogMaxLines() (boot, settings PATCH, DB import).
if (!state.maxLines) state.maxLines = CONSOLE_LOG_CONFIG.maxLines;

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_LINES = 50;

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  state.emitter.emit("lines", lines);
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function toLogLine(level, args) {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

function appendLine(line) {
  state.logs.push(line);
  const maxLines = state.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  state.pendingLines.push(line);
  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

/**
 * Set the live retention limit. Normalizes (clamps to bounds); a non-integer
 * value is ignored so callers can forward raw user input safely. Shrinking
 * trims the existing buffer immediately.
 * @param {number|string} value
 * @returns {number} the applied limit
 */
export function setConsoleLogMaxLines(value) {
  const normalized = normalizeConsoleLogMaxLines(value);
  if (normalized === null) return state.maxLines;
  state.maxLines = normalized;
  if (state.logs.length > normalized) {
    state.logs = state.logs.slice(-normalized);
  }
  return normalized;
}

/**
 * Read the persisted limit and apply it. Used on boot and after settings
 * changes that bypass the PATCH hook (DB import). Fail-open: keeps the
 * current limit when settings are unavailable.
 */
export async function applyConsoleLogMaxLines() {
  try {
    const { getRawSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const raw = await getRawSettings();
    if (raw && Object.prototype.hasOwnProperty.call(raw, "consoleLogMaxLines")) {
      return setConsoleLogMaxLines(raw.consoleLogMaxLines);
    }
  } catch {
    // Settings not available yet (early boot) — keep the current limit.
  }
  return state.maxLines;
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(toLogLine(level, args));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.logs;
}

export function clearConsoleLogs() {
  state.logs = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
