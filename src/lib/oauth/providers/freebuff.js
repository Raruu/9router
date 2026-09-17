import crypto from "crypto";
import { FREEBUFF_CONFIG } from "../constants/oauth.js";

// Freebuff / Codebuff CLI device flow (ported from decolua/9router#1492).
// Upstream issues a fingerprint pair, the user authorizes in the browser, and
// the status endpoint returns the Codebuff auth token. The free tier uses
// freebuff.com; paid Codebuff subscriptions use codebuff.com.
const CLI_USER_AGENT = "Bun/1.3.11";
const PENDING_INTERVAL_SEC = 2;
const FALLBACK_TTL_MS = 300_000;

function resolveAuthMethod(value) {
  return value === "codebuff" ? "codebuff" : "freebuff";
}

function endpointsFor(config, authMethod) {
  return authMethod === "codebuff"
    ? { codeUrl: config.paidCodeUrl, statusUrl: config.paidStatusUrl }
    : { codeUrl: config.freeCodeUrl, statusUrl: config.freeStatusUrl };
}

const freebuff = {
  config: FREEBUFF_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config, _codeChallenge, options = {}) => {
    const authMethod = resolveAuthMethod(options.authMethod);
    const { codeUrl } = endpointsFor(config, authMethod);
    const fingerprintId = `fb-${crypto.randomBytes(8).toString("hex")}`;

    const response = await fetch(codeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": CLI_USER_AGENT,
      },
      body: JSON.stringify({ fingerprintId }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Freebuff/Codebuff code request failed: ${error}`);
    }

    const data = await response.json();
    const expiresAt = Number(data.expiresAt) || Date.now() + FALLBACK_TTL_MS;
    const expiresIn = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));

    return {
      device_code: JSON.stringify({
        fingerprintId,
        fingerprintHash: data.fingerprintHash,
        expiresAt,
        authMethod,
      }),
      user_code: authMethod === "codebuff" ? "Codebuff CLI Authorization" : "Freebuff CLI Authorization",
      verification_uri: data.loginUrl,
      verification_uri_complete: data.loginUrl,
      expires_in: expiresIn,
      interval: PENDING_INTERVAL_SEC,
    };
  },
  pollToken: async (config, deviceCode) => {
    let params;
    try {
      params = JSON.parse(deviceCode);
    } catch {
      return {
        ok: false,
        data: { error: "invalid_grant", error_description: "Malformed Freebuff device code" },
      };
    }

    const authMethod = resolveAuthMethod(params.authMethod);
    const { statusUrl } = endpointsFor(config, authMethod);
    const query = new URLSearchParams({
      fingerprintId: params.fingerprintId,
      fingerprintHash: params.fingerprintHash,
      expiresAt: String(params.expiresAt),
    });

    const response = await fetch(`${statusUrl}?${query.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": CLI_USER_AGENT },
    });
    if (response.status === 401) {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (!response.ok) {
      return {
        ok: false,
        data: {
          error: "poll_failed",
          error_description: `Freebuff status check failed (${response.status})`,
        },
      };
    }

    const data = await response.json();
    const user = data.user;
    if (!user?.authToken) {
      return { ok: true, data: { error: "authorization_pending" } };
    }

    return {
      ok: true,
      data: {
        access_token: user.authToken,
        _userEmail: user.email || null,
        _userId: user.id || null,
        _userName: user.name || null,
        _authMethod: authMethod,
      },
    };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: null,
    expiresIn: null,
    email: tokens._userEmail,
    providerSpecificData: {
      userId: tokens._userId,
      userName: tokens._userName,
      authMethod: tokens._authMethod || "freebuff",
    },
  }),
};

export default freebuff;
