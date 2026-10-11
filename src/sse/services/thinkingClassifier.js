// Thinking Effort Classifier — server-side interception.
//
// A classifier profile advertises its name inside `capabilities.effort_tiers`
// (see withClassifierTiers). When a client sends that name as its effort value
// (e.g. `reasoning_effort: "laya"`), the gateway runs the profile's System One
// decision model over the last user message and swaps the name for the level it
// decides, before any translation happens. This module owns:
//   - locating/writing the effort value across client shapes (readEffortField)
//   - resolving a requested name to an active profile (resolveClassifierRequest)
//   - the classification call itself, fail-open (classifyWithProfile)
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { getModelInfo } from "@/sse/services/model.js";
import { getThinkingClassifierByName } from "@/lib/db/repos/thinkingClassifiersRepo.js";
import { getProviderConnections, getProviderNodes, getCombos, getModelAliases } from "@/lib/localDb";
import { buildProviderIdByPrefix } from "@/lib/providerPrefixMap.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { extractTextContent } from "open-sse/translator/formats/gemini.js";
import { comboEffortTiers } from "open-sse/providers/comboCapabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import {
  buildClassifierQuestions,
  resolveClassifierLevel,
  resolveClassifierScores,
  pickFirstSupported,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  DEFAULT_CLASSIFIER_FALLBACK_LEVEL,
  CLASSIFIER_FALLBACK_LEVELS,
} from "@/shared/constants/thinkingClassifier.js";

const PROMPT_TEXT_MAX = 4000;

// The four body locations that carry a string effort value, in the same
// priority order extractThinking() reads them. The first one present wins —
// writing back to that same location keeps the client's own shape.
const EFFORT_FIELDS = [
  { id: "output_config.effort", read: (b) => b?.output_config?.effort, write: (b, v) => { b.output_config.effort = v; } },
  { id: "reasoning_effort", read: (b) => b?.reasoning_effort, write: (b, v) => { b.reasoning_effort = v; } },
  { id: "reasoning.effort", read: (b) => b?.reasoning?.effort, write: (b, v) => { b.reasoning.effort = v; } },
  { id: "thinkingConfig.thinkingLevel", read: (b) => b?.thinkingConfig?.thinkingLevel, write: (b, v) => { b.thinkingConfig.thinkingLevel = v; } },
  { id: "generationConfig.thinkingConfig.thinkingLevel", read: (b) => b?.generationConfig?.thinkingConfig?.thinkingLevel, write: (b, v) => { b.generationConfig.thinkingConfig.thinkingLevel = v; } },
  { id: "request.generationConfig.thinkingConfig.thinkingLevel", read: (b) => b?.request?.generationConfig?.thinkingConfig?.thinkingLevel, write: (b, v) => { b.request.generationConfig.thinkingConfig.thinkingLevel = v; } },
];

// The effort field the client actually set (string values only — a Claude
// `thinking` object carries no name a profile could match).
export function readEffortField(body) {
  for (const field of EFFORT_FIELDS) {
    const value = field.read(body);
    if (typeof value === "string" && value.trim()) {
      return { field: field.id, value: value.trim().toLowerCase() };
    }
  }
  return null;
}

// Replace the value in the field the client used. Returns false when the
// location vanished between read and write (never throws).
export function writeEffortField(body, fieldId, value) {
  const field = EFFORT_FIELDS.find((f) => f.id === fieldId);
  if (!field || !body || typeof body !== "object") return false;
  try {
    field.write(body, value);
    return true;
  } catch {
    return false;
  }
}

// Which profile, if any, the client asked for. A name that is not an active
// profile is left untouched (it may be a real effort value for some wire).
export async function resolveClassifierRequest(body) {
  const requested = readEffortField(body);
  if (!requested) return null;
  try {
    const profile = await getThinkingClassifierByName(requested.value);
    if (!profile || profile.isActive === false) return null;
    return { profile, field: requested.field, requested: requested.value };
  } catch {
    return null;
  }
}

// Last user message text across OpenAI/Claude/Gemini/Responses shapes.
export function extractPromptText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role !== "user") continue;
      const text = extractTextContent(msg.content, "\n").trim();
      if (text) return text;
      // Claude-style array content may carry non-text blocks only.
      if (Array.isArray(msg.content)) {
        const joined = msg.content.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n").trim();
        if (joined) return joined;
      }
    }
  }
  const contents = Array.isArray(body?.contents) ? body.contents : null;
  if (contents) {
    for (let i = contents.length - 1; i >= 0; i--) {
      const parts = contents[i]?.parts;
      if (!Array.isArray(parts)) continue;
      const text = parts.map((p) => p?.text || "").join("\n").trim();
      if (text) return text;
    }
  }
  const input = Array.isArray(body?.input) ? body.input : null;
  if (input) {
    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i];
      if (item?.role !== "user") continue;
      const text = extractTextContent(item.content, "\n").trim();
      if (text) return text;
      // Responses input blocks are typed `input_text`, which the shared
      // extractor (text-only) skips — read them directly here.
      if (Array.isArray(item.content)) {
        const joined = item.content
          .map((b) => (typeof b === "string" ? b : b?.type === "input_text" || b?.type === "text" ? b.text || "" : ""))
          .join("\n")
          .trim();
        if (joined) return joined;
      }
    }
  }
  return "";
}

/**
 * Run one classifier profile over the request's prompt text.
 *
 * Fail-open by contract: any error (missing credentials, upstream failure,
 * timeout, unusable answers) resolves to `{ levels: [] }` and the caller
 * falls back to the profile's fallbackLevel. Never throws, never locks the
 * classifier account (a classifier call must not degrade routing health).
 *
 * @returns {Promise<{ levels: string[], answers: object|null, latencyMs: number, error: string|null }>}
 */
