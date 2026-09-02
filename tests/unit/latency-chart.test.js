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
