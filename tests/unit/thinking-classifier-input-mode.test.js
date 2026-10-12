// Thinking Effort Classifier — input selection modes. The extractor defaults to
// `latest-turn` (the newest turn, tool results included); `last-user` keeps the
// original single-user-message behavior; `tail-window` reads the last N turns.
import { describe, it, expect } from "vitest";

import {
  collectTurns,
  extractPromptText,
} from "../../src/sse/services/thinkingClassifier.js";

const lastUser = (body) => extractPromptText(body, { mode: "last-user" });
const latestTurn = (body) => extractPromptText(body, { mode: "latest-turn" });
const tailWindow = (body, opts = {}) => extractPromptText(body, { mode: "tail-window", ...opts });

describe("default mode is latest-turn", () => {
  it("reads the newest turn when no mode is given", () => {
    const body = { messages: [
      { role: "user", content: "the original prompt" },
      { role: "assistant", content: "a newer assistant turn" },
    ] };
    expect(extractPromptText(body)).toBe("a newer assistant turn");
    expect(extractPromptText(body, {})).toBe("a newer assistant turn");
  });

  it("is a no-op difference on a single user message", () => {
    const body = { messages: [{ role: "user", content: "only" }] };
    expect(extractPromptText(body)).toBe("only");
  });
});

describe("last-user mode (original single-message behavior)", () => {
  it("skips assistant and tool turns to find the newest user message", () => {
    expect(lastUser({ messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "last" },
      { role: "assistant", tool_calls: [{ id: "t1" }] },
      { role: "tool", tool_call_id: "t1", content: "tool output" },
    ] })).toBe("last");
  });

  it("ignores a trailing tool result even when it is the newest turn", () => {
    expect(lastUser({ messages: [
      { role: "user", content: "do the thing" },
      { role: "assistant", tool_calls: [{ id: "t1" }] },
      { role: "tool", tool_call_id: "t1", content: "hard output" },
    ] })).toBe("do the thing");
  });

  it("reads Claude text blocks and skips a tool_result-only user turn", () => {
    expect(lastUser({ messages: [
      { role: "user", content: "goal" },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
    ] })).toBe("goal");
  });

  it("returns empty when there is no user text", () => {
    expect(lastUser({ messages: [{ role: "assistant", content: "hi" }] })).toBe("");
    expect(lastUser({})).toBe("");
  });
});

describe("latest-turn mode (any role, tool results included)", () => {
  it("takes a trailing OpenAI tool result", () => {
    expect(latestTurn({ messages: [
      { role: "user", content: "do the thing" },
      { role: "assistant", tool_calls: [{ id: "t1" }] },
      { role: "tool", tool_call_id: "t1", content: "hard output" },
    ] })).toBe("hard output");
  });

  it("falls back to the newest assistant text when the last turn has none", () => {
    expect(latestTurn({ messages: [
      { role: "user", content: "goal" },
      { role: "assistant", content: "thinking out loud" },
    ] })).toBe("thinking out loud");
  });

  it("reads a Claude tool_result block inside a user turn", () => {
    expect(latestTurn({ messages: [
      { role: "user", content: "goal" },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "claude tool output" }] },
    ] })).toBe("claude tool output");
  });

  it("reads a Responses function_call_output", () => {
    expect(latestTurn({ input: [
      { role: "user", content: [{ type: "input_text", text: "goal" }] },
      { type: "function_call_output", call_id: "c1", output: "responses tool output" },
    ] })).toBe("responses tool output");
  });

  it("reads a Gemini functionResponse part", () => {
    const body = { contents: [
      { role: "user", parts: [{ text: "goal" }] },
      { role: "model", parts: [{ functionResponse: { name: "f", response: { value: 42 } } }] },
    ] };
    expect(latestTurn(body)).toBe(JSON.stringify({ value: 42 }));
  });
});

describe("tail-window mode (last N turns, bounded by chars)", () => {
  const conversation = { messages: [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    { role: "user", content: "three" },
    { role: "assistant", content: "four" },
  ] };

  it("joins the newest turns oldest-to-newest", () => {
    expect(tailWindow(conversation, { tailTurns: 2 })).toBe("three\nfour");
  });

  it("includes every turn when the count exceeds the conversation", () => {
    expect(tailWindow(conversation, { tailTurns: 10 })).toBe("one\ntwo\nthree\nfour");
  });

  it("keeps the newest characters when the char budget is small", () => {
    const long = "x".repeat(300);
    const body = { messages: [
      { role: "user", content: long },
      { role: "user", content: "the newest tail" },
    ] };
    const result = tailWindow(body, { tailTurns: 2, tailChars: 200 });
    // The joined text (300 + newline + 15) is front-truncated to the 200 budget,
    // so the newest turn survives whole.
    expect(result.length).toBe(200);
    expect(result.endsWith("the newest tail")).toBe(true);
  });

  it("includes tool results as turns", () => {
    const body = { messages: [
      { role: "user", content: "goal" },
      { role: "assistant", tool_calls: [{ id: "t1" }] },
      { role: "tool", tool_call_id: "t1", content: "tool output" },
    ] };
    expect(tailWindow(body, { tailTurns: 3 })).toBe("goal\ntool output");
  });

  it("applies the default budget when options are omitted", () => {
    expect(tailWindow({ messages: [{ role: "user", content: "solo" }] })).toBe("solo");
  });
});

describe("collectTurns — Gemini role awareness", () => {
  it("labels a model turn assistant and a user turn user", () => {
    const turns = collectTurns({ contents: [
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ text: "a" }] },
    ] });
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("treats a missing role as a user turn", () => {
    const turns = collectTurns({ contents: [{ parts: [{ text: "q" }] }] });
    expect(turns[0].role).toBe("user");
  });

  it("does not classify a trailing model turn in last-user mode", () => {
    // The old role-agnostic scan would have returned the model text here.
    const body = { contents: [
      { role: "user", parts: [{ text: "the real prompt" }] },
      { role: "model", parts: [{ text: "a trailing model answer" }] },
    ] };
    expect(lastUser(body)).toBe("the real prompt");
    expect(latestTurn(body)).toBe("a trailing model answer");
  });

  it("drops system and developer turns from the OpenAI shape", () => {
    const turns = collectTurns({ messages: [
      { role: "system", content: "rules" },
      { role: "developer", content: "more rules" },
      { role: "user", content: "q" },
    ] });
    expect(turns.map((t) => t.role)).toEqual(["user"]);
  });
});
