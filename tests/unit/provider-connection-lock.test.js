// Manual per-connection lock/unlock — POST /api/providers/[id]/lock.
//
// The dashboard lock/unlock buttons hit this route. Locking is account-level:
// it writes modelLock___all so every model on the connection is skipped by
// getProviderCredentials, while the connection's accounts stay otherwise intact.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isModelLockActive } from "../../open-sse/services/accountFallback.js";

const mocks = vi.hoisted(() => {
  const state = { connection: null };
  return {
    state,
    getProviderConnectionById: vi.fn(async (id) => (state.connection?.id === id ? { ...state.connection } : null)),
    updateProviderConnection: vi.fn(async (id, patch) => {
      if (state.connection?.id !== id) return null;
      state.connection = { ...state.connection, ...patch };
      return state.connection;
    }),
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ status: init?.status || 200, body }),
  },
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

const { POST, MANUAL_LOCK_MIN_MS, MANUAL_LOCK_MAX_MS } = await import(
  "../../src/app/api/providers/[id]/lock/route.js"
);

const req = (body) => ({ json: async () => body });
const params = (id) => Promise.resolve({ id });

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  mocks.state.connection = {
    id: "conn-1",
    provider: "custom",
    authType: "apikey",
    name: "Key 1",
    testStatus: "active",
    lastError: "prior error",
    backoffLevel: 4,
    apiKey: "secret",
  };
  mocks.getProviderConnectionById.mockClear();
  mocks.updateProviderConnection.mockClear();
});

describe("connection lock route", () => {
  it("locks at the account level with the requested duration", async () => {
    const res = await POST(req({ action: "lock", durationMs: 2 * HOUR }), { params: params("conn-1") });

    expect(res.status).toBe(200);
    const written = mocks.state.connection;
    expect(written).toMatchObject({
      testStatus: "unavailable",
      lastError: "Manually locked",
      errorCode: 423,
    });
    // Account-level lock: active for a null model and therefore any model.
    expect(isModelLockActive(written, null)).toBe(true);
    expect(isModelLockActive(written, "some-model")).toBe(true);
    const until = new Date(written.modelLock___all).getTime();
    expect(until - Date.now()).toBeGreaterThan(2 * HOUR - 5000);
    // Secret is stripped from the response payload.
    expect(res.body.connection.apiKey).toBeUndefined();
  });

  it("unlocks by clearing every lock key and resetting health state", async () => {
    mocks.state.connection = {
      ...mocks.state.connection,
      modelLock___all: new Date(Date.now() + HOUR).toISOString(),
      modelLock_glm: new Date(Date.now() + HOUR).toISOString(),
      testStatus: "unavailable",
      lastError: "boom",
      errorCode: 429,
      backoffLevel: 7,
    };

    const res = await POST(req({ action: "unlock" }), { params: params("conn-1") });

    expect(res.status).toBe(200);
    const written = mocks.state.connection;
    expect(written.modelLock___all).toBeNull();
    expect(written.modelLock_glm).toBeNull();
    expect(written.testStatus).toBe("active");
    expect(written.lastError).toBeNull();
    expect(written.errorCode).toBeNull();
    expect(written.backoffLevel).toBe(0);
    expect(isModelLockActive(written, null)).toBe(false);
  });

  it("rejects malformed durations at the trust boundary", async () => {
    for (const durationMs of [undefined, 0, -1, 1.5, "soon", MANUAL_LOCK_MIN_MS - 1, MANUAL_LOCK_MAX_MS + 1]) {
      const res = await POST(req({ action: "lock", durationMs }), { params: params("conn-1") });
      expect(res.status).toBe(400);
    }
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects an invalid action and a missing connection", async () => {
    const badAction = await POST(req({ action: "nope" }), { params: params("conn-1") });
    expect(badAction.status).toBe(400);

    const missing = await POST(req({ action: "lock", durationMs: HOUR }), { params: params("ghost") });
    expect(missing.status).toBe(404);
  });
});