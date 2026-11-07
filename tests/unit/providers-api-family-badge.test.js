import { describe, expect, it } from "vitest";
import { apiFamilyBadge } from "@/app/(dashboard)/dashboard/providers/utils.js";

// The Providers page renders a small "OpenAI"/"Anthropic" pill at the top-right
// of an API-key provider card. It exists to tell custom compatible nodes apart
// (their family is user-chosen), so built-in providers must not get one.
describe("providers API-family badge", () => {
  it("returns null for built-in providers", () => {
    for (const id of ["openai", "groq", "anthropic", "gemini", "openrouter", "deepseek"]) {
      expect(apiFamilyBadge(id), id).toBeNull();
    }
  });

  it("labels custom compatible nodes by API family", () => {
    expect(apiFamilyBadge("openai-compatible-chat-abc")).toBe("openai");
    expect(apiFamilyBadge("anthropic-compatible-xyz")).toBe("anthropic");
  });

  it("does not misread an Anthropic node whose name contains 'openai'", () => {
    expect(apiFamilyBadge("anthropic-compatible-openai-1")).toBe("anthropic");
  });

  it("handles empty or missing ids", () => {
    expect(apiFamilyBadge(undefined)).toBeNull();
    expect(apiFamilyBadge("")).toBeNull();
  });
});
