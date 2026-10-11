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

  it("drops unknown fields and normalizes level chains", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m", evil: "payload",
      questions: [
        { id: "q1", levels: ["MAX", "xhigh", "xhigh"], instructions: "x" },
        { id: "q2", level: "high", instructions: "y" },
      ],
    });
    expect(value.evil).toBeUndefined();
    expect(value.questions[0].levels).toEqual(["max", "xhigh"]);
    // Legacy single-level payloads upgrade to a one-entry chain.
    expect(value.questions[1].levels).toEqual(["high"]);
    expect(value.questions[1].level).toBeUndefined();
  });

  it("keeps unknown level values — no vocabulary check", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m",
      questions: [{ id: "q", levels: ["hyper", "high"], instructions: "x" }],
    });
    expect(value.questions[0].levels).toEqual(["hyper", "high"]);
  });

  it("rejects argmax without any leveled question and threshold without leveled cuts", () => {
    expect(normalizeClassifierInput({ name: "tier", model: "m", questions: [{ id: "q", levels: [] }] }).error)
      .toContain("level");
    expect(normalizeClassifierInput({ name: "tier", model: "m", mode: "threshold", threshold: { cuts: [] } }).error)
      .toContain("cut");
    expect(normalizeClassifierInput({ name: "tier", model: "m", mode: "threshold", threshold: { cuts: [{ max: 0.5, levels: [] }] } }).error)
      .toContain("cut");
  });

  it("sorts threshold cuts ascending, keeps chains and clamps the timeout", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m", mode: "threshold",
      threshold: {
        question: { id: "c", instructions: "?" },
        cuts: [{ max: 0.9, levels: ["high", "medium"] }, { max: 0.3, levels: ["low", "none"] }],
      },
      timeoutMs: 999999,
    });
    expect(value.threshold.cuts.map((c) => c.max)).toEqual([0.3, 0.9]);
    expect(value.threshold.cuts[0].levels).toEqual(["low", "none"]);
    expect(value.threshold.cuts[1].levels).toEqual(["high", "medium"]);
    expect(value.timeoutMs).toBe(60000);
  });

  it("accepts the wider fallback set and rejects unknown values", () => {
    for (const level of ["none", "xhigh", "auto"]) {
      expect(normalizeClassifierInput({ name: "tier", model: "m", fallbackLevel: level }).value.fallbackLevel).toBe(level);
    }
    expect(normalizeClassifierInput({ name: "tier", model: "m", fallbackLevel: "nope" }).value.fallbackLevel).toBe("medium");
    expect(normalizeClassifierInput({ name: "tier", model: "m", fallbackLevel: "high" }).value.fallbackLevel).toBe("high");
  });
});
