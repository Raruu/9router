import { describe, expect, it } from "vitest";
import { LOG_CATEGORIES } from "../../src/app/(dashboard)/dashboard/console-log/logCategories.js";

function match(id, line) {
  return LOG_CATEGORIES.find((category) => category.id === id).match(line);
}

describe("console log categories", () => {
  it("defines only the approved tabs", () => {
    expect(LOG_CATEGORIES.map((category) => category.id)).toEqual(["all", "requests", "refresh", "errors"]);
  });

  it("matches request lifecycle lines", () => {
    expect(match("requests", "[12:00:01] 📥 POST /v1/chat/completions | openai/gpt")).toBe(true);
    expect(match("requests", "[12:00:02] ▶ POST gpt → openai/gpt · FMT: openai→openai")).toBe(true);
    expect(match("requests", "[12:00:03] 📊 DONE openai/gpt · 200 · 120ms")).toBe(true);
    expect(match("requests", "[12:00:04] 🌊 [STREAM] started")).toBe(true);
    expect(match("requests", "[DB] Driver: node:sqlite | file: data.sqlite")).toBe(false);
  });

  it("matches token refresh lines independently from requests", () => {
    expect(match("refresh", "[12:00:01] ℹ️ [TOKEN_REFRESH] Successfully refreshed token for openai")).toBe(true);
    expect(match("refresh", "[12:00:02] ℹ️ [BG_TOKEN_REFRESH] Connection refresh finished")).toBe(true);
    expect(match("refresh", "[12:00:03] 🔑 TOKEN REFRESHED · openai/gpt")).toBe(true);
    expect(match("refresh", "[12:00:04] refreshing provider credentials proactively")).toBe(true);
    expect(match("requests", "[12:00:03] 🔑 TOKEN REFRESHED · openai/gpt")).toBe(false);
  });

  it("treats errors as cross-cutting so one line can match requests and errors", () => {
    const line = "[12:00:01] ✗ ERROR 502 · openai/gpt · 120ms";
    expect(match("requests", line)).toBe(true);
    expect(match("errors", line)).toBe(true);
    expect(match("errors", "Refreshing token failed for oauth provider")).toBe(true);
    expect(match("errors", "[12:00:02] 📊 DONE openai/gpt · 200 · 120ms")).toBe(false);
  });

  it("keeps subsystem errors out of Requests but visible in refresh/errors", () => {
    const tokenFailures = [
      '[12:00:01] ❌ [TOKEN_REFRESH] Failed to refresh token for codex {"status":401}',
      "[12:00:02] ❌ [TOKEN] Gemini CLI refresh error: Token has been expired or revoked.",
      "[12:00:03] ⚠️  [TOKEN_REFRESH] No refresh token available for provider: xai",
      "[12:00:04] ❌ [AUTH] No credentials for provider: codex",
      "[12:00:05] 🌐 DNS bash: ❌ inactive",
    ];
    for (const line of tokenFailures) {
      expect(match("requests", line), line).toBe(false);
      expect(match("errors", line), line).toBe(true);
    }
    // Token-refresh lines still land in their own tab.
    expect(match("refresh", tokenFailures[0])).toBe(true);
    expect(match("refresh", tokenFailures[1])).toBe(true);
  });

  it("keeps the request-scoped account-lock line in Requests", () => {
    const line = '[12:00:01] ❌ Codex [401]: {"error":{"message":"token invalidated"}}';
    expect(match("requests", line)).toBe(true);
    expect(match("errors", line)).toBe(true);
  });

  it("keeps everything under All while unrelated lines match nothing else", () => {
    const line = "[DB] Driver: node:sqlite | file: data.sqlite";
    expect(match("all", line)).toBe(true);
    expect(match("requests", line)).toBe(false);
    expect(match("refresh", line)).toBe(false);
    expect(match("errors", line)).toBe(false);
  });
});
