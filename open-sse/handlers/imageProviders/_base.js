// Shared helpers for image provider adapters

import { resolveImageJobTimeoutMs } from "../../config/timeouts.js";

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120000;

// Async image jobs poll slower than task APIs: start around 2s and back off to
// ~10s, since aggressive polling hits rate limits.
export const IMAGE_JOB_POLL_START_MS = 2000;
export const IMAGE_JOB_POLL_MAX_MS = 10000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map OpenAI size to provider-specific aspect ratio
export function sizeToAspectRatio(size) {
  if (!size || typeof size !== "string") return "1:1";
  const map = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2",
  };
  return map[size] || "1:1";
}

// Fetch URL → base64 (for providers returning image URLs)
export async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ─── Edit image inputs ──────────────────────────────────────────────────────
// Adapters that accept a source image on their normal generations/executor
// path read strings (data URL / base64 / URL); multipart adapters need the
// original File parts. These helpers convert only the former shape.

export function isFileLike(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.arrayBuffer === "function"
    && typeof value.size === "number"
    && typeof value.type === "string";
}

export async function fileToDataUrl(file) {
  const type = file.type || "image/png";
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${type};base64,${buffer.toString("base64")}`;
}

/** Copy of the edit body with File image/mask inputs converted to data URLs. */
export async function withEditImageDataUrls(body) {
  if (!body || typeof body !== "object") return body;
  const rawImages = Array.isArray(body.images) && body.images.length ? body.images : [body.image];
  const images = [];
  for (const entry of rawImages) {
    if (!entry) continue;
    images.push(isFileLike(entry) ? await fileToDataUrl(entry) : entry);
  }
  let mask = body.mask ?? body.mask_image;
  if (isFileLike(mask)) mask = await fileToDataUrl(mask);
  return {
    ...body,
    ...(images.length > 0 ? { image: images[0], images } : {}),
    ...(typeof mask === "string" && mask ? { mask, mask_image: mask } : {}),
  };
}

// ─── Async image jobs ───────────────────────────────────────────────────────
// Some image upstreams answer POST /images/generations with a job handle
// instead of an image:
//   { "object": "image.generation.job", "status": "processing", "id": "…" }
// The gateway has to poll the status endpoint and hand the client the final
// image payload; adapters without this pass the job JSON through as a fake
// "successful" image response.

const JOB_PENDING = new Set(["queued", "pending", "submitted", "processing", "running", "in_progress", "accepted", "starting"]);
const JOB_SUCCESS = new Set(["completed", "complete", "succeeded", "success", "done", "ready", "finished"]);
const JOB_FAILURE = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired", "timeout", "rejected"]);

/** Raised when the upstream returned a job but exposes no usable status URL. */
export class ImageJobPollingUnsupported extends Error {
  constructor(message, { id = "", url = "" } = {}) {
    super(message);
    this.name = "ImageJobPollingUnsupported";
    this.jobId = id;
    this.pollUrl = url;
  }
}

function jobIdOf(payload) {
  const id = payload?.id ?? payload?.job_id ?? payload?.jobId ?? payload?.task_id ?? payload?.request_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
}

function jobStatusOf(payload) {
  const status = payload?.status ?? payload?.state;
  return typeof status === "string" ? status.toLowerCase() : "";
}

// A final image payload already carries data; never poll those, and never
// mistake an ordinary OpenAI response (no id/status) for a job.
export function isImageJob(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (Array.isArray(payload.data) && payload.data.length > 0) return false;
  if (!jobIdOf(payload)) return false;
  const object = String(payload.object || "").toLowerCase();
  if (/\.job$/.test(object)) return true;
  const status = jobStatusOf(payload);
  return (JOB_PENDING.has(status) || JOB_SUCCESS.has(status) || JOB_FAILURE.has(status))
    && (object === "" || object.includes("job"));
}

function absoluteHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Where to poll a job. A same-origin status URL from the payload wins (several
 * gateways hand one out); otherwise the convention is POST url + "/{id}",
 * matching the custom video adapter's {base}/videos/{id}. Cross-origin
 * payload URLs are ignored so an upstream cannot redirect our credentialed
 * poll to another host (SSRF guard).
 */
export function resolveJobPollUrl(postUrl, job) {
  const candidates = [
    job?.poll_url,
    job?.pollUrl,
    job?.status_url,
    job?.statusUrl,
    job?.urls?.status,
    job?.urls?.poll,
    job?.links?.status,
    job?.links?.self,
  ];
  for (const candidate of candidates) {
    const absolute = absoluteHttpUrl(candidate);
    if (absolute && sameOrigin(absolute, postUrl)) return absolute;
  }
  const id = jobIdOf(job);
  if (!postUrl || !id) return "";
  return `${String(postUrl).replace(/\/+$/, "")}/${encodeURIComponent(id)}`;
}

function pushImageCandidate(out, value) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) out.push({ url: value });
    else if (/^data:image\//i.test(value)) out.push({ b64_json: value.slice(value.indexOf(",") + 1) });
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.b64_json === "string" && value.b64_json) {
    out.push({ b64_json: value.b64_json });
    return;
  }
  if (typeof value.url === "string" && /^https?:\/\//i.test(value.url)) out.push({ url: value.url });
}

/**
 * Normalize a terminal job payload (or an ordinary image payload) into the
 * OpenAI image shape: { created, data: [{ url | b64_json }] }. Unknown shapes
 * are returned untouched so synchronous pass-through adapters keep their
 * current behaviour.
 */
export function normalizeImageResult(payload, prompt = "") {
  if (!payload || typeof payload !== "object") return payload;
  const out = [];
  for (const key of ["data", "images", "output", "result"]) {
    const value = payload[key];
    if (Array.isArray(value)) value.forEach((entry) => pushImageCandidate(out, entry));
    else if (value !== undefined) pushImageCandidate(out, value);
  }
  for (const key of ["url", "image_url", "imageUrl", "result_url", "resultUrl", "output_url", "outputUrl"]) {
    if (typeof payload[key] === "string") pushImageCandidate(out, payload[key]);
  }
  if (typeof payload.b64_json === "string" && payload.b64_json) out.push({ b64_json: payload.b64_json });
  if (out.length === 0) return payload;
  return {
    created: Number.isFinite(Number(payload.created)) ? Number(payload.created) : nowSec(),
    data: out.map((entry) => ({ ...entry, ...(prompt ? { revised_prompt: prompt } : {}) })),
  };
}

function isFinalImagePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload.data) && payload.data.length > 0) return true;
  return ["images", "output", "result"].some((key) => {
    const value = payload[key];
    return (Array.isArray(value) && value.length > 0) || (typeof value === "string" && /^https?:\/\//i.test(value));
  });
}

/**
 * Poll a job until it reaches a terminal state and return the terminal payload.
 * Fails fast when the first status request 404/405s (the upstream returned a
 * job but has no status endpoint where we looked) instead of burning the
 * 120s timeout, and bounds the whole wait with POLL_TIMEOUT_MS.
 */
export async function pollImageJob({
  postUrl,
  headers = {},
  job,
  fetchImpl = fetch,
  intervalMs = IMAGE_JOB_POLL_START_MS,
  maxIntervalMs = IMAGE_JOB_POLL_MAX_MS,
  timeoutMs = resolveImageJobTimeoutMs(null),
} = {}) {
  const jobId = jobIdOf(job);
  const pollUrl = resolveJobPollUrl(postUrl, job);
  if (!pollUrl) throw new Error(`[image job ${jobId || "unknown"}] has no polling URL`);
  const deadline = Date.now() + timeoutMs;
  let lastStatus = jobStatusOf(job) || "unknown";
  let first = true;
  let waitMs = intervalMs;

  while (Date.now() < deadline) {
    await sleep(waitMs);
    waitMs = Math.min(maxIntervalMs, Math.max(waitMs + 1, Math.round(waitMs * 1.5)));
    let response;
    try {
      response = await fetchImpl(pollUrl, { method: "GET", headers });
    } catch (error) {
      throw new Error(`[image job ${jobId || "unknown"}] poll failed: ${error?.message || error}`);
    }
    if (first && (response.status === 404 || response.status === 405)) {
      throw new ImageJobPollingUnsupported(
        `[image job ${jobId || "unknown"}] upstream returned a job but has no status endpoint at ${pollUrl} (HTTP ${response.status})`,
        { id: jobId, url: pollUrl },
      );
    }
    first = false;
    if (!response.ok) {
      throw new Error(`[image job ${jobId || "unknown"}] poll failed at ${pollUrl} (HTTP ${response.status})`);
    }
    const body = await response.json();
    const status = jobStatusOf(body);
    if (status) lastStatus = status;
    if (JOB_FAILURE.has(status)) {
      const detail = body?.error?.message || body?.message || body?.error || status;
      throw new Error(`[image job ${jobId || "unknown"}] ${detail}`);
    }
    if (JOB_SUCCESS.has(status) || isFinalImagePayload(body)) return body;
  }
  throw new Error(`[image job ${jobId || "unknown"}] timed out after ${Math.round(timeoutMs / 1000)}s (last status: ${lastStatus})`);
}
