// Custom OpenAI-compatible provider nodes (openai-compatible-*) — image generation.
//
// The upstream is an OpenAI-shaped /images/generations endpoint on either the
// node's per-kind host (providerSpecificData.kindBaseUrls.image, e.g. a media
// origin separate from chat) or the node's main baseUrl. The body is the
// standard OpenAI request; a synchronous response passes through unchanged.
//
// Async upstreams answer with an image job handle instead of an image —
// `{ object: "image.generation.job", status: "processing", id }`.
// Those are polled (same contract as the custom video adapter) and the terminal
// payload is normalized to the OpenAI image shape.
import { buildCompatKindUrl, resolveCompatKindBaseUrl } from "../../config/kindEndpoints.js";
import { isImageJob, normalizeImageResult, pollImageJob, withEditImageDataUrls } from "./_base.js";

// Auth-only headers: a multipart FormData body must set its own boundary, so an
// explicit Content-Type would break the upload.
function authHeaders(creds, extra = {}) {
  const headers = { ...extra };
  const key = creds?.apiKey || creds?.accessToken;
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

// Edits body shape: model + prompt + the source image(s) as files, plus the
// optional knobs the standard edit API accepts.
const EDIT_FORM_FIELDS = ["n", "size", "quality", "background", "input_fidelity", "output_format", "response_format"];

const EDIT_JSON_FIELDS = [...EDIT_FORM_FIELDS];

function buildEditForm(model, body) {
  const form = new FormData();
  // File parts first: some gateways validate the upload while streaming and
  // reject a body that only names the file after the scalar fields.
  const files = Array.isArray(body.images) && body.images.length ? body.images : [body.image];
  files.filter(Boolean).forEach((file, index) => {
    form.append(index === 0 ? "image" : "image[]", file, file.name || `image-${index + 1}.png`);
  });
  if (body.mask) form.append("mask", body.mask, body.mask.name || "mask.png");

  form.append("model", model);
  form.append("prompt", body.prompt);
  for (const field of EDIT_FORM_FIELDS) {
    if (body[field] !== undefined && body[field] !== "") form.append(field, String(body[field]));
  }
  return form;
}

// JSON edit shape: the same fields with images as data URLs. Used by gateways
// that keep one JSON endpoint for both multipart and base64 clients, and by the
// img2img-on-generations fallback.
function buildJsonEditBody(model, body, images) {
  const out = { model, prompt: body.prompt };
  if (images.length > 0) {
    out.image = images[0];
    if (images.length > 1) out.images = images;
  }
  if (typeof body.mask === "string" && body.mask) out.mask = body.mask;
  for (const field of EDIT_JSON_FIELDS) {
    if (body[field] !== undefined && body[field] !== "") out[field] = body[field];
  }
  return out;
}

// A gateway that runs image edits asynchronously may retrieve the job from its
// generations endpoint; a payload-supplied same-origin poll_url still wins in
// pollImageJob.
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
  // Ordered edit candidates: native multipart, JSON edits, then JSON img2img
  // through the generations endpoint. The core only advances on a format-class
  // rejection (400/404/405/415/422), so a real job is never submitted twice.
  async buildEditRequests({ model, body, credentials, options = {} }) {
    const base = resolveCompatKindBaseUrl(credentials, "image");
    if (!base) throw new Error("No base URL configured for this provider");
    const editsUrl = `${base}/images/edits`;
    const generationsUrl = `${base}/images/generations`;
    const dataUrls = await withEditImageDataUrls(body);
    const images = (Array.isArray(dataUrls.images) ? dataUrls.images : []).filter(Boolean);
    const jsonHeaders = authHeaders(credentials, { "Content-Type": "application/json", Accept: "application/json" });
    const multipart = {
      url: editsUrl,
      headers: authHeaders(credentials, { Accept: "application/json" }),
      body: buildEditForm(model, body),
      pollBaseUrl: generationsUrl,
    };
    const jsonEdits = {
      url: editsUrl,
      headers: jsonHeaders,
      body: buildJsonEditBody(model, dataUrls, images),
      pollBaseUrl: generationsUrl,
    };
    const jsonGeneration = {
      url: generationsUrl,
      headers: jsonHeaders,
      body: buildJsonEditBody(model, dataUrls, images),
      pollBaseUrl: generationsUrl,
    };

    // Per-model native opt-in wins; the provider-specific marker can pin one
    // shape for a gateway whose dialect we have already identified.
    if (options.nativeImageEdit === true) return [multipart];
    const format = credentials?.providerSpecificData?.imageEditFormat;
    if (format === "multipart") return [multipart];
    if (format === "json") return [jsonEdits];
    if (format === "generation") return [jsonGeneration];
    return [multipart, jsonEdits, jsonGeneration];
  },
  // ctx carries the POST url + headers from imageGenerationCore.
  async parseResponse(response, ctx = {}) {
    const payload = await response.json();
    if (!isImageJob(payload)) return payload;
    return await pollImageJob({
      postUrl: ctx.pollBaseUrl || editPollBase(ctx.url),
      headers: ctx.headers,
      job: payload,
      timeoutMs: ctx.jobTimeoutMs,
    });
  },
  normalize: (responseBody, prompt) => normalizeImageResult(responseBody, prompt),
};

export default openaiCompatNodeImageAdapter;
