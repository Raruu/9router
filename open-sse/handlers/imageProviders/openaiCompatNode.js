// Custom OpenAI-compatible provider nodes (openai-compatible-*) — image generation.
//
// The upstream is an OpenAI-shaped /images/generations endpoint on either the
// node's per-kind host (providerSpecificData.kindBaseUrls.image, e.g. a media
// origin separate from chat) or the node's main baseUrl. The body is the
// standard OpenAI request; a synchronous response passes through unchanged.
//
// Async upstreams (nararouter-style) answer with an image job handle instead of
// an image — `{ object: "image.generation.job", status: "processing", id }`.
// Those are polled (same contract as the custom video adapter) and the terminal
// payload is normalized to the OpenAI image shape.
import { buildCompatKindUrl } from "../../config/kindEndpoints.js";
import { isImageJob, normalizeImageResult, pollImageJob } from "./_base.js";

const openaiCompatNodeImageAdapter = {
  buildUrl: (_model, creds) => buildCompatKindUrl(creds, "image"),
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (model, body) => {
    const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
    const full = { model, prompt, n, size };
    if (quality) full.quality = quality;
    if (style) full.style = style;
    if (response_format) full.response_format = response_format;
    return full;
  },
  // ctx carries the POST url + headers from imageGenerationCore.
  async parseResponse(response, ctx = {}) {
    const payload = await response.json();
    if (!isImageJob(payload)) return payload;
    return await pollImageJob({ postUrl: ctx.url, headers: ctx.headers, job: payload });
  },
  normalize: (responseBody, prompt) => normalizeImageResult(responseBody, prompt),
};

export default openaiCompatNodeImageAdapter;