export async function classifyWithProfile({ profile, body, log }) {
  const startedAt = Date.now();
  const fail = (error) => ({ levels: [], scores: [], answers: null, latencyMs: Date.now() - startedAt, error });

  try {
    const text = extractPromptText(body).slice(0, PROMPT_TEXT_MAX);
    if (!text) return fail("no prompt text");

    const questions = buildClassifierQuestions(profile);
    if (!questions) return fail("profile has no questions");

    const modelInfo = await getModelInfo(profile.model);
    if (!modelInfo?.provider) return fail(`invalid classifier model: ${profile.model}`);

    const credentials = await getProviderCredentials(modelInfo.provider, null, modelInfo.model);
    if (!credentials || credentials.allRateLimited) return fail("classifier account unavailable");

    const refreshed = await checkAndRefreshToken(modelInfo.provider, credentials);

    const result = await handleSystemoneCore({
      body: { model: profile.model, state: text, questions },
      modelInfo,
      credentials: refreshed,
      log,
      timeoutMs: Number.isFinite(profile.timeoutMs) ? profile.timeoutMs : DEFAULT_CLASSIFIER_TIMEOUT_MS,
    });

    if (!result?.success) return fail(result?.error || "classifier request failed");

    const json = await result.response.json().catch(() => null);
    const answers = json?.answers || null;
    const levels = resolveClassifierLevel(profile, answers);
    // Per-question scores for Usage → Details; the winner leads the list.
    const scores = resolveClassifierScores(profile, answers);

    // Cost stays visible in Usage; endpoint tags it as internal so it is not
    // mistaken for client traffic.
    const usage = result.usage;
    if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
      saveRequestUsage({
        provider: modelInfo.provider,
        model: modelInfo.model,
        tokens: usage,
        connectionId: credentials.connectionId,
        endpoint: "/internal/thinking-classifier",
        status: levels.length > 0 ? "success" : "error",
      }).catch(() => {});
    }

    return { levels, scores, answers, latencyMs: Date.now() - startedAt, error: levels.length > 0 ? null : "no usable answer" };
  } catch (error) {
    return fail(error?.message || String(error));
  }
}

// The fallback level sent upstream for a requested profile (validated against
// the expanded set, defaulting to medium).
export function resolveFallbackLevel(profile) {
  const fallback = typeof profile?.fallbackLevel === "string" ? profile.fallbackLevel : "";
  return CLASSIFIER_FALLBACK_LEVELS.includes(fallback) ? fallback : DEFAULT_CLASSIFIER_FALLBACK_LEVEL;
}

/**
 * Thinking levels the request's target accepts, for the first-supported pick.
 * A combo resolves to the union of its members' levels (the same list
 * /v1/models advertises via capabilities.effort_tiers); a single model uses its
 * own list. Any failure resolves to null = "no level information", so the pick
 * falls back to the first candidate and the per-member clamp stays in charge.
 *
 * @param {{ modelStr?: string, comboModels?: string[]|null }} target
 * @returns {Promise<string[]|null>}
 */
export async function resolveTargetLevels(target) {
  try {
    const { modelStr, comboModels } = target || {};
    if (Array.isArray(comboModels) && comboModels.length > 0 && typeof modelStr === "string") {
      const [connections, nodes, combos, modelAliases] = await Promise.all([
        getProviderConnections(),
        getProviderNodes(),
        getCombos(),
        getModelAliases(),
      ]);
      const comboByName = new Map();
      for (const combo of combos || []) {
        if (typeof combo?.name === "string" && !comboByName.has(combo.name)) comboByName.set(combo.name, combo);
      }
      const ctx = { providerIdByPrefix: buildProviderIdByPrefix(connections, nodes), modelAliases, comboByName };
      return comboEffortTiers({ name: modelStr, models: comboModels }, ctx);
    }
    if (typeof modelStr !== "string" || !modelStr) return null;
    const modelInfo = await getModelInfo(modelStr);
    if (!modelInfo?.provider) return null;
    return getThinkingLevels(modelInfo.provider, modelInfo.model) || null;
  } catch {
    return null;
  }
}

/**
 * Interception entry point for handleChat. Reads the requested effort value; if
 * it names an active profile, classifies the prompt, picks the first level the
 * target supports from the decided chain, and rewrites the value in place.
 * Returns a decision object for logging/observability, or null when the request
 * has nothing to do with classifiers.
 *
 * @param {object} body - the client request body (mutated in place)
 * @param {object|null} log
 * @param {{ modelStr?: string, comboModels?: string[]|null }} [target] - the
 *   requested target, used to resolve its supported thinking levels.
 * @returns {Promise<{ profile: string, requested: string, level: string, candidates: string[], scores: {level:string,score:number}[], fallback: boolean, latencyMs: number }|null>}
 */
export async function applyThinkingClassifier(body, log, target = null) {
  const resolved = await resolveClassifierRequest(body);
  if (!resolved) return null;

  const { profile, field, requested } = resolved;
  const result = await classifyWithProfile({ profile, body, log });
  const fallback = result.levels.length === 0;
  const supported = fallback ? null : await resolveTargetLevels(target);
  const level = fallback
    ? resolveFallbackLevel(profile)
    : pickFirstSupported(result.levels, supported);

  writeEffortField(body, field, level);

  const note = fallback
    ? `classifier failed (${result.error}) → fallback ${level}`
    : `→ ${level}${result.levels.length > 1 ? ` (from ${result.levels.join(",")})` : ""}`;
  log?.info?.("CLASSIFIER", `system one (${profile.name}) ${note} · ${result.latencyMs}ms`);

  return {
    profile: profile.name,
    requested,
    level,
    candidates: result.levels,
    scores: result.scores,
    fallback,
    latencyMs: result.latencyMs,
  };
}
