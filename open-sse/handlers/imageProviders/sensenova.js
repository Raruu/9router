// Image generation adapter — OpenAI-shaped /images/generations with async job
// polling. The direct API is synchronous, but a gateway in front of it may
// answer with a job handle. Poll that the same way the custom compatible nodes
// do, so both routes return an image.
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
