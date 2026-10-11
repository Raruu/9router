// Thinking Effort Classifier — interception end to end (applyThinkingClassifier)
// with the System One call mocked, plus tier advertisement ordering.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = {
  profile: null,
  credentials: { connectionId: "conn-1", apiKey: "sk" },
  systemoneResult: null,
  supportedLevels: null,
  levelsByModel: {},
  comboModels: null,
  handleSystemoneCore: vi.fn(),
  saveRequestUsage: vi.fn(),
};

vi.mock("@/lib/db/repos/thinkingClassifiersRepo.js", () => ({
  getThinkingClassifierByName: vi.fn(async (name) => (mocks.profile && mocks.profile.name === name ? mocks.profile : null)),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(async () => mocks.credentials),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (modelStr) => {
    const [provider, ...rest] = modelStr.split("/");
    return { provider, model: rest.join("/") };
  }),
}));

vi.mock("open-sse/providers/thinkingLevels.js", () => ({
  getThinkingLevels: vi.fn((provider, model) => mocks.levelsByModel[`${provider}/${model}`] ?? mocks.supportedLevels),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderNodes: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/providerPrefixMap.js", () => ({
  buildProviderIdByPrefix: vi.fn(() => new Map()),
}));

vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({
  handleSystemoneCore: mocks.handleSystemoneCore,
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  line: vi.fn(),
  errorLine: vi.fn(),
}));

const { applyThinkingClassifier } = await import("../../src/sse/services/thinkingClassifier.js");
const { withClassifierTiers } = await import("open-sse/providers/comboCapabilities.js");

const PROFILE = {
  id: "p1",
  name: "laya",
  isActive: true,
  model: "oc/jev-1.13-free",
  mode: "argmax",
  questions: [
    { id: "q_low", levels: ["low"], instructions: "simple?" },
    { id: "q_high", levels: ["max", "xhigh", "high"], instructions: "complex?" },
  ],
  fallbackLevel: "medium",
  timeoutMs: 5000,
};

const OK_ANSWERS = (answers) => ({
  success: true,
  usage: { prompt_tokens: 10, completion_tokens: 2 },
  response: new Response(JSON.stringify({ answers }), { status: 200 }),
});

beforeEach(() => {
  mocks.profile = { ...PROFILE };
  mocks.credentials = { connectionId: "conn-1", apiKey: "sk" };
  mocks.systemoneResult = OK_ANSWERS({ q_low: { noul: 0.1 }, q_high: { noul: 0.9 } });
  mocks.supportedLevels = null;
  mocks.levelsByModel = {};
  mocks.comboModels = null;
  mocks.handleSystemoneCore.mockReset();
  mocks.handleSystemoneCore.mockImplementation(async () => mocks.systemoneResult);
  mocks.saveRequestUsage.mockReset();
  // Production awaits/catches this — the mock must return a promise.
  mocks.saveRequestUsage.mockImplementation(async () => {});
});

