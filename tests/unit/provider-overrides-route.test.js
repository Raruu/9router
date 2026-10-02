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
});
