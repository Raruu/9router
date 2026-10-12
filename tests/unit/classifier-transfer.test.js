// Single-profile JSON export/import for the thinking classifier page.
// Pure helpers only; the page owns the Blob download and file input.
import { describe, it, expect } from "vitest";

import {
  CLASSIFIER_EXPORT_FORMAT,
  buildClassifierExport,
  buildClassifierExportFilename,
  parseClassifierImport,
} from "../../src/app/(dashboard)/dashboard/thinking-classifier/classifierTransfer.js";

const PROFILE = {
  id: "uuid-1",
  name: "laya",
  isActive: false,
  models: [{ model: "oc/jev-1.13-free", timeoutMs: 5000 }],
  timeoutMode: "per-model",
  timeoutMs: 8000,
  mode: "argmax",
  questions: [
    { id: "q_low", levels: ["low"], instructions: "simple?" },
    { id: "q_high", levels: ["max", "high"], instructions: "hard?" },
  ],
  threshold: { question: { id: "complexity", instructions: "?" }, cuts: [{ max: 1, levels: ["max"] }] },
  fallbackLevel: "high",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("buildClassifierExport", () => {
  it("emits the portable payload without id, timestamps or isActive", () => {
    const payload = buildClassifierExport(PROFILE, new Date("2026-05-05T10:00:00.000Z"));
    expect(payload.format).toBe(CLASSIFIER_EXPORT_FORMAT);
    expect(payload.version).toBe(1);
    expect(payload.exportedAt).toBe("2026-05-05T10:00:00.000Z");
    expect(payload.classifier.name).toBe("laya");
    expect(payload.classifier.models).toEqual([{ model: "oc/jev-1.13-free", timeoutMs: 5000 }]);
    expect(payload.classifier.timeoutMode).toBe("per-model");
    expect(payload.classifier.fallbackLevel).toBe("high");
    // Routing state and install-local identity must not travel in a file.
    expect("id" in payload.classifier).toBe(false);
    expect("isActive" in payload.classifier).toBe(false);
    expect("createdAt" in payload.classifier).toBe(false);
  });

  it("normalizes a legacy single-model profile into a list", () => {
    const payload = buildClassifierExport({ name: "old", model: "oc/legacy", timeoutMs: 3000 });
    expect(payload.classifier.models).toEqual([{ model: "oc/legacy", timeoutMs: 3000 }]);
  });
});

describe("buildClassifierExportFilename", () => {
  it("is filename-safe and timestamped", () => {
    expect(buildClassifierExportFilename("my tier/1", new Date(2026, 4, 5, 9, 8, 7)))
      .toBe("9router-thinking-classifier-my-tier-1-20260505-090807.json");
  });

  it("falls back to a default stem", () => {
    expect(buildClassifierExportFilename("", new Date(2026, 0, 1, 0, 0, 0)))
      .toBe("9router-thinking-classifier-classifier-20260101-000000.json");
  });
});

describe("parseClassifierImport", () => {
  it("round-trips an exported payload", () => {
    const text = JSON.stringify(buildClassifierExport(PROFILE));
    const { classifier } = parseClassifierImport(text);
    expect(classifier.name).toBe("laya");
    expect(classifier.models).toEqual([{ model: "oc/jev-1.13-free", timeoutMs: 5000 }]);
    expect(classifier.mode).toBe("argmax");
    expect(classifier.questions).toHaveLength(2);
    expect(classifier.fallbackLevel).toBe("high");
  });

  it("accepts a bare classifier object", () => {
    const { classifier } = parseClassifierImport(JSON.stringify({
      name: "bare",
      models: ["oc/a"],
      mode: "argmax",
      questions: [{ id: "q", levels: ["low"] }],
    }));
    expect(classifier.name).toBe("bare");
    expect(classifier.models).toEqual([{ model: "oc/a", timeoutMs: 10000 }]);
  });

  it("rejects malformed documents with a user-facing message", () => {
    expect(() => parseClassifierImport("")).toThrow("File is empty");
    expect(() => parseClassifierImport("{not json")).toThrow("Invalid JSON");
    expect(() => parseClassifierImport("[]")).toThrow("Expected a JSON object");
    expect(() => parseClassifierImport(JSON.stringify({ classifier: "x" }))).toThrow("Expected a classifier object");
    expect(() => parseClassifierImport(JSON.stringify({ classifier: { models: ["oc/a"] } }))).toThrow("Name is required");
    expect(() => parseClassifierImport(JSON.stringify({ classifier: { name: "max", models: ["oc/a"] } }))).toThrow("reserved");
    expect(() => parseClassifierImport(JSON.stringify({ classifier: { name: "t", models: [] } }))).toThrow("No classifier model");
  });

  it("rejects a profile whose mode has nothing to decide with", () => {
    expect(() => parseClassifierImport(JSON.stringify({
      classifier: { name: "t", models: ["oc/a"], mode: "argmax", questions: [{ id: "q", levels: [] }] },
    }))).toThrow("must list a level");
    expect(() => parseClassifierImport(JSON.stringify({
      classifier: { name: "t", models: ["oc/a"], mode: "threshold", threshold: { cuts: [] } },
    }))).toThrow("at least one cut");
  });

  it("falls back to safe defaults for unknown enum values", () => {
    const { classifier } = parseClassifierImport(JSON.stringify({
      classifier: {
        name: "t", models: ["oc/a"], mode: "bogus",
        timeoutMode: "nope", fallbackLevel: "nope",
        questions: [{ id: "q", levels: ["low"] }],
      },
    }));
    expect(classifier.mode).toBe("argmax");
    expect(classifier.timeoutMode).toBe("uniform");
    expect(classifier.fallbackLevel).toBe("medium");
  });
});
