import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Freebuff/Codebuff proxy executor (ported from decolua/9router#1492, refreshed
// against OmniRoute's current request shape). Upstream is the Codebuff agent API:
//   1. POST /freebuff/session  -> lease a model-bound instance (queue aware)
//   2. POST /agent-runs        -> START a run per agent id (rotated every 6h)
//   3. POST /chat/completions  -> OpenAI-compatible SSE, needs the x-codebuff-* headers
// Sessions are cached per token and dropped when the requested model changes.
const SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";
const RUNS_URL = "https://www.codebuff.com/api/v1/agent-runs";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_AGENT_ID = "base2-free";
const SESSION_UA = "codebuff/0.1.0 (darwin-arm64)";
const CHAT_UA = "ai-sdk/openai-compatible/1.0.25/codebuff";
const SYSTEM_PROMPT = "You are Buffy, the strategic coding assistant.";
const CLIENT_ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
const CLIENT_ID_LENGTH = 13;
const RUN_ROTATION_MS = 6 * 60 * 60 * 1000;
const SESSION_EXPIRY_BUFFER_MS = 60 * 1000;
const SESSION_ERROR_MARKERS = [
  "freebuff_update_required",
  "waiting_room_required",
  "waiting_room_queued",
  "session_superseded",
  "session_expired",
  "session_model_mismatch",
];

const MODEL_TO_AGENT = {
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base2-free-deepseek",
  "openai/gpt-5.6-luna": "base2-free-luna",
  "minimax/minimax-m3": "base2-free-minimax-m3",
  "mimo/mimo-v2.5": "base2-free-mimo",
  "z-ai/glm-5.2": "base2-free-glm",
  "crof/kimi-k3-eco": "base2-free-kimi-k3-eco",
  "anthropic/claude-fable-5": "base2-free-fable",
  "meta/muse-spark-1.2-contributor": "base2-free-muse-spark",
};

// token -> { instanceId, model, expiresAt }
const sessionCache = new Map();
// token -> Map(agentId -> { runId, startedAt })
const runCache = new Map();

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function generateClientId() {
  let out = "";
  for (let i = 0; i < CLIENT_ID_LENGTH; i++) {
    out += CLIENT_ID_CHARS[Math.floor(Math.random() * CLIENT_ID_CHARS.length)];
  }
  return out;
}

async function deleteSession(token, proxyOptions) {
  try {
    await proxyAwareFetch(SESSION_URL, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "User-Agent": SESSION_UA },
    }, proxyOptions);
  } catch {
    // best effort: a stale upstream session is recovered by the marker retry
  }
}

