import { describe, expect, it } from "vitest";
import { buildMaps } from "../../src/shared/hooks/useModelCaps.js";

const caps = (label) => ({ vision: label === "vision", label });

describe("useModelCaps buildMaps", () => {
  it("indexes every prefixed form the picker can store", () => {
    const maps = buildMaps([
      { provider: "acme", model: "m1", fullModel: "acme/m1", routedModel: "acme/m1", caps: caps("full") },
      { provider: "node", model: "m2", fullModel: "node/m2", routedModel: "node/m2", prefixModel: "qwen-3.8/m2", caps: caps("prefix") },
    ]);

    expect(maps.byFull["acme/m1"]).toEqual(caps("full"));
    expect(maps.byFull["node/m2"]).toEqual(caps("prefix"));
    expect(maps.byFull["qwen-3.8/m2"]).toEqual(caps("prefix"));
  });

  it("only exposes a bare model id when exactly one provider declares it", () => {
    const maps = buildMaps([
      { model: "shared", fullModel: "a/shared", caps: caps("a") },
      { model: "shared", fullModel: "b/shared", caps: caps("b") },
      { model: "unique", fullModel: "c/unique", caps: caps("vision") },
    ]);

    // Ambiguous ids are dropped: last-write-wins used to serve another
    // provider's capabilities (wrong or missing icons).
    expect(maps.byId.shared).toBeUndefined();
    expect(maps.byId.unique).toEqual(caps("vision"));
  });

  it("keeps levels keyed by the same forms as caps", () => {
    const maps = buildMaps([
      { provider: "node", model: "m2", fullModel: "node/m2", routedModel: "node/m2", prefixModel: "qwen-3.8/m2", caps: caps("vision"), thinkingLevels: ["low", "high"] },
    ]);

    expect(maps.byLevelsFull["qwen-3.8/m2"]).toEqual(["low", "high"]);
    expect(maps.byLevelsFull["node/m2"]).toEqual(["low", "high"]);
    expect(maps.byLevelsId.m2).toEqual(["low", "high"]);
  });

  it("ignores entries without caps", () => {
    const maps = buildMaps([{ model: "x", fullModel: "a/x" }]);
    expect(maps.byFull).toEqual({});
    expect(maps.byId).toEqual({});
  });
});
