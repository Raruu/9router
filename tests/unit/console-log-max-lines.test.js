// Console log max-lines normalization — shared bounds for the settings API,
// the server buffer and the dashboard control.
import { describe, expect, it } from "vitest";
import {
  CONSOLE_LOG_LIMITS,
  normalizeConsoleLogMaxLines,
} from "../../src/shared/utils/consoleLogLimits.js";

describe("console log max lines", () => {
  it("keeps in-range whole numbers unchanged", () => {
    expect(normalizeConsoleLogMaxLines(200)).toBe(200);
    expect(normalizeConsoleLogMaxLines(10)).toBe(10);
    expect(normalizeConsoleLogMaxLines(10000)).toBe(10000);
    expect(normalizeConsoleLogMaxLines("500")).toBe(500);
    expect(normalizeConsoleLogMaxLines(" 750 ")).toBe(750);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(normalizeConsoleLogMaxLines(0)).toBe(CONSOLE_LOG_LIMITS.min);
    expect(normalizeConsoleLogMaxLines(1)).toBe(CONSOLE_LOG_LIMITS.min);
    expect(normalizeConsoleLogMaxLines(9)).toBe(CONSOLE_LOG_LIMITS.min);
    expect(normalizeConsoleLogMaxLines(10001)).toBe(CONSOLE_LOG_LIMITS.max);
    expect(normalizeConsoleLogMaxLines(999999)).toBe(CONSOLE_LOG_LIMITS.max);
  });

  it("rejects empty, fractional and non-numeric input", () => {
    expect(normalizeConsoleLogMaxLines("")).toBeNull();
    expect(normalizeConsoleLogMaxLines("   ")).toBeNull();
    expect(normalizeConsoleLogMaxLines(null)).toBeNull();
    expect(normalizeConsoleLogMaxLines(undefined)).toBeNull();
    expect(normalizeConsoleLogMaxLines("abc")).toBeNull();
    expect(normalizeConsoleLogMaxLines(NaN)).toBeNull();
    expect(normalizeConsoleLogMaxLines(Infinity)).toBeNull();
    expect(normalizeConsoleLogMaxLines(12.5)).toBeNull();
    expect(normalizeConsoleLogMaxLines("12.5")).toBeNull();
    expect(normalizeConsoleLogMaxLines({})).toBeNull();
    expect(normalizeConsoleLogMaxLines([])).toBeNull();
  });

  it("exposes the default within bounds", () => {
    expect(CONSOLE_LOG_LIMITS.default).toBeGreaterThanOrEqual(CONSOLE_LOG_LIMITS.min);
    expect(CONSOLE_LOG_LIMITS.default).toBeLessThanOrEqual(CONSOLE_LOG_LIMITS.max);
  });
});