async function getSession(token, model, proxyOptions) {
  const now = Date.now();
  const cached = sessionCache.get(token);
  const cacheValid =
    cached &&
    cached.model === model &&
    (!cached.expiresAt || new Date(cached.expiresAt).getTime() - now > SESSION_EXPIRY_BUFFER_MS);
  if (cacheValid) return cached.instanceId;

  if (cached) {
    sessionCache.delete(token);
    if (cached.model !== model) await deleteSession(token, proxyOptions);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": SESSION_UA,
  };
  if (model) headers["x-freebuff-model"] = model;

  let response;
  try {
    response = await proxyAwareFetch(SESSION_URL, { method: "POST", headers, body: "{}" }, proxyOptions);
  } catch (error) {
    const err = new Error(`Freebuff session network error: ${error.message}`);
    err.status = 502;
    throw err;
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const err = new Error(`Freebuff session failed (${response.status}): ${text.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Freebuff session returned a non-JSON response");
  }

  const status = String(data.status || "").trim();
  if (status === "disabled") {
    const err = new Error("Freebuff session is disabled");
    err.status = 403;
    throw err;
  }
  if (status === "queued") {
    const position = data.position || 1;
    const depth = data.queueDepth || position;
    const waitMs = data.estimatedWaitMs || 5000;
    const err = new Error(`Freebuff waiting room queued (position ${position}/${depth})`);
    err.status = 503;
    err.retryAfter = Math.max(1, Math.round(waitMs / 1000));
    throw err;
  }
  if (status !== "active" || !data.instanceId) {
    throw new Error(`Unexpected freebuff session status: ${status || "unknown"}`);
  }

  sessionCache.set(token, {
    instanceId: data.instanceId,
    model,
    expiresAt: data.expiresAt || null,
  });
  return data.instanceId;
}

async function getRun(token, agentId, proxyOptions, log) {
  let runs = runCache.get(token);
  if (!runs) {
    runs = new Map();
    runCache.set(token, runs);
  }
  const now = Date.now();
  const cached = runs.get(agentId);
  if (cached && now - cached.startedAt < RUN_ROTATION_MS) return cached.runId;

  try {
    const response = await proxyAwareFetch(RUNS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": SESSION_UA,
      },
      body: JSON.stringify({ action: "START", agentId }),
    }, proxyOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.runId) {
      log?.warn?.("FREEBUFF", `Agent run start failed (${response.status}); continuing without run id`);
      return "";
    }
    runs.set(agentId, { runId: data.runId, startedAt: now });
    return data.runId;
  } catch (error) {
    log?.warn?.("FREEBUFF", `Agent run start network error: ${error.message}; continuing without run id`);
    return "";
  }
}

function buildChatBody(body, model, { runId, instanceId, costMode, stream }) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
  const messages = Array.isArray(payload.messages)
    ? payload.messages.filter((m) => m && typeof m === "object" && !Array.isArray(m))
    : [];
  const first = messages[0];
  const hasBuffyPrompt =
    first?.role === "system" &&
    typeof first.content === "string" &&
    first.content.trimStart().startsWith("You are Buffy");
  if (!hasBuffyPrompt) messages.unshift({ role: "system", content: SYSTEM_PROMPT });

  const existing =
    payload.codebuff_metadata &&
    typeof payload.codebuff_metadata === "object" &&
    !Array.isArray(payload.codebuff_metadata)
      ? payload.codebuff_metadata
      : {};

  payload.model = model;
  payload.messages = messages;
  payload.stream = stream !== false;
  payload.codebuff_metadata = {
    ...existing,
    run_id: runId || "",
    cost_mode: costMode,
    client_id: generateClientId(),
    freebuff_instance_id: instanceId,
  };
  return payload;
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS.freebuff || {
      baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
      format: "openai",
      headers: { "User-Agent": CHAT_UA },
    });
  }

  buildHeaders(token) {
    return {
      ...this.config.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": CHAT_UA,
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const token = credentials?.accessToken || credentials?.apiKey || "";
    if (!token) {
      return {
        response: jsonResponse(401, {
          error: { message: "Freebuff Auth Token required", type: "authentication_error" },
        }),
      };
    }

    const requestedModel =
      typeof model === "string" && model ? model.replace(/^(freebuff|fb)\//, "") : DEFAULT_MODEL;
    const agentId = MODEL_TO_AGENT[requestedModel] || DEFAULT_AGENT_ID;

    let instanceId;
    try {
      instanceId = await getSession(token, requestedModel, proxyOptions);
    } catch (error) {
      sessionCache.delete(token);
      if (/model_locked/i.test(error.message || "")) {
        log?.info?.("FREEBUFF", "Session model locked upstream; deleting session and retrying");
        await deleteSession(token, proxyOptions);
        instanceId = await getSession(token, requestedModel, proxyOptions);
      } else if (error.status === 503) {
        return {
          response: jsonResponse(
            503,
            { error: { message: error.message, type: "waiting_room_queued" } },
            { "Retry-After": String(error.retryAfter || 5) }
          ),
        };
      } else {
        return {
          response: jsonResponse(error.status && error.status >= 400 ? error.status : 502, {
            error: { message: error.message, type: "upstream_error" },
          }),
        };
      }
    }

    const runId = await getRun(token, agentId, proxyOptions, log);
    const costMode = credentials?.providerSpecificData?.authMethod === "codebuff" ? "paid" : "free";
    const url = this.config.baseUrl || PROVIDERS.freebuff?.baseUrl;

    const send = async () => {
      const payload = buildChatBody(body, requestedModel, { runId, instanceId, costMode, stream });
      const headers = this.buildHeaders(token);
      headers["x-freebuff-instance-id"] = instanceId;
      headers["x-codebuff-agent-id"] = agentId;
      if (runId) headers["x-codebuff-run-id"] = runId;
      const response = await proxyAwareFetch(
        url,
        { method: "POST", headers, body: JSON.stringify(payload), signal },
        proxyOptions
      );
      return { response, payload, headers };
    };

    let { response, payload, headers } = await send();

    if (!response.ok) {
      const errorText = await response.clone().text().catch(() => "");
      if (SESSION_ERROR_MARKERS.some((marker) => errorText.includes(marker))) {
        log?.info?.("FREEBUFF", `Session invalid upstream (${errorText.slice(0, 120)}); refreshing session`);
        sessionCache.delete(token);
        await deleteSession(token, proxyOptions);
        instanceId = await getSession(token, requestedModel, proxyOptions);
        ({ response, payload, headers } = await send());
      }
    }

    return { response, url, headers, transformedBody: payload };
  }
}

export const __test__ = {
  MODEL_TO_AGENT,
  sessionCache,
  runCache,
  generateClientId,
  buildChatBody,
  getSession,
  getRun,
  deleteSession,
  SESSION_URL,
  RUNS_URL,
  SYSTEM_PROMPT,
};

export default FreebuffExecutor;
