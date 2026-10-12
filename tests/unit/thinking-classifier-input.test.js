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
    // Legacy single `model` upgrades to a one-entry fallback list.
    expect(value.models).toEqual([{ model: "oc/jev-1.13-free", timeoutMs: 10000 }]);
    expect(value.timeoutMode).toBe("uniform");
  });

  it("normalizes a model list in order, deduped and capped", () => {
    const { value } = normalizeClassifierInput({
      name: "tier",
      models: [
        { model: "oc/a" },
        "oc/b",
        { model: "oc/a" },
        { model: "oc/c", timeoutMs: 2500 },
      ],
    });
    expect(value.models).toEqual([
      { model: "oc/a", timeoutMs: 10000 },
      { model: "oc/b", timeoutMs: 10000 },
      { model: "oc/c", timeoutMs: 2500 },
    ]);
  });

  it("caps the list and clamps each entry's timeout", () => {
    const { value } = normalizeClassifierInput({
      name: "tier",
      models: Array.from({ length: 20 }, (_, i) => ({ model: `oc/m${i}`, timeoutMs: 999999 })),
    });
    expect(value.models).toHaveLength(8);
    expect(value.models[0].timeoutMs).toBe(60000);
  });

  it("carries the timeout mode", () => {
    expect(normalizeClassifierInput({ name: "tier", model: "m", timeoutMode: "per-model" }).value.timeoutMode).toBe("per-model");
    expect(normalizeClassifierInput({ name: "tier", model: "m", timeoutMode: "bogus" }).value.timeoutMode).toBe("uniform");
  });

  it("defaults the input mode and tail window", () => {
    const { value } = normalizeClassifierInput({ name: "tier", model: "m" });
    expect(value.inputMode).toBe("latest-turn");
    expect(value.tailTurns).toBe(6);
    expect(value.tailChars).toBe(2000);
  });

  it("accepts a known input mode and rejects an unknown one", () => {
    expect(normalizeClassifierInput({ name: "tier", model: "m", inputMode: "tail-window" }).value.inputMode).toBe("tail-window");
    expect(normalizeClassifierInput({ name: "tier", model: "m", inputMode: "last-user" }).value.inputMode).toBe("last-user");
    expect(normalizeClassifierInput({ name: "tier", model: "m", inputMode: "bogus" }).value.inputMode).toBe("latest-turn");
  });

  it("clamps the tail window bounds", () => {
    expect(normalizeClassifierInput({ name: "tier", model: "m", tailTurns: 999, tailChars: 1 }).value).toMatchObject({ tailTurns: 20, tailChars: 200 });
    expect(normalizeClassifierInput({ name: "tier", model: "m", tailTurns: 0, tailChars: 99999 }).value).toMatchObject({ tailTurns: 1, tailChars: 4000 });
    expect(normalizeClassifierInput({ name: "tier", model: "m", tailTurns: "x", tailChars: "y" }).value).toMatchObject({ tailTurns: 6, tailChars: 2000 });
  });

  it("rejects reserved and malformed names", () => {
    expect(normalizeClassifierInput({ name: "max", model: "m" }).error).toContain("reserved");
    expect(normalizeClassifierInput({ name: "Bad Name", model: "m" }).error).toBeTruthy();
    expect(normalizeClassifierInput({ model: "m" }).error).toBe("Name is required");
  });

  it("requires at least one classifier model", () => {
    expect(normalizeClassifierInput({ name: "tier" }).error).toContain("model");
    expect(normalizeClassifierInput({ name: "tier", models: [] }).error).toContain("model");
    expect(normalizeClassifierInput({ name: "tier", models: [{ model: "  " }] }).error).toContain("model");
  });

  it("derives question ids from the level chain and ignores client ids", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m", evil: "payload",
      questions: [
        { id: "q1", levels: ["MAX", "xhigh", "xhigh"], instructions: "x" },
        { id: "q2", level: "high", instructions: "y" },
      ],
    });
    expect(value.evil).toBeUndefined();
    expect(value.questions[0].levels).toEqual(["max", "xhigh"]);
    expect(value.questions[0].id).toBe("max-xhigh");
    // Legacy single-level payloads upgrade to a one-entry chain.
    expect(value.questions[1].levels).toEqual(["high"]);
    expect(value.questions[1].level).toBeUndefined();
    expect(value.questions[1].id).toBe("high");
  });

  it("rejects two questions sharing a level chain", () => {
    const result = normalizeClassifierInput({
      name: "tier", model: "m",
      questions: [
        { levels: ["high"], instructions: "a" },
        { levels: ["high"], instructions: "b" },
      ],
    });
    expect(result.error).toContain("same level chain");
    expect(result.error).toContain("high");
  });

  it("rejects duplicate chains that only collide after normalization", () => {
    // Same chain, different spelling/casing/duplication.
    expect(normalizeClassifierInput({
      name: "tier", model: "m",
      questions: [{ levels: ["max", "ultra"] }, { levels: "Max, MAX, ultra" }],
    }).error).toContain("same level chain");
  });

  it("drops questions with no levels instead of keeping an unaddressable row", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m",
      questions: [{ levels: [] }, { levels: ["high"] }],
    });
    expect(value.questions).toHaveLength(1);
    expect(value.questions[0].id).toBe("high");
  });

  it("keeps unknown level values — no vocabulary check", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m",
      questions: [{ id: "q", levels: ["hyper", "high"], instructions: "x" }],
    });
    expect(value.questions[0].levels).toEqual(["hyper", "high"]);
    expect(value.questions[0].id).toBe("hyper-high");
  });

  it("keeps the fixed complexity id for the threshold question", () => {
    const { value } = normalizeClassifierInput({
      name: "tier", model: "m", mode: "threshold",
      threshold: { question: { id: "whatever", instructions: "?" }, cuts: [{ max: 1, levels: ["max"] }] },
    });
    expect(value.threshold.question.id).toBe("complexity");
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
