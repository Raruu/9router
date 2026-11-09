// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  const adapter = {
    buildUrl: () => imageUrl(providerId),
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model, body) => {
      const {
        prompt,
        n = 1,
        size = "1024x1024",
        quality,
        style,
        response_format,
        output_format,
      } = body;
      const full = { model, prompt, n, size, output_format };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      for (const field of ["output_format", "watermark", "prompt_extend"]) {
        if (cfg.bodyFields?.includes(field) && body[field] !== undefined) {
          full[field] = body[field];
        }
      }
      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };

  // Providers that expose the standard multipart edit contract opt in through
  // imageConfig.editsUrl.
  if (cfg.editsUrl) {
    const editFields = ["n", "size", "quality", "background", "input_fidelity", "output_format", "response_format"];
    adapter.buildEditRequest = ({ model, body, credentials }) => {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", body.prompt);
      const files = Array.isArray(body.images) && body.images.length ? body.images : [body.image];
      files.filter(Boolean).forEach((file, index) => {
        form.append(index === 0 ? "image" : "image[]", file, file.name || `image-${index + 1}.png`);
      });
      if (body.mask) form.append("mask", body.mask, body.mask.name || "mask.png");
      for (const field of editFields) {
        if (body[field] !== undefined && body[field] !== "") form.append(field, String(body[field]));
      }
      const headers = { Accept: "application/json" };
      const key = credentials?.apiKey || credentials?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return { url: cfg.editsUrl, headers, body: form };
    };
  }

  return adapter;
}
