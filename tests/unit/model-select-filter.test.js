import { describe, expect, it } from "vitest";
import { filterModelSelectGroups, sortModelSelectModels } from "../../src/shared/utils/modelSelectFilter.js";

const openai = {
  name: "OpenAI",
  alias: "openai",
  models: [
    { id: "o3", name: "o3", value: "openai/o3" },
    { id: "gpt-4o", name: "GPT-4o", value: "openai/gpt-4o" },
  ],
};

const node = {
  name: "Agnes",
  alias: "qwen-3.8",
  models: [
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", value: "qwen-3.8/agnes-2.5-flash" },
    { id: "agnes-3-flash", name: "Agnes 3 Flash", value: "qwen-3.8/agnes-3-flash" },
  ],
};

const groups = { openai, "openai-compatible-chat-1": node };

describe("filterModelSelectGroups", () => {
  it("keeps every model of a provider whose name matches", () => {
    // "o3" and "GPT-4o" do not contain "openai" — the group must survive anyway.
    const result = filterModelSelectGroups(groups, { query: "openai" });
    expect(Object.keys(result)).toEqual(["openai"]);
    expect(result.openai.models.map((m) => m.id)).toEqual(["gpt-4o", "o3"]);
  });

  it("matches compatible-node prefixes stored as the group alias", () => {
    const result = filterModelSelectGroups(groups, { query: "qwen-3.8" });
    expect(Object.keys(result)).toEqual(["openai-compatible-chat-1"]);
    expect(result["openai-compatible-chat-1"].models).toHaveLength(2);
  });

  it("still narrows by model name or id when the provider does not match", () => {
    const byName = filterModelSelectGroups(groups, { query: "gpt" });
    expect(Object.keys(byName)).toEqual(["openai"]);
    expect(byName.openai.models.map((m) => m.id)).toEqual(["gpt-4o"]);

    const byId = filterModelSelectGroups(groups, { query: "agnes-3" });
    expect(Object.keys(byId)).toEqual(["openai-compatible-chat-1"]);
    expect(byId["openai-compatible-chat-1"].models.map((m) => m.id)).toEqual(["agnes-3-flash"]);
  });

  it("is case-insensitive", () => {
    expect(Object.keys(filterModelSelectGroups(groups, { query: "AGNES" }))).toEqual(["openai-compatible-chat-1"]);
  });

  it("drops groups with no match", () => {
    expect(filterModelSelectGroups(groups, { query: "zzz-nothing" })).toEqual({});
  });

  it("returns all models sorted for an empty query, added ones first", () => {
    const result = filterModelSelectGroups(groups, { addedModelValues: ["openai/o3"] });
    expect(Object.keys(result)).toEqual(["openai", "openai-compatible-chat-1"]);
    expect(result.openai.models.map((m) => m.value)).toEqual(["openai/o3", "openai/gpt-4o"]);
  });

  it("handles missing alias and empty groups", () => {
    const sparse = { p1: { name: "P1", models: [] }, p2: { name: "P2" } };
    expect(filterModelSelectGroups(sparse, { query: "p1" })).toEqual({
      p1: { name: "P1", models: [] },
    });
    expect(filterModelSelectGroups(sparse, { query: "p2" })).toEqual({
      p2: { name: "P2", models: [] },
    });
  });
});

describe("sortModelSelectModels", () => {
  it("floats added models to the top, alphabetically inside each bucket", () => {
    const models = [
      { id: "z", name: "Zeta", value: "p/z" },
      { id: "a", name: "Alpha", value: "p/a" },
      { id: "b", name: "Beta", value: "p/b" },
    ];
    expect(sortModelSelectModels(models, ["p/z", "p/b"]).map((m) => m.name)).toEqual(["Beta", "Zeta", "Alpha"]);
  });
});
