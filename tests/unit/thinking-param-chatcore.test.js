// End-to-end wiring: a custom OpenAI-compatible connection's thinkingParam must
// reach the executor body (and must not leave the generic `thinking` field).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
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
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const PROVIDER = "openai-compatible-chat-amd-cn";
const MODEL = "DeepSeek-V4.1-Flash";

beforeEach(() => {
  executeMock.mockReset();
  executeMock.mockResolvedValue({
    response: new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
    url: "https://developer.amd.com.cn/radeon/api/v1/chat/completions",
    headers: {},
  });
});

async function run(thinkingParam) {
  await handleChatCore({
    body: {
      model: `${PROVIDER}/${MODEL}`,
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 10000 },
      stream: false,
    },
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {
      apiKey: "sk-test",
      providerSpecificData: {
        baseUrl: "https://developer.amd.com.cn/radeon/api/v1",
        ...(thinkingParam ? { thinkingParam } : {}),
      },
    },
    clientRawRequest: { headers: {} },
    connectionId: "conn-test",
    sourceFormatOverride: "openai",
  });
  expect(executeMock).toHaveBeenCalledTimes(1);
  return executeMock.mock.calls[0][0].body;
}

describe("handleChatCore custom thinkingParam", () => {
  it("sends reasoning_effort only when the node opts in", async () => {
    const body = await run("reasoning_effort");
    expect(body.reasoning_effort).toBe("medium");
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("sends reasoning.effort only when the node opts in", async () => {
    const body = await run("reasoning.effort");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("leaves today's shape when the node has no setting", async () => {
    const body = await run(null);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
    expect(body.reasoning_effort).toBe("high");
  });
});
