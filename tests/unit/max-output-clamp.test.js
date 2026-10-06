// Maximum output clamp — Model Catalog `clampMaxOutput` capability.
//
// A client is free to send an output cap above the model's real ceiling (a
// generic client sends max_tokens: 200000 against a 128000 model); the
// upstream then rejects the request or silently truncates. The catalog's
// clampMaxOutput pulls an explicitly-sent cap down to the resolved maxOutput
// just before dispatch — but only when a layer explicitly declares that
// ceiling, so the 64K DEFAULT_CAPABILITIES fallback never caps a client.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

import { applyMaxOutputClamp, resolveMaxOutputClamp } from "../../open-sse/translator/formats/maxOutputClamp.js";
import { sanitizeCapabilities } from "../../src/lib/modelCatalog/validation.js";
import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { createCatalogResolver } from "../../src/lib/modelCatalog/resolution.js";

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

afterEach(() => setCatalogSource(null));

describe("sanitizeCapabilities — clampMaxOutput", () => {
  it("keeps booleans and drops non-boolean values", () => {
    expect(sanitizeCapabilities({ clampMaxOutput: true })).toEqual({ clampMaxOutput: true });
    expect(sanitizeCapabilities({ clampMaxOutput: false })).toEqual({ clampMaxOutput: false });
    expect(sanitizeCapabilities({ clampMaxOutput: "yes" })).toEqual({});
    expect(sanitizeCapabilities({ clampMaxOutput: 1 })).toEqual({});
  });
});

describe("resolveMaxOutputClamp", () => {
  it("reads the resolved marker and floors it", () => {
    expect(resolveMaxOutputClamp("acme", "m", { maxOutputClamp: 128000.9 })).toBe(128000);
  });

  it("returns null when unset or non-positive", () => {
    expect(resolveMaxOutputClamp("acme", "m", {})).toBeNull();
    expect(resolveMaxOutputClamp("acme", "m", { maxOutputClamp: 0 })).toBeNull();
    expect(resolveMaxOutputClamp("acme", "m", { maxOutputClamp: -5 })).toBeNull();
  });
});

describe("applyMaxOutputClamp — per-format fields", () => {
  it("lowers all openai spellings above the ceiling", () => {
    const body = { max_tokens: 200000, max_completion_tokens: 999999, max_output_tokens: 128001 };
    expect(applyMaxOutputClamp(body, "openai", 128000)).toBe(3);
    expect(body).toEqual({ max_tokens: 128000, max_completion_tokens: 128000, max_output_tokens: 128000 });
  });

  it("touches only max_output_tokens on the responses wire", () => {
    const body = { max_output_tokens: 200000, max_tokens: 200000 };
    expect(applyMaxOutputClamp(body, "openai-responses", 128000)).toBe(1);
    expect(body).toEqual({ max_output_tokens: 128000, max_tokens: 200000 });
  });

  it("lowers claude max_tokens", () => {
    const body = { max_tokens: 200000 };
    expect(applyMaxOutputClamp(body, "claude", 128000)).toBe(1);
    expect(body.max_tokens).toBe(128000);
  });

  it("lowers the nested gemini generationConfig field", () => {
    const body = { generationConfig: { maxOutputTokens: 200000, temperature: 1 } };
    expect(applyMaxOutputClamp(body, "gemini", 128000)).toBe(1);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 128000, temperature: 1 });
    expect(applyMaxOutputClamp(body, "vertex", 64000)).toBe(1);
    expect(body.generationConfig.maxOutputTokens).toBe(64000);
  });

  it("lowers ollama num_predict", () => {
    const body = { options: { num_predict: 999999 } };
    expect(applyMaxOutputClamp(body, "ollama", 128000)).toBe(1);
    expect(body.options.num_predict).toBe(128000);
  });

  it("leaves absent, at-ceiling, below-ceiling, and non-number values untouched", () => {
    const body = { max_tokens: 128000 };
    expect(applyMaxOutputClamp(body, "openai", 128000)).toBe(0);
    expect(body.max_tokens).toBe(128000);

    const absent = {};
    expect(applyMaxOutputClamp(absent, "openai", 128000)).toBe(0);
    expect(absent).toEqual({});

    const below = { max_tokens: 4096 };
    expect(applyMaxOutputClamp(below, "openai", 128000)).toBe(0);
    expect(below.max_tokens).toBe(4096);

    const stringy = { max_tokens: "200000" };
    expect(applyMaxOutputClamp(stringy, "openai", 128000)).toBe(0);
    expect(stringy.max_tokens).toBe("200000");
  });

  it("is a no-op for unknown formats and invalid ceilings", () => {
    const body = { max_tokens: 200000 };
    expect(applyMaxOutputClamp(body, "kiro", 128000)).toBe(0);
    expect(applyMaxOutputClamp(body, "codex", 128000)).toBe(0);
    expect(applyMaxOutputClamp(body, "openai", 0)).toBe(0);
    expect(applyMaxOutputClamp(body, "openai", NaN)).toBe(0);
    expect(body.max_tokens).toBe(200000);
  });
});

