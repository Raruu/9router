// Context-fit routing for combos: when enabled, a combo floats members whose
// context window can hold the request (estimate + headroom) above the rest of
// their capability tier, so a >200K prompt starts on a 1M member instead of
// wasting an upstream 400 on a 200K one. Non-fitting members stay as last
// resort. With the setting off (default), order is byte-identical to before.
import { describe, it, expect, vi } from "vitest";
import { estimateRequestTokens, contextFitBudget, CONTEXT_FIT_HEADROOM } from "../../open-sse/utils/tokenEstimate.js";
import { reorderByCapabilities, handleComboChat } from "../../open-sse/services/combo.js";
import { mergeWithDefaults } from "../../src/lib/db/repos/settingsRepo.js";

const silentLog = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// A body whose estimated size lands between 200K and 1M tokens: 400K ASCII
// chars ≈ 100K tokens... so use 1.2M chars ≈ 300K tokens to exceed the 200K
// window (with 15% headroom the need is ~345K) while staying under 1M.
const bigBody = () => ({ messages: [{ role: "user", content: "a".repeat(1_200_000) }] });
const smallBody = () => ({ messages: [{ role: "user", content: "hello" }] });

describe("estimateRequestTokens", () => {
  it("counts ASCII at ~4 chars/token", () => {
    const tokens = estimateRequestTokens({ messages: [{ role: "user", content: "a".repeat(4000) }] });
    // JSON envelope adds a few dozen chars; ~1000 tokens + envelope.
    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(1120);
  });

  it("counts CJK codepoints as one token each", () => {
    const ascii = estimateRequestTokens({ messages: [{ role: "user", content: "a".repeat(4000) }] });
    const cjk = estimateRequestTokens({ messages: [{ role: "user", content: "中".repeat(4000) }] });
    expect(cjk).toBeGreaterThan(ascii * 3);
  });

  it("returns 0 for unusable input", () => {
    expect(estimateRequestTokens(null)).toBe(0);
    expect(estimateRequestTokens("nope")).toBe(0);
    expect(estimateRequestTokens({})).toBeGreaterThan(0); // "{}" is still a body
  });

  it("collapses base64 data URIs so a big image doesn't count as text", () => {
    const image = "data:image/png;base64," + "A".repeat(400_000);
    const withImage = estimateRequestTokens({ messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: image } },
    ] }] });
    const withoutImage = estimateRequestTokens({ messages: [{ role: "user", content: [] }] });
    // 400KB of base64 must not become ~100K tokens; both land in the same tiny range.
    expect(withImage).toBeLessThan(200);
    expect(Math.abs(withImage - withoutImage)).toBeLessThan(100);
  });

  it("applies the shared headroom formula", () => {
    expect(CONTEXT_FIT_HEADROOM).toBe(0.15);
    expect(contextFitBudget(100000)).toBe(115000);
  });
});

describe("reorderByCapabilities with fits", () => {
  it("floats fitting members within a tier, keeping non-fitting as last resort", () => {
    const models = ["p/small", "p/big", "p/medium"];
    const fits = (m) => m !== "p/small";
    // No required caps -> one tier; fit order must be stable for the fitting ones.
    expect(reorderByCapabilities(models, new Set(), fits)).toEqual(["p/big", "p/medium", "p/small"]);
  });

  it("keeps capability tiers dominant over fit", () => {
    // p/vision has vision but a tiny window; p/plain has a huge window. A
    // vision request must still try the vision member first.
    const models = ["p/plain", "p/vision"];
    const required = new Set(["vision"]);
    const fits = (m) => m === "p/plain";
    const out = reorderByCapabilities(models, required, fits);
    // tier 0 (vision + fit? plain is tier 2) — vision member keeps the front.
    expect(out[0]).toBe("p/vision");
  });

  it("treats a throwing predicate as fitting (never reorders on error)", () => {
    const models = ["p/a", "p/b"];
    const fits = () => { throw new Error("boom"); };
    expect(reorderByCapabilities(models, new Set(), fits)).toEqual(models);
  });

  it("with no fits predicate, order matches the legacy behavior", () => {
    const models = ["p/a", "p/b"];
    expect(reorderByCapabilities(models, new Set())).toBe(models);
  });
});

describe("handleComboChat context-fit", () => {
  it("starts on the fitting member when the request exceeds the first window", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: bigBody(),
      models: ["p/small-200k", "p/big-1m"],
      handleSingleModel: async (b, m) => { calls.push(m); return okResponse(); },
      log: silentLog,
      comboName: "ctx-fit-on",
      contextFit: true,
      resolveMemberContext: (m) => (m === "p/small-200k" ? 200000 : 1000000),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p/big-1m"]);
  });

  it("keeps the configured order when the request fits the first member", async () => {
    const calls = [];
    await handleComboChat({
      body: smallBody(),
      models: ["p/small-200k", "p/big-1m"],
      handleSingleModel: async (b, m) => { calls.push(m); return okResponse(); },
      log: silentLog,
      comboName: "ctx-fit-small",
      contextFit: true,
      resolveMemberContext: (m) => (m === "p/small-200k" ? 200000 : 1000000),
    });
    expect(calls).toEqual(["p/small-200k"]);
  });

  it("keeps a non-fitting member as last resort (never drops it)", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: bigBody(),
      models: ["p/small-200k", "p/big-1m"],
      handleSingleModel: async (b, m) => {
        calls.push(m);
        return m === "p/big-1m"
          ? new Response(JSON.stringify({ error: { message: "upstream down" } }), { status: 500, headers: { "Content-Type": "application/json" } })
          : okResponse();
      },
      log: silentLog,
      comboName: "ctx-fit-last-resort",
      contextFit: true,
      resolveMemberContext: (m) => (m === "p/small-200k" ? 200000 : 1000000),
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["p/big-1m", "p/small-200k"]);
  });

  it("unknown members (window 0) count as fitting and keep position", async () => {
    const calls = [];
    await handleComboChat({
      body: bigBody(),
      models: ["p/unknown", "p/small-200k"],
      handleSingleModel: async (b, m) => { calls.push(m); return okResponse(); },
      log: silentLog,
      comboName: "ctx-fit-unknown",
      contextFit: true,
      resolveMemberContext: (m) => (m === "p/small-200k" ? 200000 : 0),
    });
    expect(calls).toEqual(["p/unknown"]);
  });

  it("is a no-op when contextFit is off (default)", async () => {
    const calls = [];
    await handleComboChat({
      body: bigBody(),
      models: ["p/small-200k", "p/big-1m"],
      handleSingleModel: async (b, m) => { calls.push(m); return okResponse(); },
      log: silentLog,
      comboName: "ctx-fit-off",
      // no contextFit / resolveMemberContext -> legacy order
    });
    expect(calls).toEqual(["p/small-200k"]);
  });
});

describe("comboContextFit setting default", () => {
  it("mergeWithDefaults supplies false so stored settings without the key keep the old order", () => {
    expect(mergeWithDefaults({}).comboContextFit).toBe(false);
    expect(mergeWithDefaults({ comboContextFit: true }).comboContextFit).toBe(true);
  });
});
