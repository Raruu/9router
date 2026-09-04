// Pure helpers behind /dashboard/combos list ordering + search.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  SORT_OPTIONS,
  DEFAULT_SORT,
  SORT_STORAGE_KEY,
  readStoredSort,
  writeStoredSort,
  sortCombos,
  matchComboSearch,
} from "@/app/(dashboard)/dashboard/combos/utils.js";

const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const daysAgo = (n, hourOffset = 0) => new Date(T0 - n * 86400000 + hourOffset * 3600000).toISOString();

function combo(name, createdAt, updatedAt) {
  return { id: name, name, kind: "llm", models: [], createdAt, updatedAt: updatedAt || createdAt };
}

// Oldest-first is what the API returns (ORDER BY createdAt ASC) — the default
// sort must reproduce it, not reorder behind the user's back.
const API_ORDER = [
  combo("alpha", daysAgo(30)),
  combo("beta", daysAgo(20)),
  combo("gamma", daysAgo(10)),
];

afterEach(() => {
  delete globalThis.window;
  vi.restoreAllMocks();
});

describe("sortCombos", () => {
  it("default reproduces the API's oldest-created-first order without mutating input", () => {
    const input = [...API_ORDER];
    expect(sortCombos(input).map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(input.map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(input).not.toBe(sortCombos(input));
  });

  it("created-desc is newest first", () => {
    expect(sortCombos(API_ORDER, "created-desc").map((c) => c.name)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("name-asc / name-desc order alphabetically either way", () => {
    const unsorted = [combo("zulu", daysAgo(1)), combo("Mike", daysAgo(2)), combo("alpha", daysAgo(3))];
    expect(sortCombos(unsorted, "name-asc").map((c) => c.name)).toEqual(["alpha", "Mike", "zulu"]);
    expect(sortCombos(unsorted, "name-desc").map((c) => c.name)).toEqual(["zulu", "Mike", "alpha"]);
  });

  it("updated-desc ranks by updatedAt even when createdAt order differs", () => {
    const combos = [
      combo("old-touched", daysAgo(30), daysAgo(1)),
      combo("never-touched", daysAgo(2)),
      combo("freshly-touched", daysAgo(30), daysAgo(1, -1)),
    ];
    expect(sortCombos(combos, "updated-desc").map((c) => c.name)).toEqual([
      "old-touched",
      "freshly-touched",
      "never-touched",
    ]);
  });

  it("ties on the sort field fall back to name, keeping refetch order stable", () => {
    const tied = [combo("charlie", daysAgo(5)), combo("alpha", daysAgo(5)), combo("bravo", daysAgo(5))];
    expect(sortCombos(tied, "created-desc").map((c) => c.name)).toEqual(["alpha", "bravo", "charlie"]);
    expect(sortCombos(tied, "created-asc").map((c) => c.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("unknown mode falls back to oldest-first; null/empty input yields []", () => {
    expect(sortCombos(API_ORDER, "bogus").map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(sortCombos(null)).toEqual([]);
    expect(sortCombos(undefined, "name-asc")).toEqual([]);
  });

  it("malformed timestamps sort as epoch 0 instead of throwing", () => {
    const combos = [combo("good", daysAgo(1)), combo("bad", "not-a-date")];
    expect(sortCombos(combos, "created-desc").map((c) => c.name)).toEqual(["good", "bad"]);
    expect(sortCombos(combos, "created-asc").map((c) => c.name)).toEqual(["bad", "good"]);
  });
});

describe("matchComboSearch", () => {
  it("empty/whitespace query matches everything", () => {
    expect(matchComboSearch(API_ORDER[0], "")).toBe(true);
    expect(matchComboSearch(API_ORDER[0], "   ")).toBe(true);
    expect(matchComboSearch(null, "")).toBe(true);
  });

  it("case-insensitive substring on name", () => {
    expect(matchComboSearch({ name: "Opus-4.6" }, "OPUS")).toBe(true);
    expect(matchComboSearch({ name: "glm-5.3-flash" }, "flash")).toBe(true);
    expect(matchComboSearch({ name: "glm-5.3-flash" }, "kimi")).toBe(false);
  });

  it("combo without a name never matches a non-empty query", () => {
    expect(matchComboSearch({}, "x")).toBe(false);
    expect(matchComboSearch(null, "x")).toBe(false);
  });
});

describe("sort persistence", () => {
  it("constants expose every option and created-asc as default", () => {
    expect(DEFAULT_SORT).toBe("created-asc");
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain(DEFAULT_SORT);
  });

  it("readStoredSort falls back to default without window (node/SSR)", () => {
    expect(readStoredSort()).toBe(DEFAULT_SORT);
  });

  it("round-trips through window.localStorage and validates stored values", () => {
    const store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, v),
      },
    };
    expect(readStoredSort()).toBe(DEFAULT_SORT);
    writeStoredSort("name-desc");
    expect(store.get(SORT_STORAGE_KEY)).toBe("name-desc");
    expect(readStoredSort()).toBe("name-desc");
    store.set(SORT_STORAGE_KEY, "bogus-mode");
    expect(readStoredSort()).toBe(DEFAULT_SORT);
  });

  it("writeStoredSort swallows storage failures (quota/security errors)", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => writeStoredSort("name-asc")).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
  });
});
