// OpenRouter image adapter.
//
// Text-to-image keeps OpenRouter's OpenAI-shaped generations endpoint. Image
// edits use the dedicated Image API, which takes base64/URL references in
// `input_references` (JSON) instead of OpenAI's multipart `/images/edits`.
import createOpenAIAdapter from "./openai.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { normalizeImageResult, withEditImageDataUrls } from "./_base.js";

const base = createOpenAIAdapter("openrouter");
const EDIT_URL = (PROVIDER_MEDIA["openrouter"]?.imageConfig?.baseUrl || "")
  .replace(/\/images\/generations$/, "/images");

const openrouterImageAdapter = {
  ...base,

  async buildEditRequest({ model, body, credentials }) {
    if (!EDIT_URL) throw new Error("OpenRouter image endpoint is not configured");
    const dataUrls = await withEditImageDataUrls(body);
    const references = (Array.isArray(dataUrls.images) ? dataUrls.images : [])
      .filter(Boolean)
      .map((url) => ({ type: "image_url", image_url: { url } }));
    return {
      url: EDIT_URL,
      headers: base.buildHeaders(credentials),
      body: {
        model,
        prompt: body.prompt,
        ...(references.length > 0 ? { input_references: references } : {}),
        ...(body.size ? { size: body.size } : {}),
      },
    };
  },

  normalize: (responseBody, prompt) => normalizeImageResult(responseBody, prompt),
};

export default openrouterImageAdapter;
