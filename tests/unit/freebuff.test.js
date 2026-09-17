/**
 * Unit tests for the Freebuff/Codebuff proxy executor.
 *
 * Covers the flow that would silently break inference:
 *   - session leasing (cache, model switch, queue, disabled, HTTP errors)
 *   - agent-run leasing with 6h rotation (best-effort)
 *   - chat shaping (Buffy prompt, codebuff_metadata, x-codebuff-* headers, cost mode)
 *   - session-error marker retry
 *   - provider/model/executor registration + dashboard catalog
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { FreebuffExecutor, __test__ } from "../../open-sse/executors/freebuff.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getProvider } from "../../src/lib/oauth/providers/index.js";

const { MODEL_TO_AGENT, sessionCache, runCache, buildChatBody, SESSION_URL, RUNS_URL, SYSTEM_PROMPT } = __test__;

const MODEL = "deepseek/deepseek-v4-flash";
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => text,
    clone: () => ({ text: async () => text }),
    headers: new Headers(),
  };
}

function rawResponse(text, { ok = false, status = 401 } = {}) {
  return {
    ok,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
    clone: () => ({ text: async () => text }),
    headers: new Headers(),
  };
}

function sessionActive(instanceId = "inst-1") {
  return jsonResponse({ status: "active", instanceId, expiresAt: FUTURE });
}

function runStarted(runId = "run-1") {
  return jsonResponse({ runId });
}

const credentials = { accessToken: "cb-token" };

beforeEach(() => {
  fetchMock.mockReset();
  sessionCache.clear();
  runCache.clear();
});

describe("buildChatBody", () => {
  it("injects the Buffy system prompt when absent", () => {
    const out = buildChatBody({ messages: [{ role: "user", content: "hi" }] }, MODEL, {
      runId: "r1",
      instanceId: "i1",
      costMode: "free",
      stream: true,
    });
    expect(out.messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(out.messages.find((m) => m.role === "user").content).toBe("hi");
  });

  it("does not duplicate an existing Buffy prompt", () => {
    const out = buildChatBody(
      { messages: [{ role: "system", content: `  You are Buffy, the strategic coding assistant.` }, { role: "user", content: "hi" }] },
      MODEL,
      { runId: "r1", instanceId: "i1", costMode: "free", stream: true }
    );
    expect(out.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("sets model, stream and codebuff_metadata", () => {
    const out = buildChatBody({ messages: [] }, MODEL, {
      runId: "r1",
      instanceId: "i1",
      costMode: "paid",
      stream: false,
    });
    expect(out.model).toBe(MODEL);
    expect(out.stream).toBe(false);
    expect(out.codebuff_metadata).toMatchObject({
      run_id: "r1",
      cost_mode: "paid",
      freebuff_instance_id: "i1",
    });
    expect(out.codebuff_metadata.client_id).toMatch(/^[a-z0-9]{13}$/);
  });
});

describe("FreebuffExecutor.execute", () => {
  const exec = new FreebuffExecutor();

  it("returns a 401 when no token is present", async () => {
    const { response } = await exec.execute({ model: MODEL, body: {}, credentials: {} });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.message).toMatch(/Auth Token required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leases a session, starts a run and sends the chat with x-codebuff-* headers", async () => {
    fetchMock.mockResolvedValueOnce(sessionActive());
    fetchMock.mockResolvedValueOnce(runStarted());
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const { response, url, headers, transformedBody } = await exec.execute({
      model: MODEL,
      body: { stream: true, messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    });

    expect(response.ok).toBe(true);
    expect(url).toBe(PROVIDERS.freebuff.baseUrl);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [sessionUrl, sessionOpts] = fetchMock.mock.calls[0];
    expect(sessionUrl).toBe(SESSION_URL);
    expect(sessionOpts.method).toBe("POST");
    expect(sessionOpts.headers.Authorization).toBe("Bearer cb-token");
    expect(sessionOpts.headers["x-freebuff-model"]).toBe(MODEL);

    const [runsUrl, runsOpts] = fetchMock.mock.calls[1];
    expect(runsUrl).toBe(RUNS_URL);
    expect(JSON.parse(runsOpts.body)).toEqual({ action: "START", agentId: MODEL_TO_AGENT[MODEL] });

    const chatHeaders = fetchMock.mock.calls[2][1].headers;
    expect(chatHeaders["x-freebuff-instance-id"]).toBe("inst-1");
    expect(chatHeaders["x-codebuff-agent-id"]).toBe(MODEL_TO_AGENT[MODEL]);
    expect(chatHeaders["x-codebuff-run-id"]).toBe("run-1");
    expect(headers["Authorization"]).toBe("Bearer cb-token");

    expect(transformedBody.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(transformedBody.codebuff_metadata.cost_mode).toBe("free");
  });

  it("uses cost_mode paid for Codebuff-auth connections", async () => {
    fetchMock.mockResolvedValueOnce(sessionActive());
    fetchMock.mockResolvedValueOnce(runStarted());
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const { transformedBody } = await exec.execute({
      model: MODEL,
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "cb-token", providerSpecificData: { authMethod: "codebuff" } },
    });
    expect(transformedBody.codebuff_metadata.cost_mode).toBe("paid");
  });

  it("surfaces a queued waiting room as a 503 with Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "queued", position: 4, queueDepth: 12, estimatedWaitMs: 9000 })
    );
    const { response } = await exec.execute({ model: MODEL, body: {}, credentials });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("9");
    const data = await response.json();
    expect(data.error.type).toBe("waiting_room_queued");
  });

  it("surfaces session HTTP failures with the upstream status", async () => {
    fetchMock.mockResolvedValueOnce(rawResponse("nope", { ok: false, status: 401 }));
    const { response } = await exec.execute({ model: MODEL, body: {}, credentials });
    expect(response.status).toBe(401);
  });

  it("deletes the upstream session when the requested model changes", async () => {
    fetchMock.mockResolvedValueOnce(sessionActive("inst-1"));
    fetchMock.mockResolvedValueOnce(runStarted());
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await exec.execute({ model: MODEL, body: {}, credentials });

    const other = "deepseek/deepseek-v4-pro";
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: true, status: 200 }));
    fetchMock.mockResolvedValueOnce(sessionActive("inst-2"));
    fetchMock.mockResolvedValueOnce(runStarted("run-2"));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const { response } = await exec.execute({ model: other, body: {}, credentials });

    expect(response.ok).toBe(true);
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[4][1].headers["x-freebuff-model"]).toBe(other);
    expect(fetchMock.mock.calls[6][1].headers["x-freebuff-instance-id"]).toBe("inst-2");
  });

  it("refreshes the session and retries once on session error markers", async () => {
    fetchMock.mockResolvedValueOnce(sessionActive("inst-1"));
    fetchMock.mockResolvedValueOnce(runStarted());
    fetchMock.mockResolvedValueOnce(rawResponse("session_expired", { ok: false, status: 401 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: true, status: 200 }));
    fetchMock.mockResolvedValueOnce(sessionActive("inst-2"));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const { response } = await exec.execute({ model: MODEL, body: {}, credentials });
    expect(response.ok).toBe(true);
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[5][1].headers["x-freebuff-instance-id"]).toBe("inst-2");
  });

  it("continues without a run id when agent-run start fails", async () => {
    fetchMock.mockResolvedValueOnce(sessionActive());
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const { response } = await exec.execute({ model: MODEL, body: {}, credentials });
    expect(response.ok).toBe(true);
    expect(fetchMock.mock.calls[2][1].headers["x-codebuff-run-id"]).toBeUndefined();
  });

  it("rotates the cached agent run after 6 hours", async () => {
    fetchMock.mockResolvedValueOnce(sessionActive());
    fetchMock.mockResolvedValueOnce(runStarted("run-1"));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await exec.execute({ model: MODEL, body: {}, credentials });

    const agentId = MODEL_TO_AGENT[MODEL];
    runCache.get("cb-token").set(agentId, { runId: "run-1", startedAt: Date.now() - 7 * 60 * 60 * 1000 });
    fetchMock.mockResolvedValueOnce(runStarted("run-2"));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await exec.execute({ model: MODEL, body: {}, credentials });

    expect(fetchMock.mock.calls[3][0]).toBe(RUNS_URL);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer cb-token");
    expect(fetchMock.mock.calls[4][1].headers["x-codebuff-run-id"]).toBe("run-2");
  });
});

describe("Freebuff provider registration", () => {
  it("registers a specialized executor for freebuff and the fb alias", () => {
    expect(getExecutor("freebuff")).toBeInstanceOf(FreebuffExecutor);
    expect(getExecutor("fb")).toBeInstanceOf(FreebuffExecutor);
  });

  it("exposes the nine Freebuff models under the fb alias", () => {
    expect(PROVIDER_MODELS.fb.map((m) => m.id)).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "openai/gpt-5.6-luna",
      "minimax/minimax-m3",
      "mimo/mimo-v2.5",
      "z-ai/glm-5.2",
      "crof/kimi-k3-eco",
      "anthropic/claude-fable-5",
      "meta/muse-spark-1.2-contributor",
    ]);
  });

  it("maps the id to the fb alias and registers the transport", () => {
    expect(PROVIDER_ID_TO_ALIAS.freebuff).toBe("fb");
    expect(PROVIDERS.freebuff.baseUrl).toBe("https://www.codebuff.com/api/v1/chat/completions");
    expect(PROVIDERS.freebuff.format).toBe("openai");
  });

  it("lists freebuff in the dashboard OAuth catalog with the risk notice", () => {
    const info = OAUTH_PROVIDERS.freebuff;
    expect(info.alias).toBe("fb");
    expect(info.deprecated).toBe(true);
    expect(info.deprecationNotice).toMatch(/Risk Notice/);
    expect(info.authModes).toContain("apikey");
  });

  it("registers the device-code OAuth handler", () => {
    expect(getProvider("freebuff").flowType).toBe("device_code");
  });
});
