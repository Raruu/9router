import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import {
  IMAGE_EDIT_MAX_FILES,
  parseImageEditRequestBody,
} from "../../src/sse/handlers/imageEditRequest.js";

// /v1/images/edits: multipart contract forwarded to compatible providers.
// Async gateways execute it as a job retrieved from their generations
// endpoint.

const originalFetch = global.fetch;
const MEDIA_HOST = "https://img.test/v1";

const compatCreds = () => ({
  apiKey: "test-key",
  providerSpecificData: {
    prefix: "xk",
    baseUrl: "https://router.test/v1",
    kindBaseUrls: { image: MEDIA_HOST },
  },
});

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "source.png", { type: "image/png" });

function editForm({ image = true, prompt = "make it blue", model = "sensenova-u1.5-lite" } = {}) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  if (image) form.append("image", png(), "source.png");
  return form;
}

function editRequest(form) {
  return new Request("http://localhost/v1/images/edits", { method: "POST", body: form });
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe("parseImageEditRequestBody", () => {
  it("normalizes a multipart edit into the adapter body shape", async () => {
    const form = editForm();
    form.append("n", "2");
    form.append("size", "1024x1024");
    form.append("quality", "high");

    const parsed = await parseImageEditRequestBody(editRequest(form));

    expect(parsed.error).toBeUndefined();
    expect(parsed.body).toMatchObject({
      model: "sensenova-u1.5-lite",
      prompt: "make it blue",
      n: 2,
      size: "1024x1024",
      quality: "high",
    });
    expect(parsed.body.images).toHaveLength(1);
    expect(parsed.body.image.name).toBe("source.png");
    expect(parsed.body.images[0].type).toBe("image/png");
  });

  it("rejects a JSON body", async () => {
    const parsed = await parseImageEditRequestBody(new Request("http://localhost/v1/images/edits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x", prompt: "y" }),
    }));
    expect(parsed.status).toBe(400);
    expect(parsed.error).toMatch(/multipart\/form-data/);
  });

  it("requires an image file", async () => {
    const parsed = await parseImageEditRequestBody(editRequest(editForm({ image: false })));
    expect(parsed.status).toBe(400);
    expect(parsed.error).toBe("Missing required field: image");
  });

  it("rejects a non-image upload", async () => {
    const form = new FormData();
    form.append("model", "m");
    form.append("prompt", "p");
    form.append("image", new File(["hello"], "a.txt", { type: "text/plain" }), "a.txt");

    const parsed = await parseImageEditRequestBody(editRequest(form));
    expect(parsed.status).toBe(400);
    expect(parsed.error).toMatch(/Unsupported image type/);
  });

  it("caps the number of images", async () => {
    const form = new FormData();
    form.append("model", "m");
    form.append("prompt", "p");
    for (let i = 0; i <= IMAGE_EDIT_MAX_FILES; i += 1) {
      form.append("image[]", png(), `source-${i}.png`);
    }

    const parsed = await parseImageEditRequestBody(editRequest(form));
    expect(parsed.status).toBe(400);
    expect(parsed.error).toMatch(/Too many images/);
  });
});

describe("image edits dispatch", () => {
  it("forwards multipart to a custom node and polls its generations job", async () => {
    global.fetch
      .mockResolvedValueOnce(json({ object: "image.generation.job", status: "processing", id: "edit-1" }, 202))
      .mockResolvedValueOnce(json({ status: "completed", data: [{ url: "https://cdn.test/edited.png" }] }));

    const pending = handleImageGenerationCore({
      action: "edits",
      body: { model: "sensenova-u1.5-lite", prompt: "make it blue", image: png(), images: [png()] },
      modelInfo: { provider: "openai-compatible-chat-xkiro", model: "sensenova-u1.5-lite" },
      credentials: compatCreds(),
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${MEDIA_HOST}/images/edits`);
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("model")).toBe("sensenova-u1.5-lite");
    expect(init.body.get("prompt")).toBe("make it blue");
    expect(init.body.get("image")).toBeInstanceOf(File);

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      `${MEDIA_HOST}/images/generations/edit-1`,
      expect.objectContaining({ method: "GET" }),
    );
    expect((await result.response.json()).data[0].url).toBe("https://cdn.test/edited.png");
  });

  it("returns edited image bytes for ?response_format=binary", async () => {
    const bytes = Buffer.from("EDITED-PNG");
    global.fetch
      .mockResolvedValueOnce(json({ object: "image.generation.job", status: "processing", id: "edit-2" }, 202))
      .mockResolvedValueOnce(json({ status: "completed", data: [{ b64_json: bytes.toString("base64") }] }));

    const pending = handleImageGenerationCore({
      action: "edits",
      body: { model: "sensenova-u1.5-lite", prompt: "warm tones", image: png(), images: [png()] },
      modelInfo: { provider: "openai-compatible-chat-xkiro", model: "sensenova-u1.5-lite" },
      credentials: compatCreds(),
      binaryOutput: true,
      log: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(Buffer.from(await result.response.arrayBuffer()).toString()).toBe("EDITED-PNG");
  });

  it("uses the built-in OpenAI edits endpoint with the same multipart body", async () => {
    global.fetch.mockResolvedValueOnce(json({ created: 1, data: [{ url: "https://cdn.test/openai.png" }] }));

    const result = await handleImageGenerationCore({
      action: "edits",
      body: { model: "gpt-image-2", prompt: "add a hat", image: png(), images: [png()], size: "1024x1024" },
      modelInfo: { provider: "openai", model: "gpt-image-2" },
      credentials: { apiKey: "sk-test" },
      log: null,
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("model")).toBe("gpt-image-2");
    expect(init.body.get("size")).toBe("1024x1024");
    expect((await result.response.json()).data[0].url).toBe("https://cdn.test/openai.png");
  });

  it("rejects edits on a provider without edit support", async () => {
    const result = await handleImageGenerationCore({
      action: "edits",
      body: { model: "gemini-3-pro-image-preview", prompt: "edit", image: png(), images: [png()] },
      modelInfo: { provider: "gemini", model: "gemini-3-pro-image-preview" },
      credentials: { apiKey: "k" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not support image edits/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