describe("applyThinkingClassifier", () => {
  it("is a no-op when the client sends no effort at all", async () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    expect(await applyThinkingClassifier(body, null)).toBeNull();
    expect(mocks.handleSystemoneCore).not.toHaveBeenCalled();
  });

  it("leaves real effort levels untouched (no classifier lookup hit)", async () => {
    const body = { reasoning_effort: "high" };
    expect(await applyThinkingClassifier(body, null)).toBeNull();
    expect(body.reasoning_effort).toBe("high");
  });

  it("ignores names that are not an active profile", async () => {
    mocks.profile = null;
    const body = { reasoning_effort: "laya" };
    expect(await applyThinkingClassifier(body, null)).toBeNull();
    expect(body.reasoning_effort).toBe("laya"); // upstream may know it; we do not touch it
  });

  it("sends the chain's first entry when the target has no level information", async () => {
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "refactor the parser" }] };
    const decision = await applyThinkingClassifier(body, null, { modelStr: "anthropic/claude-opus-4.6" });
    expect(decision).toMatchObject({ profile: "laya", requested: "laya", level: "max", fallback: false });
    expect(decision.candidates).toEqual(["max", "xhigh", "high"]);
    expect(body.reasoning_effort).toBe("max");
    expect(mocks.handleSystemoneCore).toHaveBeenCalledTimes(1);
  });

  it("picks the first chain entry the target supports", async () => {
    mocks.supportedLevels = ["none", "low", "medium", "high"];
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null, { modelStr: "qwen/qwen3-max" });
    expect(decision.level).toBe("high");
    expect(body.reasoning_effort).toBe("high");
  });

  it("picks a lower chain entry when the target skips the first ones", async () => {
    mocks.supportedLevels = ["none", "xhigh"];
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null, { modelStr: "openai/gpt-5.4" });
    expect(decision.level).toBe("xhigh");
  });

  it("uses the union of combo member levels", async () => {
    // The combo path resolves levels through comboEffortTiers (union by
    // default), so "max" is supported by the flagship member even though the
    // other member stops at high.
    mocks.comboModels = ["qwen/qwen3-max", "openai/gpt-5.4"];
    mocks.levelsByModel = {
      "qwen/qwen3-max": ["none", "low", "medium", "high"],
      "openai/gpt-5.4": ["none", "low", "medium", "high", "xhigh"],
    };
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null, { modelStr: "my-combo", comboModels: mocks.comboModels });
    // Union is [none, low, medium, high, xhigh] — none of the chain
    // (max, xhigh, high) is "max", so the first supported entry is xhigh.
    expect(decision.level).toBe("xhigh");
  });

  it("falls back to the first candidate when no combo member reports levels", async () => {
    mocks.comboModels = ["qwen/qwen3-max", "openai/gpt-5.4"];
    mocks.levelsByModel = {};
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null, { modelStr: "my-combo", comboModels: mocks.comboModels });
    expect(decision.level).toBe("max");
  });

  it("writes back into the exact field the client used", async () => {
    const body = { output_config: { effort: "laya" }, messages: [{ role: "user", content: "hi" }] };
    await applyThinkingClassifier(body, null);
    expect(body.output_config.effort).toBe("max");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("falls back to the profile's fallbackLevel when the classifier fails", async () => {
    mocks.handleSystemoneCore.mockImplementation(async () => ({ success: false, status: 502, error: "upstream down" }));
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null);
    expect(decision).toMatchObject({ profile: "laya", level: "medium", fallback: true });
    expect(body.reasoning_effort).toBe("medium");
  });

  it("falls back when the classifier throws", async () => {
    mocks.handleSystemoneCore.mockImplementation(async () => { throw new Error("boom"); });
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null);
    expect(decision.fallback).toBe(true);
    expect(body.reasoning_effort).toBe("medium");
  });

  it("falls back when the classifier answers nothing usable", async () => {
    mocks.systemoneResult = OK_ANSWERS({});
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    const decision = await applyThinkingClassifier(body, null);
    expect(decision.fallback).toBe(true);
    expect(body.reasoning_effort).toBe("medium");
  });

  it("falls back when there is no prompt text to classify", async () => {
    const body = { reasoning_effort: "laya" };
    const decision = await applyThinkingClassifier(body, null);
    expect(decision.fallback).toBe(true);
    expect(body.reasoning_effort).toBe("medium");
    expect(mocks.handleSystemoneCore).not.toHaveBeenCalled();
  });

  it("validates the fallback level and defaults to medium", async () => {
    mocks.profile = { ...PROFILE, fallbackLevel: "bogus" };
    mocks.handleSystemoneCore.mockImplementation(async () => ({ success: false, error: "nope" }));
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    await applyThinkingClassifier(body, null);
    expect(body.reasoning_effort).toBe("medium");
  });

  it("records classifier usage with an internal endpoint tag", async () => {
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "hi" }] };
    await applyThinkingClassifier(body, null);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toMatchObject({
      endpoint: "/internal/thinking-classifier",
      provider: "oc",
      model: "jev-1.13-free",
    });
  });

  it("inactive profiles are neither matched nor advertised", async () => {
    mocks.profile = { ...PROFILE, isActive: false };
    const body = { reasoning_effort: "laya" };
    expect(await applyThinkingClassifier(body, null)).toBeNull();
    expect(body.reasoning_effort).toBe("laya");
  });
});

describe("withClassifierTiers", () => {
  it("appends classifier names after the real levels", () => {
    expect(withClassifierTiers(["none", "low", "high"], ["laya", "jev"]))
      .toEqual(["none", "low", "high", "laya", "jev"]);
  });

  it("deduplicates and keeps first-seen order for extras", () => {
    expect(withClassifierTiers(["low"], ["laya", "laya", "jev"]))
      .toEqual(["low", "laya", "jev"]);
  });

  it("returns the base list unchanged when no classifier is active", () => {
    expect(withClassifierTiers(["low", "high"], [])).toEqual(["low", "high"]);
    expect(withClassifierTiers(["low"], null)).toEqual(["low"]);
    expect(withClassifierTiers(null, [])).toBeNull();
  });

  it("returns names alone when the model has no real levels", () => {
    expect(withClassifierTiers([], ["laya"])).toEqual(["laya"]);
  });
});
