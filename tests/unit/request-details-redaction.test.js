import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestDetails: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/usageDb", () => ({
  getRequestDetails: mocks.getRequestDetails,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

const { GET } = await import("../../src/app/api/usage/request-details/route.js");

const storedDetail = {
  id: "abc",
  provider: "opencode",
  model: "glm-5.3-flash",
  timestamp: "2026-09-05T00:00:00Z",
  status: "success",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  latency: { total: 100 },
  request: { messages: [{ role: "user", content: "secret prompt" }] },
  providerRequest: { messages: [{ role: "user", content: "secret prompt" }] },
  providerResponse: { choices: [{ message: { content: "secret answer" } }] },
  response: { content: "secret answer" },
};

function detailFrom(body) {
  return body.details[0];
}

describe("GET /api/usage/request-details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestDetails.mockResolvedValue({ details: [storedDetail], total: 1 });
    mocks.getSettings.mockResolvedValue({});
  });

  it("redacts payloads but keeps metadata by default", async () => {
    const res = await GET(new Request("https://router.test/api/usage/request-details"));
    const d = detailFrom(await res.json());

    expect(res.status).toBe(200);
    expect(d.id).toBe("abc");
    expect(d.provider).toBe("opencode");
    expect(d.model).toBe("glm-5.3-flash");
    expect(d.status).toBe("success");
    expect(d.tokens).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(d.latency).toEqual({ total: 100 });
    expect(d.request).toEqual({ redacted: true });
    expect(d.providerRequest).toEqual({ redacted: true });
    expect(d.providerResponse).toEqual({ redacted: true });
    expect(d.response).toEqual({ redacted: true });
  });

  it("treats an explicit false like the default", async () => {
    mocks.getSettings.mockResolvedValue({ observabilityShowBodies: false });

    const res = await GET(new Request("https://router.test/api/usage/request-details"));
    const d = detailFrom(await res.json());

    expect(d.request).toEqual({ redacted: true });
  });

  it("serves payloads verbatim when observabilityShowBodies is on", async () => {
    mocks.getSettings.mockResolvedValue({ observabilityShowBodies: true });

    const res = await GET(new Request("https://router.test/api/usage/request-details"));
    const d = detailFrom(await res.json());

    expect(res.status).toBe(200);
    expect(d.request).toEqual(storedDetail.request);
    expect(d.providerRequest).toEqual(storedDetail.providerRequest);
    expect(d.providerResponse).toEqual(storedDetail.providerResponse);
    expect(d.response).toEqual(storedDetail.response);
    // On means on — even redaction markers already stored pass through.
    expect(d.tokens).toEqual(storedDetail.tokens);
  });

  it("stays redacted when settings cannot be read (fail closed)", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db unavailable"));

    const res = await GET(new Request("https://router.test/api/usage/request-details"));
    const d = detailFrom(await res.json());

    expect(res.status).toBe(200);
    expect(d.request).toEqual({ redacted: true });
  });

  it("handles empty details", async () => {
    mocks.getRequestDetails.mockResolvedValue({ details: [], total: 0 });

    const res = await GET(new Request("https://router.test/api/usage/request-details"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.details).toEqual([]);
  });
});
