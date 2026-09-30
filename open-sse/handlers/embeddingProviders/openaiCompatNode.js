// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    // OpenAI-compatible nodes may host embeddings on a different origin than
    // chat (kindBaseUrls.embedding); when set it wins over the node's main
    // baseUrl. Custom-embedding nodes never carry the map, so they keep using
    // their purpose-built baseUrl.
    const specific = creds?.providerSpecificData || {};
    const override = specific.kindBaseUrls?.embedding;
    const rawBaseUrl = (typeof override === "string" && override.trim())
      ? override
      : (specific.baseUrl || "https://api.openai.com/v1");
    const baseUrl = rawBaseUrl.replace(/\/+$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
};
