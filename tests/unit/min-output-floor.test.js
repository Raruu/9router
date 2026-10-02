// Minimum output floor — Model Catalog `minOutput` capability.
//
// A reasoning-heavy model can spend a too-small client output cap entirely on
// internal reasoning and return an empty turn (OpenCode Free muse-spark below
// ~8k is the reported case; custom providers behave the same). The catalog's
// minOutput raises an explicitly-sent smaller cap just before dispatch.
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

import { applyMinOutputFloor, resolveMinOutputFloor } from "../../open-sse/translator/formats/minTokens.js";
import { sanitizeCapabilities } from "../../src/lib/modelCatalog/validation.js";
import { setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { createCatalogResolver } from "../../src/lib/modelCatalog/resolution.js";

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

afterEach(() => setCatalogSource(null));

describe("sanitizeCapabilities — minOutput", () => {
  it("keeps non-negative finite numbers and floors them", () => {
    expect(sanitizeCapabilities({ minOutput: 8000 })).toEqual({ minOutput: 8000 });
    expect(sanitizeCapabilities({ minOutput: 8000.9 })).toEqual({ minOutput: 8000 });
    expect(sanitizeCapabilities({ minOutput: 0 })).toEqual({ minOutput: 0 });
  });

  it("drops invalid values", () => {
    expect(sanitizeCapabilities({ minOutput: -1 })).toEqual({});
    expect(sanitizeCapabilities({ minOutput: "8000" })).toEqual({});
    expect(sanitizeCapabilities({ minOutput: NaN })).toEqual({});
    expect(sanitizeCapabilities({ minOutput: Infinity })).toEqual({});
  });
});

describe("resolveMinOutputFloor", () => {
  it("reads the resolved capability and floors it", () => {
    expect(resolveMinOutputFloor("acme", "m", { minOutput: 8000.9 })).toBe(8000);
  });

  it("returns null when unset or non-positive", () => {
    expect(resolveMinOutputFloor("acme", "m", {})).toBeNull();
    expect(resolveMinOutputFloor("acme", "m", { minOutput: 0 })).toBeNull();
    expect(resolveMinOutputFloor("acme", "m", { minOutput: -5 })).toBeNull();
  });

  it("never exceeds the model's own output ceiling", () => {
    expect(resolveMinOutputFloor("acme", "m", { minOutput: 200000, maxOutput: 131072 })).toBe(131072);
    expect(resolveMinOutputFloor("acme", "m", { minOutput: 8000, maxOutput: 4096 })).toBe(4096);
  });
});

describe("applyMinOutputFloor — per-format fields", () => {
  it("raises all openai spellings below the floor", () => {
    const body = { max_tokens: 100, max_completion_tokens: 500, max_output_tokens: 999 };
    expect(applyMinOutputFloor(body, "openai", 8000)).toBe(3);
    expect(body).toEqual({ max_tokens: 8000, max_completion_tokens: 8000, max_output_tokens: 8000 });
  });

  it("touches only max_output_tokens on the responses wire", () => {
    const body = { max_output_tokens: 100, max_tokens: 100 };
    expect(applyMinOutputFloor(body, "openai-responses", 8000)).toBe(1);
    expect(body).toEqual({ max_output_tokens: 8000, max_tokens: 100 });
  });

  it("raises claude max_tokens", () => {
    const body = { max_tokens: 100 };
    expect(applyMinOutputFloor(body, "claude", 8000)).toBe(1);
    expect(body.max_tokens).toBe(8000);
  });

  it("raises the nested gemini generationConfig field", () => {
    const body = { generationConfig: { maxOutputTokens: 100, temperature: 1 } };
    expect(applyMinOutputFloor(body, "gemini", 8000)).toBe(1);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 8000, temperature: 1 });
    expect(applyMinOutputFloor(body, "vertex", 16000)).toBe(1);
    expect(body.generationConfig.maxOutputTokens).toBe(16000);
  });

  it("raises ollama num_predict", () => {
    const body = { options: { num_predict: 50 } };
    expect(applyMinOutputFloor(body, "ollama", 8000)).toBe(1);
    expect(body.options.num_predict).toBe(8000);
  });

  it("leaves absent, zero, non-number, and at-or-above values untouched", () => {
    const body = { max_tokens: 8000 };
    expect(applyMinOutputFloor(body, "openai", 8000)).toBe(0);
    expect(body.max_tokens).toBe(8000);

    const absent = {};
    expect(applyMinOutputFloor(absent, "openai", 8000)).toBe(0);
    expect(absent).toEqual({});

    const zero = { max_tokens: 0 };
    expect(applyMinOutputFloor(zero, "openai", 8000)).toBe(0);

    const stringy = { max_tokens: "100" };
    expect(applyMinOutputFloor(stringy, "openai", 8000)).toBe(0);
  });

  it("is a no-op for unknown formats and invalid floors", () => {
    const body = { max_tokens: 100 };
    expect(applyMinOutputFloor(body, "kiro", 8000)).toBe(0);
    expect(applyMinOutputFloor(body, "codex", 8000)).toBe(0);
    expect(applyMinOutputFloor(body, "cursor", 8000)).toBe(0);
    expect(applyMinOutputFloor(body, "openai", 0)).toBe(0);
    expect(applyMinOutputFloor(body, "openai", NaN)).toBe(0);
    expect(body.max_tokens).toBe(100);
  });
});

describe("catalog resolution carries minOutput", () => {
  it("resolves through a user rule and loses to a higher-specificity rule", () => {
    const resolver = createCatalogResolver({
      userRules: [
        { provider: "*", pattern: "*spark*", data: { capabilities: { minOutput: 8000 } } },
        { provider: "acme", pattern: "spark-exact", data: { capabilities: { minOutput: 12000 } } },
      ],
    });
    expect(resolver.getCapabilities("acme", "other-spark").minOutput).toBe(8000);
    expect(resolver.getCapabilities("acme", "spark-exact").minOutput).toBe(12000);
  });
});

describe("handleChatCore — minOutput floor reaches the executor", () => {
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

  function installFloor(minOutput, maxOutput) {
    setCatalogSource(createCatalogResolver({
      userRules: [{
        provider: "acme",
        pattern: "spark-*",
        data: { capabilities: { minOutput, ...(maxOutput ? { maxOutput } : {}) } },
      }],
    }));
  }

  async function runChat(body) {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await handleChatCore({
      body: { model: "spark-1", stream: false, messages: [{ role: "user", content: "hi" }], ...body },
      modelInfo: { provider: "acme", model: "spark-1" },
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

  it("raises a small client cap to the catalog floor", async () => {
    installFloor(8000);
    const { log, executedBody } = await runChat({ max_tokens: 100 });
    expect(executedBody.max_tokens).toBe(8000);
    expect(log.debug).toHaveBeenCalledWith("MINOUT", expect.stringContaining("8000"));
  });

  it("leaves a cap at or above the floor untouched", async () => {
    installFloor(8000);
    const { executedBody } = await runChat({ max_tokens: 16000 });
    expect(executedBody.max_tokens).toBe(16000);
  });

  it("leaves an absent cap absent", async () => {
    installFloor(8000);
    const { executedBody } = await runChat({});
    expect(executedBody.max_tokens).toBeUndefined();
  });

  it("does nothing without a catalog rule", async () => {
    const { executedBody } = await runChat({ max_tokens: 100 });
    expect(executedBody.max_tokens).toBe(100);
  });

  it("clamps the floor to the model's output ceiling", async () => {
    installFloor(200000, 4096);
    const { executedBody } = await runChat({ max_tokens: 100 });
    expect(executedBody.max_tokens).toBe(4096);
  });
});