describe("refine — maxOutputClamp marker", () => {
  function installClamp(caps) {
    setCatalogSource({
      getCapabilities: () => caps,
      getModalities: () => null,
      getLimits: () => null,
    });
  }

  it("marks the ceiling when a layer declares maxOutput and the rule opted in", () => {
    installClamp({ clampMaxOutput: true, maxOutput: 128000 });
    const caps = getCapabilitiesForModel("acme", "some-model");
    expect(caps.maxOutputClamp).toBe(128000);
  });

  it("never marks against the 64K default fallback", () => {
    installClamp({ clampMaxOutput: true });
    const caps = getCapabilitiesForModel("acme", "some-unknown-model");
    expect(caps.maxOutputClamp).toBeUndefined();
    expect(caps.maxOutput).toBe(64000);
  });

  it("does not mark when the rule did not opt in", () => {
    installClamp({ maxOutput: 128000 });
    const caps = getCapabilitiesForModel("acme", "some-model");
    expect(caps.maxOutputClamp).toBeUndefined();
  });
});

describe("catalog resolution carries clampMaxOutput", () => {
  it("resolves through a user rule and loses to a higher-specificity rule", () => {
    const resolver = createCatalogResolver({
      userRules: [
        { provider: "*", pattern: "*big*", data: { capabilities: { clampMaxOutput: true } } },
        { provider: "acme", pattern: "big-exact", data: { capabilities: { clampMaxOutput: false } } },
      ],
    });
    expect(resolver.getCapabilities("acme", "other-big").clampMaxOutput).toBe(true);
    expect(resolver.getCapabilities("acme", "big-exact").clampMaxOutput).toBe(false);
  });
});

describe("handleChatCore — output clamp reaches the executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.example.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  function installClampRule({ clamp = true, maxOutput } = {}) {
    setCatalogSource(createCatalogResolver({
      userRules: [{
        provider: "acme",
        pattern: "big-*",
        data: { capabilities: { clampMaxOutput: clamp, ...(maxOutput ? { maxOutput } : {}) } },
      }],
    }));
  }

  async function runChat(body) {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await handleChatCore({
      body: { model: "big-1", stream: false, messages: [{ role: "user", content: "hi" }], ...body },
      modelInfo: { provider: "acme", model: "big-1" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });
    return { log, executedBody: executeMock.mock.calls[0][0].body };
  }

  it("lowers a client cap above the ceiling", async () => {
    installClampRule({ maxOutput: 128000 });
    const { log, executedBody } = await runChat({ max_tokens: 200000 });
    expect(executedBody.max_tokens).toBe(128000);
    expect(log.debug).toHaveBeenCalledWith("MAXOUT", expect.stringContaining("128000"));
  });

  it("leaves a cap at or below the ceiling untouched", async () => {
    installClampRule({ maxOutput: 128000 });
    const { executedBody } = await runChat({ max_tokens: 65536 });
    expect(executedBody.max_tokens).toBe(65536);
  });

  it("leaves an absent cap absent", async () => {
    installClampRule({ maxOutput: 128000 });
    const { executedBody } = await runChat({});
    expect(executedBody.max_tokens).toBeUndefined();
  });

  it("does nothing when the rule opted out", async () => {
    installClampRule({ clamp: false, maxOutput: 128000 });
    const { executedBody } = await runChat({ max_tokens: 200000 });
    expect(executedBody.max_tokens).toBe(200000);
  });

  it("does nothing without a declared ceiling", async () => {
    installClampRule({ clamp: true });
    const { executedBody } = await runChat({ max_tokens: 200000 });
    expect(executedBody.max_tokens).toBe(200000);
  });
});
