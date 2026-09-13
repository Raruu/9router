import { describe, expect, it } from "vitest";
import {
  buildConsoleLogFilename,
  buildConsoleLogText,
  formatConsoleLogTimestamp,
  normalizeConsoleLogTabName,
} from "../../src/app/(dashboard)/dashboard/console-log/logCategories.js";

describe("console log download helpers", () => {
  it("formats local timestamps for filenames", () => {
    const date = new Date(2026, 8, 14, 8, 30, 15);
    expect(formatConsoleLogTimestamp(date)).toBe("20260914-083015");
  });

  it("normalizes tab names for filenames", () => {
    expect(normalizeConsoleLogTabName("all")).toBe("all");
    expect(normalizeConsoleLogTabName("Token refresh")).toBe("token-refresh");
    expect(normalizeConsoleLogTabName("")).toBe("all");
  });

  it("builds tab-scoped download filenames", () => {
    const date = new Date(2026, 8, 14, 8, 30, 15);
    expect(buildConsoleLogFilename("refresh", date)).toBe("console-log-refresh-20260914-083015.txt");
  });

  it("builds downloadable text from visible lines", () => {
    expect(buildConsoleLogText(["a", "b"])).toBe("a\nb\n");
    expect(buildConsoleLogText([])).toBe("");
  });
});
