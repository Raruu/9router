import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

// Async image jobs: nararouter-style custom nodes (and a unified SenseNova
// gateway) answer POST /images/generations with
//   { object: "image.generation.job", status: "processing", id }
// The gateway must poll the status endpoint and return the final image to the
// client instead of forwarding the job handle.

const originalFetch = global.fetch;

const IMAGE_HOST = "https://img.test/v1";
const POST_URL = `${IMAGE_HOST}/images/generations`;
const compatModel = { provider: "openai-compatible-chat-xkiro", model: "sensenova-u1.5-lite" };
const compatCreds = () => ({
  apiKey: "test-key",
  providerSpecificData: {
    prefix: "xk",
    baseUrl: "https://router.test/v1",
    kindBaseUrls: { image: IMAGE_HOST },
  },
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const job = (id = "job-1", extra = {}) =>
  json({ object: "image.generation.job", status: "processing", id, ...extra });

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe("async image jobs", () => {
  it("polls a compat-node job and returns the image in OpenAI shape", async () => {
    global.fetch
      .mockResolvedValueOnce(job("job-1"))
      .mockResolvedValueOnce(json({
        id: "job-1",
        status: "completed",
        data: [{ url: "https://cdn.test/out.png" }],
      }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a cat", size: "1024x1024" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      `${POST_URL}/job-1`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = await result.response.json();
    expect(body.created).toBeGreaterThan(0);
    expect(body.data[0].url).toBe("https://cdn.test/out.png");
    expect(body.data[0].revised_prompt).toBe("a cat");
  });

  it("honours a same-origin poll_url from the job payload", async () => {
    global.fetch
      .mockResolvedValueOnce(job("job-2", { poll_url: `${IMAGE_HOST}/jobs/job-2` }))
      .mockResolvedValueOnce(json({ status: "succeeded", output: ["https://cdn.test/out-2.png"] }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a dog" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(global.fetch).toHaveBeenNthCalledWith(2, `${IMAGE_HOST}/jobs/job-2`, expect.anything());
    const body = await result.response.json();
    expect(body.data[0].url).toBe("https://cdn.test/out-2.png");
  });

  it("ignores a cross-origin poll_url and uses the convention", async () => {
    global.fetch
      .mockResolvedValueOnce(job("job-3", { poll_url: "https://evil.test/steal" }))
      .mockResolvedValueOnce(json({ status: "completed", images: ["https://cdn.test/out-3.png"] }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a bird" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(global.fetch).toHaveBeenNthCalledWith(2, `${POST_URL}/job-3`, expect.anything());
    expect((await result.response.json()).data[0].url).toBe("https://cdn.test/out-3.png");
  });

  it("returns raw bytes when the client asks for response_format=binary", async () => {
    const png = Buffer.from("PNG-BYTES");
    global.fetch
      .mockResolvedValueOnce(job("job-4"))
      .mockResolvedValueOnce(json({ status: "completed", data: [{ b64_json: png.toString("base64") }] }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a fox", output_format: "png" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      binaryOutput: true,
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await result.response.arrayBuffer()).toString()).toBe("PNG-BYTES");
  });

  it("surfaces a failed job with its upstream message", async () => {
    global.fetch
      .mockResolvedValueOnce(job("job-5"))
      .mockResolvedValueOnce(json({ status: "failed", error: { message: "content blocked" } }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a robot" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("content blocked");
  });

  it("fails fast when the status endpoint does not exist", async () => {
    global.fetch
      .mockResolvedValueOnce(job("job-6"))
      .mockResolvedValueOnce(json({ error: "not found" }, 404));

    const pending = handleImageGenerationCore({
      body: { prompt: "a tree" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("no status endpoint");
    expect(result.error).toContain(`${POST_URL}/job-6`);
  });

  it("backs off between polls instead of hammering the status endpoint", async () => {
    global.fetch
      .mockResolvedValueOnce(job("job-7"))
      .mockResolvedValueOnce(json({ status: "queued" }))
      .mockResolvedValueOnce(json({ status: "completed", data: [{ url: "https://cdn.test/out-7.png" }] }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a mountain" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });

    // First poll after ~2s (xKiro recommends starting there)…
    await vi.advanceTimersByTimeAsync(2000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // …then ~3s (×1.5 backoff), not another 2s.
    await vi.advanceTimersByTimeAsync(2999);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect((await result.response.json()).data[0].url).toBe("https://cdn.test/out-7.png");
  });

  it("passes a synchronous image response through unchanged", async () => {
    global.fetch.mockResolvedValueOnce(json({
      created: 123,
      data: [{ url: "https://cdn.test/sync.png" }],
    }));

    const result = await handleImageGenerationCore({
      body: { prompt: "a lake" },
      modelInfo: compatModel,
      credentials: compatCreds(),
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = await result.response.json();
    expect(body.data[0].url).toBe("https://cdn.test/sync.png");
  });

  it("polls a job from the built-in SenseNova adapter", async () => {
    global.fetch
      .mockResolvedValueOnce(job("sn-1"))
      .mockResolvedValueOnce(json({ status: "completed", data: [{ url: "https://cdn.test/sensenova.png" }] }));

    const pending = handleImageGenerationCore({
      body: { prompt: "a panda" },
      modelInfo: { provider: "sensenova", model: "sensenova-u1.5-lite" },
      credentials: { apiKey: "sn-key" },
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://token.sensenova.cn/v1/images/generations/sn-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect((await result.response.json()).data[0].url).toBe("https://cdn.test/sensenova.png");
  });
});
