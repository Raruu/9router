// Runway ML video jobs — https://docs.dev.runwayml.com
//
// Runway is task-based per operation, not the xAI-style /v1/videos shape:
//   create → POST {base}/image_to_video { promptText, model, ratio, duration, promptImage } → { id }
//   poll   → GET  {base}/tasks/{id} → { id, status: PENDING|RUNNING|SUCCEEDED|FAILED|CANCELLED, output[] }
// Both directions are translated onto the async-job shape clients already poll
// (the image adapter in handlers/imageProviders/runwayml.js blocks internally
// instead; video requests are long, so the job stays pollable by the client).
//
// gen3a_turbo / gen4_turbo are image-to-video models: the body carries
// `promptImage`, mapped from the OpenAI-ish `image` / `image_url` field.

const RUNWAY_VERSION = "2024-11-06";

// OpenAI-ish size → Runway ratio. Same map the image adapter uses.
function sizeToRatio(size) {
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

function headers(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Runway-Version": RUNWAY_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Runway task → the async-job shape 9Router clients poll. */
function fromRunwayTask(json) {
  const id = json?.id;
  if (!id) return json;
  if (json.status === "SUCCEEDED") {
    const videos = (Array.isArray(json.output) ? json.output : [])
      .filter((url) => typeof url === "string" && url)
      .map((url) => ({ url, b64_json: null, mime_type: "video/mp4" }));
    return { id, request_id: id, status: "completed", video: videos[0] || null, videos };
  }
  if (json.status === "FAILED" || json.status === "CANCELLED") {
    return { id, request_id: id, status: "failed", error: json.failure || `Runway task ${json.status}` };
  }
  // PENDING / RUNNING / THROTTLED (and the create response, which carries only
  // an id — the task has not reported a status yet).
  return { id, request_id: id, status: "pending" };
}

export default {
  buildRequest({ config, action, requestId, rawBody, token }) {
    const base = (config.baseUrl || "https://api.dev.runwayml.com/v1").replace(/\/$/, "");

    if (requestId) {
      return {
        method: "GET",
        url: `${base}/tasks/${encodeURIComponent(requestId)}`,
        headers: headers(token),
      };
    }

    if (action !== "generations") {
      // ponytail: Runway has no edits/extensions endpoints; extend goes through
      // generations with a source video upstream, not this proxy shape.
      return { error: `Runway video supports 'generations' only (got '${action}')` };
    }

    let body;
    try {
      body = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
    } catch {
      return { error: "Invalid JSON body" };
    }
    if (!body.model) return { error: "Runway video requires a model (e.g. runwayml/gen4_turbo)" };
    if (!body.prompt) return { error: "Runway video requires a prompt" };

    const image = body.image ?? body.image_url;
    const requestBody = {
      promptText: body.prompt,
      model: body.model,
      ratio: sizeToRatio(body.size),
      duration: Number(body.duration) > 0 ? Number(body.duration) : 5,
      ...(typeof image === "string" && image ? { promptImage: image } : {}),
    };

    return {
      method: "POST",
      url: `${base}/image_to_video`,
      headers: headers(token),
      body: JSON.stringify(requestBody),
    };
  },

  transformResponse: fromRunwayTask,
};
