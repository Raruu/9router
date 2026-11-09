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
import { buildCompatKindUrl, resolveCompatKindBaseUrl } from "../../config/kindEndpoints.js";
import { isImageJob, normalizeImageResult, pollImageJob } from "./_base.js";

// Auth-only headers: a multipart FormData body must set its own boundary, so an
// explicit Content-Type would break the upload.
function authHeaders(creds, extra = {}) {
  const headers = { ...extra };
  const key = creds?.apiKey || creds?.accessToken;
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

// OpenAI edits body shape: model + prompt + the source image(s) as files, plus
// the optional knobs both OpenAI and xKiro accept.
const EDIT_FORM_FIELDS = ["n", "size", "quality", "background", "input_fidelity", "output_format", "response_format"];

function buildEditForm(model, body) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", body.prompt);

  const files = Array.isArray(body.images) && body.images.length ? body.images : [body.image];
  files.filter(Boolean).forEach((file, index) => {
    form.append(index === 0 ? "image" : "image[]", file, file.name || `image-${index + 1}.png`);
  });
  if (body.mask) form.append("mask", body.mask, body.mask.name || "mask.png");
  for (const field of EDIT_FORM_FIELDS) {
    if (body[field] !== undefined && body[field] !== "") form.append(field, String(body[field]));
  }
  return form;
}

// A gateway that runs image edits asynchronously retrieves the job from its
// generations endpoint (xKiro documents `/v1/images/generations/{id}` even for
// edits); a payload-supplied same-origin poll_url still wins in pollImageJob.
function editPollBase(postUrl) {
  return String(postUrl || "").replace(/\/images\/edits\/?$/, "/images/generations");
}

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
  buildEditRequest({ model, body, credentials }) {
    const base = resolveCompatKindBaseUrl(credentials, "image");
    if (!base) throw new Error("No base URL configured for this provider");
    return {
      url: `${base}/images/edits`,
      headers: authHeaders(credentials, { Accept: "application/json" }),
      body: buildEditForm(model, body),
    };
  },
  // ctx carries the POST url + headers from imageGenerationCore.
  async parseResponse(response, ctx = {}) {
    const payload = await response.json();
    if (!isImageJob(payload)) return payload;
    return await pollImageJob({
      postUrl: editPollBase(ctx.url),
      headers: ctx.headers,
      job: payload,
      timeoutMs: ctx.jobTimeoutMs,
    });
  },
  normalize: (responseBody, prompt) => normalizeImageResult(responseBody, prompt),
};

export default openaiCompatNodeImageAdapter;
