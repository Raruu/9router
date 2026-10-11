// Thinking Effort Classifier — interception end to end (applyThinkingClassifier)
// with the System One call mocked, plus tier advertisement ordering.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = {
  profile: null,
  credentials: { connectionId: "conn-1", apiKey: "sk" },
  systemoneResult: null,
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
    { id: "q_low", level: "low", instructions: "simple?" },
    { id: "q_high", level: "high", instructions: "complex?" },
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

  it("replaces the requested tier with the classified level", async () => {
    const body = { reasoning_effort: "laya", messages: [{ role: "user", content: "refactor the parser" }] };
    const decision = await applyThinkingClassifier(body, null);
    expect(decision).toMatchObject({ profile: "laya", requested: "laya", level: "high", fallback: false });
    expect(body.reasoning_effort).toBe("high");
    expect(mocks.handleSystemoneCore).toHaveBeenCalledTimes(1);
  });

  it("writes back into the exact field the client used", async () => {
    const body = { output_config: { effort: "laya" }, messages: [{ role: "user", content: "hi" }] };
    await applyThinkingClassifier(body, null);
    expect(body.output_config.effort).toBe("high");
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
