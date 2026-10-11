// Payload normalization for the thinking-classifiers API routes.
import { describe, it, expect, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: vi.fn((body, init) => ({ status: init?.status || 200, body })) } }));
vi.mock("@/lib/db/index.js", () => ({}));

const { normalizeClassifierInput } = await import("../../src/app/api/thinking-classifiers/route.js");

describe("normalizeClassifierInput", () => {
  it("accepts a minimal payload and applies the generic template", () => {
    const { value } = normalizeClassifierInput({ name: "laya", model: "oc/jev-1.13-free" });
    expect(value.name).toBe("laya");
    expect(value.mode).toBe("argmax");
    expect(value.isActive).toBe(true);
    expect(value.questions.length).toBeGreaterThan(0);
    expect(value.fallbackLevel).toBe("medium");
    expect(value.timeoutMs).toBe(10000);
  });

  it("rejects reserved and malformed names", () => {
    expect(normalizeClassifierInput({ name: "max", model: "m" }).error).toContain("reserved");
    expect(normalizeClassifierInput({ name: "Bad Name", model: "m" }).error).toBeTruthy();
    expect(normalizeClassifierInput({ model: "m" }).error).toBe("Name is required");
  });

  it("requires a classifier model", () => {
    expect(normalizeClassifierInput({ name: "tier" }).error).toContain("model");
  });

  it("drops unknown fields and invalid levels instead of passing them through", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m", evil: "payload",
      questions: [
        { id: "q1", level: "bogus", instructions: "x" },
        { id: "q2", level: "high", instructions: "y" },
      ],
    });
    expect(value.evil).toBeUndefined();
    expect(value.questions[0].level).toBeNull();
    expect(value.questions[1].level).toBe("high");
  });

  it("rejects argmax without any level-mapped question and threshold without cuts", () => {
    expect(normalizeClassifierInput({ name: "tier", model: "m", questions: [{ id: "q", level: "bogus" }] }).error)
      .toContain("level");
    expect(normalizeClassifierInput({ name: "tier", model: "m", mode: "threshold", threshold: { cuts: [] } }).error)
      .toContain("cut");
  });

  it("sorts threshold cuts ascending and clamps the timeout", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m", mode: "threshold",
      threshold: { question: { id: "c", instructions: "?" }, cuts: [{ max: 0.9, level: "high" }, { max: 0.3, level: "low" }] },
      timeoutMs: 999999,
    });
    expect(value.threshold.cuts.map((c) => c.max)).toEqual([0.3, 0.9]);
    expect(value.timeoutMs).toBe(60000);
  });

  it("falls back to medium for an unknown fallback level", () => {
    expect(normalizeClassifierInput({ name: "tier", model: "m", fallbackLevel: "nope" }).value.fallbackLevel).toBe("medium");
    expect(normalizeClassifierInput({ name: "tier", model: "m", fallbackLevel: "high" }).value.fallbackLevel).toBe("high");
  });
});
