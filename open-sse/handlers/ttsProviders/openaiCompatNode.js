// Custom OpenAI-compatible provider nodes (openai-compatible-*) — TTS.
//
// POSTs the OpenAI /audio/speech shape to the node's per-kind host
// (providerSpecificData.kindBaseUrls.tts) or its main baseUrl. The upstream
// model comes from the model id; a trailing "/voice" segment addresses a voice
// (same convention as the built-in OpenAI adapter, e.g. "tts-1/alloy").
import { Buffer } from "node:buffer";
import { buildCompatKindUrl } from "../../config/kindEndpoints.js";

const DEFAULT_VOICE = "alloy";

export default {
  async synthesize(text, model, credentials) {
    const url = buildCompatKindUrl(credentials, "tts");
    if (!url) throw new Error("No base URL configured for this provider");

    let ttsModel = model || "";
    let voice = DEFAULT_VOICE;
    if (model && model.includes("/")) {
      const idx = model.lastIndexOf("/");
      ttsModel = model.slice(0, idx);
      voice = model.slice(idx + 1) || DEFAULT_VOICE;
    }

    const headers = { "Content-Type": "application/json" };
    const key = credentials?.apiKey || credentials?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: ttsModel, voice, input: text, response_format: "mp3" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `TTS upstream error (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) throw new Error("Upstream returned empty audio");
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
