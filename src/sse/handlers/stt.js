import {
  extractApiKey, validateApiKeyWithRules,
  getProviderCredentials, markAccountUnavailable,
  resolveProviderDisplayLabel,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { providerDisplayLabel, providerModelTag } from "open-sse/utils/providerLabel.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger.js";

// Providers requiring credentials for STT
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("stt") && !p.noAuth && p.sttConfig?.authType !== "none")
    .map(([id]) => id)
);

export async function handleStt(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const modelStr = formData.get("model");
  log.request("POST", `/v1/audio/transcriptions | ${modelStr}`);

  // Enforce the API key when required, and always apply its per-key rules
  // (limits, allowed models) when one is presented.
  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  if (apiKey) {
    const keyCheck = await validateApiKeyWithRules(apiKey, modelStr);
    if (!keyCheck.valid) {
      log.warn("AUTH", `${keyCheck.error} (key=${log.maskKey(apiKey)})`);
      return errorResponse(keyCheck.status || HTTP_STATUS.UNAUTHORIZED, keyCheck.error);
    }
  } else if (settings.requireApiKey) {
    log.warn("AUTH", "Missing API key (requireApiKey=true)");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("file")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  // noAuth providers
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleSttCore({ provider, model, formData, sttConfig: AI_PROVIDERS[provider]?.sttConfig });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "STT failed");
  }

  // Credentialed — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        const tag = providerModelTag(provider, credentials.providerSpecificData, model);
        return unavailableResponse(status, `[${tag}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        const label = await resolveProviderDisplayLabel(provider);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${label}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerDisplayLabel(provider, credentials.providerSpecificData)} account: ${credentials.connectionName}\x1b[0m`);

    const result = await handleSttCore({ provider, model, formData, credentials, sttConfig: AI_PROVIDERS[provider]?.sttConfig });

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status, result.error);
  }
}
