// Custom header export/import helpers — pure half of the provider page's
// CustomConfigCard JSON transfer. Validation mirrors the server gate in
// /api/providers/[id]/overrides so a file that parses here also passes there.
import { describe, expect, it } from "vitest";
import {
  BLOCKED_HEADERS,
  HEADER_EXPORT_FORMAT,
  MAX_HEADERS,
  buildHeaderExport,
  buildHeaderExportFilename,
  collectDisplayedHeaders,
  parseHeaderImport,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/customHeaderTransfer.js";

describe("collectDisplayedHeaders", () => {
  it("keeps named rows in order and skips blank names", () => {
    const rows = [
      { name: "X-First", value: "1" },
      { name: "  ", value: "ignored" },
      { name: "X-Second", value: "2" },
      { name: "", value: "also-ignored" },
    ];
    expect(collectDisplayedHeaders(rows)).toEqual({ "X-First": "1", "X-Second": "2" });
  });

  it("trims names, keeps empty values, last duplicate wins", () => {
    const rows = [
      { name: " X-Keep ", value: "" },
      { name: "X-Dup", value: "old" },
      { name: "X-Dup", value: "new" },
    ];
    expect(collectDisplayedHeaders(rows)).toEqual({ "X-Keep": "", "X-Dup": "new" });
  });

  it("tolerates non-array input", () => {
    expect(collectDisplayedHeaders(null)).toEqual({});
    expect(collectDisplayedHeaders(undefined)).toEqual({});
  });
});

describe("buildHeaderExport", () => {
  it("wraps headers with provider metadata", () => {
    const date = new Date(2026, 9, 3, 10, 20, 30);
    const out = buildHeaderExport("openai-compatible-chat-88e8", { "X-Test": "1" }, date);
    expect(out).toEqual({
      format: HEADER_EXPORT_FORMAT,
      provider: "openai-compatible-chat-88e8",
      exportedAt: date.toISOString(),
      headers: { "X-Test": "1" },
    });
  });

  it("copies the headers map instead of aliasing it", () => {
    const headers = { "X-Test": "1" };
    const out = buildHeaderExport("p", headers);
    out.headers["X-Test"] = "changed";
    expect(headers["X-Test"]).toBe("1");
  });
});

describe("buildHeaderExportFilename", () => {
  it("stamps provider and local time", () => {
    const date = new Date(2026, 9, 3, 8, 30, 15);
    expect(buildHeaderExportFilename("grok-cli", date)).toBe("9router-custom-headers-grok-cli-20261003-083015.json");
  });

  it("sanitizes provider ids for the filesystem", () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(buildHeaderExportFilename("openai-compatible-chat/88:e8", date)).toBe(
      "9router-custom-headers-openai-compatible-chat-88-e8-20260101-000000.json"
    );
  });
});

describe("parseHeaderImport", () => {
  it("accepts the wrapped export shape", () => {
    const text = JSON.stringify({
      format: HEADER_EXPORT_FORMAT,
      provider: "p",
      exportedAt: "2026-10-03T00:00:00.000Z",
      headers: { "X-One": "a", "X-Two": "b" },
    });
    expect(parseHeaderImport(text).headers).toEqual([
      { name: "X-One", value: "a" },
      { name: "X-Two", value: "b" },
    ]);
  });

  it("accepts a plain name/value map", () => {
    expect(parseHeaderImport('{"X-Plain": "v"}').headers).toEqual([{ name: "X-Plain", value: "v" }]);
  });

  it("rejects malformed documents", () => {
    expect(() => parseHeaderImport("")).toThrow(/empty/i);
    expect(() => parseHeaderImport("not json")).toThrow(/invalid json/i);
    expect(() => parseHeaderImport("[1,2]")).toThrow(/json object/i);
    expect(() => parseHeaderImport('"str"')).toThrow(/json object/i);
    expect(() => parseHeaderImport("{}")).toThrow(/no headers/i);
    expect(() => parseHeaderImport('{"headers": []}')).toThrow(/json object/i);
  });

  it("rejects invalid names and values", () => {
    expect(() => parseHeaderImport('{"Bad Header": "x"}')).toThrow(/invalid header name/i);
    expect(() => parseHeaderImport('{"X-CR": "a\\r\\nX-Evil: b"}')).toThrow(/invalid value/i);
    expect(() => parseHeaderImport('{"X-Num": 5}')).toThrow(/must be a string/i);
  });

  it("rejects blocked request-structure headers", () => {
    for (const name of BLOCKED_HEADERS) {
      expect(() => parseHeaderImport(JSON.stringify({ [name]: "x" }))).toThrow(/cannot be overridden/i);
    }
    // Case-insensitive, mirroring the server gate.
    expect(() => parseHeaderImport('{"Authorization": "Bearer x"}')).toThrow(/cannot be overridden/i);
  });

  it("enforces the header count limit", () => {
    const many = {};
    for (let i = 0; i <= MAX_HEADERS; i += 1) many[`X-H${i}`] = "v";
    expect(() => parseHeaderImport(JSON.stringify(many))).toThrow(/too many headers/i);
  });

  it("skips empty values and reports when nothing remains", () => {
    expect(() => parseHeaderImport('{"X-Empty": ""}')).toThrow(/no headers/i);
    expect(parseHeaderImport('{"X-Keep": "v", "X-Empty": ""}').headers).toEqual([{ name: "X-Keep", value: "v" }]);
  });

  it("round-trips an export through parse", () => {
    const headers = { "X-Round": "trip", "X-Other": "2" };
    const exported = buildHeaderExport("p", headers);
    expect(parseHeaderImport(JSON.stringify(exported)).headers).toEqual([
      { name: "X-Round", value: "trip" },
      { name: "X-Other", value: "2" },
    ]);
  });
});
