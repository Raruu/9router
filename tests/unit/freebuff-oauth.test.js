/**
 * Unit tests for the Freebuff/Codebuff device-code OAuth module.
 *
 * Covers the handshake that turns a browser authorization into a Codebuff
 * auth token: code request (free vs paid host), pending polling, token
 * mapping, and error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import freebuff from "../../src/lib/oauth/providers/freebuff.js";
import { FREEBUFF_CONFIG } from "../../src/lib/oauth/constants/oauth.js";

const fetchMock = vi.fn();

function fetchResponse(data, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(data);
  return { ok, status, json: async () => data, text: async () => text };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("freebuff.requestDeviceCode", () => {
  it("requests a fingerprint from the free host and returns a device code", async () => {
    const expiresAt = Date.now() + 300_000;
    fetchMock.mockResolvedValueOnce(
      fetchResponse({ loginUrl: "https://freebuff.com/cli?fp=x", fingerprintHash: "hash-1", expiresAt })
    );

    const out = await freebuff.requestDeviceCode(FREEBUFF_CONFIG, undefined, { authMethod: "freebuff" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(FREEBUFF_CONFIG.freeCodeUrl);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).fingerprintId).toMatch(/^fb-[0-9a-f]{16}$/);

    expect(out.verification_uri).toBe("https://freebuff.com/cli?fp=x");
    expect(out.user_code).toBe("Freebuff CLI Authorization");
    expect(out.interval).toBe(2);
    expect(out.expires_in).toBeGreaterThan(0);
    expect(JSON.parse(out.device_code)).toMatchObject({
      fingerprintHash: "hash-1",
      authMethod: "freebuff",
      expiresAt,
    });
  });

  it("uses the codebuff.com host for paid Codebuff mode", async () => {
    fetchMock.mockResolvedValueOnce(
      fetchResponse({ loginUrl: "https://codebuff.com/cli", fingerprintHash: "hash-2", expiresAt: Date.now() + 1000 })
    );

    const out = await freebuff.requestDeviceCode(FREEBUFF_CONFIG, undefined, { authMethod: "codebuff" });

    expect(fetchMock.mock.calls[0][0]).toBe(FREEBUFF_CONFIG.paidCodeUrl);
    expect(out.user_code).toBe("Codebuff CLI Authorization");
    expect(JSON.parse(out.device_code).authMethod).toBe("codebuff");
  });

  it("throws when the code request fails", async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: "boom" }, { ok: false, status: 500 }));
    await expect(
      freebuff.requestDeviceCode(FREEBUFF_CONFIG, undefined, { authMethod: "freebuff" })
    ).rejects.toThrow(/code request failed/);
  });
});

describe("freebuff.pollToken", () => {
  const deviceCode = JSON.stringify({
    fingerprintId: "fb-0123456789abcdef",
    fingerprintHash: "hash-1",
    expiresAt: 123456789,
    authMethod: "freebuff",
  });

  it("treats a 401 as authorization_pending", async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({}, { ok: false, status: 401 }));
    const result = await freebuff.pollToken(FREEBUFF_CONFIG, deviceCode);
    expect(result).toEqual({ ok: true, data: { error: "authorization_pending" } });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(FREEBUFF_CONFIG.freeStatusUrl);
    expect(url.searchParams.get("fingerprintId")).toBe("fb-0123456789abcdef");
    expect(url.searchParams.get("fingerprintHash")).toBe("hash-1");
  });

  it("returns the auth token when the user has authorized", async () => {
    fetchMock.mockResolvedValueOnce(
      fetchResponse({
        user: { authToken: "cb-token-1", email: "dev@example.com", id: "u1", name: "Dev" },
      })
    );
    const result = await freebuff.pollToken(FREEBUFF_CONFIG, deviceCode);
    expect(result.ok).toBe(true);
    expect(result.data.access_token).toBe("cb-token-1");

    const tokens = freebuff.mapTokens(result.data);
    expect(tokens.accessToken).toBe("cb-token-1");
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.email).toBe("dev@example.com");
    expect(tokens.providerSpecificData).toEqual({
      userId: "u1",
      userName: "Dev",
      authMethod: "freebuff",
    });
  });

  it("keeps polling while no user is attached yet", async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({}));
    const result = await freebuff.pollToken(FREEBUFF_CONFIG, deviceCode);
    expect(result).toEqual({ ok: true, data: { error: "authorization_pending" } });
  });

  it("rejects a malformed device code without calling upstream", async () => {
    const result = await freebuff.pollToken(FREEBUFF_CONFIG, "not-json");
    expect(result.ok).toBe(false);
    expect(result.data.error).toBe("invalid_grant");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports non-401 failures", async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({}, { ok: false, status: 500 }));
    const result = await freebuff.pollToken(FREEBUFF_CONFIG, deviceCode);
    expect(result.ok).toBe(false);
    expect(result.data.error).toBe("poll_failed");
  });
});
