// SenseNova image generation — OpenAI-shaped /images/generations.
//
// The Token Plan API is synchronous for the U1.5 image models, but a unified
// gateway in front of it may answer with an async job handle. Poll that the
// same way the custom compatible nodes do, so both routes return an image.
import createOpenAIAdapter from "./openai.js";
import { isImageJob, normalizeImageResult, pollImageJob } from "./_base.js";

const base = createOpenAIAdapter("sensenova");

const sensenovaImageAdapter = {
  ...base,
  async parseResponse(response, ctx = {}) {
    const payload = await response.json();
    if (!isImageJob(payload)) return payload;
    return await pollImageJob({
      postUrl: ctx.url || base.buildUrl(),
      headers: ctx.headers,
      job: payload,
      timeoutMs: ctx.jobTimeoutMs,
    });
  },
  normalize: (responseBody, prompt) => normalizeImageResult(responseBody, prompt),
};

export default sensenovaImageAdapter;
