// Per-provider header overrides — /api/providers/[id]/overrides.
//
// Custom provider nodes (openai-compatible-chat-<uuid>) have no registry
// headers, so the dashboard's CustomConfigCard is rendered unconditionally for
// them (alwaysVisible). These tests pin the server half: the id is kept as the
// canonical key (so chat.js's providerOverrides[provider] lookup hits), the
// trust-boundary validation holds, and an empty payload deletes the override.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = { settings: { providerOverrides: {} } };
  return {
    state,
    getSettings: vi.fn(async () => state.settings),
    updateSettings: vi.fn(async (updates) => {
      state.settings = { ...state.settings, ...updates };
      return state.settings;
    }),
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ status: init?.status || 200, body }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

const { GET, PUT } = await import("../../src/app/api/providers/[id]/overrides/route.js");

const req = (body) => ({ json: async () => body });
const params = (id) => Promise.resolve({ id });

beforeEach(() => {
  mocks.state.settings = { providerOverrides: {} };
  mocks.updateSettings.mockClear();
});

describe("provider overrides route", () => {
  it("round-trips a custom node id without alias mangling", async () => {
    const nodeId = "openai-compatible-chat-88e8";
    const put = await PUT(req({ headers: { "X-Custom-Auth": "secret" } }), { params: params(nodeId) });

    expect(put.status).toBe(200);
    expect(mocks.state.settings.providerOverrides).toEqual({ [nodeId]: { headers: { "X-Custom-Auth": "secret" } } });

    const get = await GET(null, { params: params(nodeId) });
    expect(get.body.headers).toEqual({ "X-Custom-Auth": "secret" });
    // Custom nodes are not in the registry, so no builtin headers are advertised.
    expect(get.body.builtinHeaders).toEqual({});
  });

  it("resolves registry aliases to the canonical provider id", async () => {
    await PUT(req({ headers: { "X-Test": "1" } }), { params: params("gcli") });
    expect(Object.keys(mocks.state.settings.providerOverrides)).toEqual(["grok-cli"]);
  });

  it("rejects blocked and malformed headers at the trust boundary", async () => {
    const blocked = await PUT(req({ headers: { authorization: "Bearer x" } }), { params: params("openai-compatible-chat-1") });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/cannot be overridden/i);

    const badName = await PUT(req({ headers: { "Bad Header": "x" } }), { params: params("openai-compatible-chat-1") });
    expect(badName.status).toBe(400);

    const injection = await PUT(req({ headers: { "X-Test": "a\r\nX-Evil: b" } }), { params: params("openai-compatible-chat-1") });
    expect(injection.status).toBe(400);

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("deletes the override when the payload has no headers", async () => {
    const nodeId = "openai-compatible-chat-88e8";
    await PUT(req({ headers: { "X-Test": "1" } }), { params: params(nodeId) });
    await PUT(req({ headers: {} }), { params: params(nodeId) });
    expect(mocks.state.settings.providerOverrides).toEqual({});
  });

  it("pre-fills registry builtin headers for a standard provider", async () => {
    const get = await GET(null, { params: params("claude") });
    expect(Object.keys(get.body.builtinHeaders).length).toBeGreaterThan(0);
    expect(get.body.headers).toEqual({});
  });

  // The card is the only place a user can see what a provider sends, so it has
  // to show the post-hook values. Reading PROVIDERS[id].headers directly showed
  // codebuddy's pre-hook IDE/CLI attribution while the request path rewrote it
  // to WorkBuddy, and offered rows that could never take effect.
  describe("builtin headers are the ones actually sent", () => {
    it("reflects the codebuddy WorkBuddy rewrite instead of the registry value", async () => {
      const intl = await GET(null, { params: params("codebuddy-intl") });
      expect(intl.body.builtinHeaders["User-Agent"]).toBe("WorkBuddy/5.9.3 workbuddy-ai/5.9.3 CLI/2.165.0");
      expect(intl.body.builtinHeaders["X-IDE-Type"]).toBe("WorkBuddy");
      expect(intl.body.builtinHeaders["X-IDE-Name"]).toBe("WorkBuddy");
      expect(intl.body.builtinHeaders["X-IDE-Version"]).toBe("5.9.3");
      expect(intl.body.builtinHeaders["X-Agent-Intent"]).toBe("craft");

      // CN differs only in the UA variant — the hook picks it from the registry
      // X-IDE-Type, which is still "CLI" there.
      const cn = await GET(null, { params: params("codebuddy-cn") });
      expect(cn.body.builtinHeaders["User-Agent"]).toBe("WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0");
      expect(cn.body.builtinHeaders["X-IDE-Type"]).toBe("WorkBuddy");
    });

    it("omits per-request headers so the card never shows a value that churns", async () => {
      const get = await GET(null, { params: params("codebuddy-intl") });
      const builtin = get.body.builtinHeaders;
      for (const volatile of [
        "X-Request-ID",
        "X-Root-Request-ID",
        "X-Conversation-ID",
        "X-Conversation-Request-ID",
        "X-Conversation-Message-ID",
      ]) {
        expect(builtin[volatile], `${volatile} must not be advertised as a default`).toBeUndefined();
      }
    });

    it("omits headers the override API refuses to accept", async () => {
      const get = await GET(null, { params: params("codebuddy-intl") });
      const builtin = get.body.builtinHeaders;
      for (const blocked of ["Content-Type", "Authorization", "Cookie", "Host"]) {
        expect(builtin[blocked]).toBeUndefined();
      }
      // Everything advertised must round-trip through PUT, otherwise the card
      // offers a row whose save is rejected with "cannot be overridden".
      for (const name of Object.keys(builtin)) {
        const res = await PUT(req({ headers: { [name]: "probe" } }), { params: params("codebuddy-intl") });
        expect(res.status, `${name} must be overridable`).toBe(200);
      }
    });

    it("keeps stable hook values and drops only the volatile ones", async () => {
      const get = await GET(null, { params: params("minimax-code") });
      const builtin = get.body.builtinHeaders;
      // Timezone offset is derived but stable across calls, so it is a real default.
      expect(builtin["X-Mavis-Timezone-Offset"]).toBeDefined();
      // Session id is regenerated per call.
      expect(builtin["X-Mavis-Session-Id"]).toBeUndefined();
    });
  });
});
