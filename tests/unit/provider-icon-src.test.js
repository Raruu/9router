// Compatible-provider icon resolution in src/shared/utils/providerIcon.js.
// User-created nodes carry dynamic ids ("openai-compatible-chat-<uuid>") that
// have no /providers asset, so the resolver maps the prefixes to the shared
// generic icons. Must stay registry-free: ProviderIcon is used on the landing page.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getProviderIconSrc,
  getProviderIconSrcForId,
  markProviderIconMissing,
} from "@/shared/utils/providerIcon.js";

describe("getProviderIconSrcForId — compatible provider nodes", () => {
  it("maps openai-compatible chat ids to the chat-completions icon", () => {
    expect(getProviderIconSrcForId("openai-compatible-chat-5e8c6c25-3a4d-449e")).toBe("/providers/oai-cc.png");
    expect(getProviderIconSrcForId("openai-compatible-chat")).toBe("/providers/oai-cc.png");
  });

  it("maps openai-compatible responses ids to the responses icon", () => {
    expect(getProviderIconSrcForId("openai-compatible-responses-84efd95a")).toBe("/providers/oai-r.png");
    expect(getProviderIconSrcForId("openai-compatible-responses")).toBe("/providers/oai-r.png");
  });

  it("explicit apiType overrides the id-derived one", () => {
    expect(getProviderIconSrcForId("openai-compatible-chat-abc", "responses")).toBe("/providers/oai-r.png");
    expect(getProviderIconSrcForId("openai-compatible-responses-abc", "chat")).toBe("/providers/oai-cc.png");
  });

  it("unknown openai-compatible api type degrades to the chat icon", () => {
    expect(getProviderIconSrcForId("openai-compatible-weird-123")).toBe("/providers/oai-cc.png");
  });

  it("maps anthropic-compatible ids to the messages icon", () => {
    expect(getProviderIconSrcForId("anthropic-compatible-d01d3b9b")).toBe("/providers/anthropic-m.png");
    expect(getProviderIconSrcForId("anthropic-compatible")).toBe("/providers/anthropic-m.png");
  });

  it("leaves custom-embedding ids to the text fallback", () => {
    expect(getProviderIconSrcForId("custom-embedding-2705be3f")).toBe("/providers/custom-embedding-2705be3f.png");
  });

  it("delegates registry providers to the plain resolver", () => {
    expect(getProviderIconSrcForId("openai")).toBe(getProviderIconSrc("openai"));
    expect(getProviderIconSrcForId("kiro")).toBe("/providers/kiro.png");
  });

  it("handles null/undefined/non-string ids", () => {
    expect(getProviderIconSrcForId(null)).toBeNull();
    expect(getProviderIconSrcForId(undefined)).toBeNull();
    expect(getProviderIconSrcForId(42)).toBeNull();
  });

  it("explicit apiType alone cannot force a mapping for a non-compatible id", () => {
    expect(getProviderIconSrcForId("openai", "responses")).toBe(getProviderIconSrc("openai"));
  });
});

describe("session 404 cache interaction", () => {
  beforeEach(() => {
    // failedIds is module-scoped — fresh module per test.
    vi.resetModules();
  });

  it("a marked-missing generic file suppresses every compat id sharing it", async () => {
    const mod = await import("@/shared/utils/providerIcon.js");
    expect(mod.getProviderIconSrcForId("openai-compatible-chat-abc")).toBe("/providers/oai-cc.png");
    // ProviderIcon's onError marks the file id parsed from the src URL.
    mod.markProviderIconMissing("oai-cc");
    expect(mod.getProviderIconSrcForId("openai-compatible-chat-abc")).toBeNull();
    expect(mod.getProviderIconSrcForId("openai-compatible-chat-def")).toBeNull();
    // A different generic file is unaffected until it 404s too.
    expect(mod.getProviderIconSrcForId("openai-compatible-responses-abc")).toBe("/providers/oai-r.png");
  });

  it("markProviderIconMissing with the raw node id does not break the mapping", async () => {
    const mod = await import("@/shared/utils/providerIcon.js");
    mod.markProviderIconMissing("openai-compatible-chat-abc");
    expect(mod.getProviderIconSrcForId("openai-compatible-chat-abc")).toBe("/providers/oai-cc.png");
  });
});
