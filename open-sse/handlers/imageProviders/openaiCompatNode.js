// Custom OpenAI-compatible provider nodes (openai-compatible-*) — image generation.
//
// The upstream is an OpenAI-shaped /images/generations endpoint on either the
// node's per-kind host (providerSpecificData.kindBaseUrls.image, e.g. a media
// origin separate from chat) or the node's main baseUrl. The body is the
// standard OpenAI request; the response passes through unchanged.
import { buildCompatKindUrl } from "../../config/kindEndpoints.js";

export default {
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
  normalize: (responseBody) => responseBody,
};
