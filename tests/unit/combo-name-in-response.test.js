// Combo name echo: when comboNameInResponse is on, the client-facing `model`
// reports the requested combo instead of the member that served it.
import { describe, it, expect } from "vitest";
import { applyResponseModelOverride } from "open-sse/utils/responseModel.js";

const COMBO = "qwen-3.8";
const MEMBER = "qwen3.8-flash-free";

describe("applyResponseModelOverride — response shapes", () => {
  it("OpenAI chat.completion: rewrites model", () => {
    const body = {
      id: "chatcmpl-d237928f",
      object: "chat.completion",
      model: MEMBER,
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    };
    applyResponseModelOverride(body, COMBO);
    expect(body.model).toBe(COMBO);
    // Everything else untouched
    expect(body.id).toBe("chatcmpl-d237928f");
    expect(body.choices[0].message.content).toBe("hi");
  });

  it("OpenAI chat.completion.chunk: rewrites model", () => {
    const chunk = { object: "chat.completion.chunk", model: MEMBER, choices: [{ delta: { content: "x" } }] };
    applyResponseModelOverride(chunk, COMBO);
    expect(chunk.model).toBe(COMBO);
  });

  it("Claude message: rewrites model", () => {
    const body = { type: "message", role: "assistant", model: MEMBER, content: [{ type: "text", text: "hi" }] };
    applyResponseModelOverride(body, COMBO);
    expect(body.model).toBe(COMBO);
  });

  it("Claude message_start: rewrites the nested message.model", () => {
    const frame = { type: "message_start", message: { type: "message", model: MEMBER, content: [] } };
    applyResponseModelOverride(frame, COMBO);
    expect(frame.message.model).toBe(COMBO);
  });

  it("Gemini top-level: rewrites modelVersion", () => {
    const body = { candidates: [], modelVersion: MEMBER, responseId: "resp_1" };
    applyResponseModelOverride(body, COMBO);
    expect(body.modelVersion).toBe(COMBO);
  });

  it("Gemini wrapped: rewrites response.modelVersion", () => {
    const body = { response: { candidates: [], modelVersion: MEMBER, responseId: "resp_1" } };
    applyResponseModelOverride(body, COMBO);
    expect(body.response.modelVersion).toBe(COMBO);
  });

  it("OpenAI Responses: rewrites model when present", () => {
    const body = { object: "response", status: "completed", model: MEMBER, output: [] };
    applyResponseModelOverride(body, COMBO);
    expect(body.model).toBe(COMBO);
  });
});

describe("applyResponseModelOverride — never adds a field", () => {
  it("shape without any model field is left alone", () => {
    // The Responses SSE→JSON path (sseToJsonHandler) returns exactly this shape.
    const body = { id: "resp_1", object: "response", status: "completed", output: [], usage: {} };
    applyResponseModelOverride(body, COMBO);
    expect("model" in body).toBe(false);
    expect("modelVersion" in body).toBe(false);
  });

  it("nested response without modelVersion is left alone", () => {
    const body = { response: { candidates: [] } };
    applyResponseModelOverride(body, COMBO);
    expect("modelVersion" in body.response).toBe(false);
  });

  it("nested message without model is left alone", () => {
    const frame = { type: "message_start", message: { type: "message", content: [] } };
    applyResponseModelOverride(frame, COMBO);
    expect("model" in frame.message).toBe(false);
  });

  it("non-string model (null) is not overwritten", () => {
    const body = { model: null };
    applyResponseModelOverride(body, COMBO);
    expect(body.model).toBeNull();
  });
});

describe("applyResponseModelOverride — no-op cases", () => {
  it("null override leaves the member in place", () => {
    const body = { model: MEMBER };
    applyResponseModelOverride(body, null);
    expect(body.model).toBe(MEMBER);
  });

  it("empty-string override leaves the member in place", () => {
    const body = { model: MEMBER };
    applyResponseModelOverride(body, "");
    expect(body.model).toBe(MEMBER);
  });

  it("tolerates null/undefined/non-object payloads", () => {
    expect(applyResponseModelOverride(null, COMBO)).toBeNull();
    expect(applyResponseModelOverride(undefined, COMBO)).toBeUndefined();
    expect(applyResponseModelOverride("str", COMBO)).toBe("str");
  });

  it("returns the same object reference (mutates in place)", () => {
    const body = { model: MEMBER };
    expect(applyResponseModelOverride(body, COMBO)).toBe(body);
  });
});

describe("comboNameInResponse setting default", () => {
  it("defaults to false so existing API consumers are unaffected", async () => {
    const { mergeWithDefaults } = await import("@/lib/db/repos/settingsRepo.js");
    expect(mergeWithDefaults({}).comboNameInResponse).toBe(false);
  });
});
