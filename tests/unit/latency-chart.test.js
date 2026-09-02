import { describe, it, expect } from "vitest";
import { buildLatencyData } from "@/app/(dashboard)/dashboard/usage/components/latencyUtils.js";

const makeEntry = (key, p50Ttft, p95Ttft, p50Total, p95Total, count) => ({
  p50Ttft, p95Ttft, p50Total, p95Total, count, key,
});

describe("buildLatencyData", () => {
  it("filters noise below threshold", () => {
    const data = buildLatencyData({
      a: makeEntry("a", 10, 20, 30, 40, 5),
      b: makeEntry("b", 10, 20, 30, 40, 15),
    });
    expect(data.data.map((d) => d.key)).toEqual(["b"]);
    expect(data.noisy.map((d) => d.key)).toEqual(["a"]);
    expect(data.excluded).toBe(1);
  });

  it("sorts by p95Total descending", () => {
    const data = buildLatencyData({
      fast: makeEntry("fast", 10, 20, 100, 200, 20),
      slow: makeEntry("slow", 10, 20, 500, 900, 20),
    });
    expect(data.data[0].key).toBe("slow");
    expect(data.data[1].key).toBe("fast");
  });

  it("uses ttft metric for log values", () => {
    const data = buildLatencyData(
      {
        m: makeEntry("m", 50, 150, 100, 400, 20),
      },
      "ttft",
    );
    expect(data.data[0].p50Log).toBeCloseTo(Math.log10(50));
    expect(data.data[0].p95Log).toBeCloseTo(Math.log10(150));
  });

  it("computes p50Frac ratio relative to domain", () => {
    const data = buildLatencyData({
      m: makeEntry("m", 10, 100, 100, 1000, 20),
    });
    expect(data.data[0].p50Frac).toBeGreaterThanOrEqual(0);
    expect(data.data[0].p50Frac).toBeLessThanOrEqual(1);
  });

  it("handles empty input without crashing", () => {
    const data = buildLatencyData({});
    expect(data.data).toEqual([]);
    expect(data.noisy).toEqual([]);
    expect(data.domain[0]).toBeGreaterThan(0);
    expect(data.domain[1]).toBeGreaterThan(0);
  });

  it("passes through the display label for custom provider nodes", () => {
    const data = buildLatencyData({
      "claude-opus-5 (openai-compatible-chat-007fabcf)": {
        ...makeEntry("ignored", 10, 20, 30, 40, 15),
        label: "claude-opus-5 (just-woker)",
      },
    });
    expect(data.data[0].key).toBe("claude-opus-5 (openai-compatible-chat-007fabcf)");
    expect(data.data[0].label).toBe("claude-opus-5 (just-woker)");
  });

  it("falls back to the key when no label is present", () => {
    const data = buildLatencyData({
      "mimo-v2.5-free (opencode)": makeEntry("ignored", 10, 20, 30, 40, 15),
      noisy: makeEntry("ignored", 10, 20, 30, 40, 1),
    });
    expect(data.data[0].label).toBe("mimo-v2.5-free (opencode)");
    expect(data.noisy[0].label).toBe("noisy");
  });
});

describe("buildLatencyData hidden models", () => {
  it("drops hidden keys from data but keeps them in all", () => {
    const source = {
      a: makeEntry("a", 10, 20, 100, 200, 20),
      b: makeEntry("b", 10, 20, 300, 400, 20),
    };
    const data = buildLatencyData(source, "total", new Set(["a"]));
    expect(data.data.map((d) => d.key)).toEqual(["b"]);
    expect(data.all.map((d) => d.key)).toEqual(["b", "a"]);
  });

  it("exposes all as key/label pairs in chart sort order", () => {
    const data = buildLatencyData({
      fast: { ...makeEntry("fast", 10, 20, 100, 200, 20), label: "fast (node-x)" },
      slow: makeEntry("slow", 10, 20, 500, 900, 20),
    });
    expect(data.all).toEqual([
      { key: "slow", label: "slow" },
      { key: "fast", label: "fast (node-x)" },
    ]);
  });

  it("rescales the domain and ticks when the slowest model is hidden", () => {
    const source = {
      fast: makeEntry("fast", 10, 20, 100, 200, 20),
      slow: makeEntry("slow", 10, 20, 5000, 50000, 20),
    };
    const unfiltered = buildLatencyData(source);
    const filtered = buildLatencyData(source, "total", new Set(["slow"]));
    expect(filtered.domain[1]).toBeLessThan(unfiltered.domain[1]);
    expect(filtered.domain[1]).toBeCloseTo(Math.log10(1000));
    expect(filtered.ticks.length).toBeLessThan(unfiltered.ticks.length);
  });

  it("recomputes p50Frac against the narrowed domain", () => {
    const source = {
      fast: makeEntry("fast", 10, 20, 300, 900, 20),
      slow: makeEntry("slow", 10, 20, 5000, 50000, 20),
    };
    const unfiltered = buildLatencyData(source);
    const filtered = buildLatencyData(source, "total", new Set(["slow"]));
    const before = unfiltered.data.find((d) => d.key === "fast").p50Frac;
    const after = filtered.data.find((d) => d.key === "fast").p50Frac;
    expect(after).not.toBeCloseTo(before);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(1);
  });

  it("returns an empty chart with a finite domain when every model is hidden", () => {
    const data = buildLatencyData(
      {
        a: makeEntry("a", 10, 20, 100, 200, 20),
        b: makeEntry("b", 10, 20, 300, 400, 20),
      },
      "total",
      new Set(["a", "b"]),
    );
    expect(data.data).toEqual([]);
    expect(data.all).toHaveLength(2);
    expect(Number.isFinite(data.domain[0])).toBe(true);
    expect(Number.isFinite(data.domain[1])).toBe(true);
    expect(data.domain[0]).toBeLessThan(data.domain[1]);
  });

  it("ignores hidden keys that are unknown or below the noise threshold", () => {
    const data = buildLatencyData(
      {
        a: makeEntry("a", 10, 20, 100, 200, 20),
        quiet: makeEntry("quiet", 10, 20, 100, 200, 3),
      },
      "total",
      new Set(["gone", "quiet"]),
    );
    expect(data.data.map((d) => d.key)).toEqual(["a"]);
    expect(data.all.map((d) => d.key)).toEqual(["a"]);
    expect(data.noisy.map((d) => d.key)).toEqual(["quiet"]);
    expect(data.excluded).toBe(1);
  });

  it("treats a missing or empty hidden set as show-everything", () => {
    const source = {
      a: makeEntry("a", 10, 20, 100, 200, 20),
      b: makeEntry("b", 10, 20, 300, 400, 20),
    };
    const omitted = buildLatencyData(source);
    const empty = buildLatencyData(source, "total", new Set());
    expect(empty.data.map((d) => d.key)).toEqual(omitted.data.map((d) => d.key));
    expect(empty.domain).toEqual(omitted.domain);
  });
});
