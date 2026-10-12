// Thinking Effort Classifier — server-side interception.
//
// A classifier profile advertises its name inside `capabilities.effort_tiers`
// (see withClassifierTiers). When a client sends that name as its effort value
// (e.g. `reasoning_effort: "laya"`), the gateway runs the profile's System One
// decision model over the profile's chosen slice of the request (see
// CLASSIFIER_INPUT_MODES — the newest turn by default) and swaps the
// name for the level it decides, before any translation happens. This module owns:
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
import { coerceResponsesOutput } from "open-sse/translator/formats/responsesApi.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM } from "open-sse/translator/schema/index.js";
import { extractThinking } from "open-sse/translator/concerns/thinkingUnified.js";
import { comboEffortTiers } from "open-sse/providers/comboCapabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import {
  buildClassifierQuestions,
  resolveClassifierLevel,
  resolveClassifierScores,
  pickFirstSupported,
  profileModels,
  clampClassifierTailTurns,
  clampClassifierTailChars,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  DEFAULT_CLASSIFIER_FALLBACK_LEVEL,
  DEFAULT_CLASSIFIER_INPUT_MODE,
  DEFAULT_CLASSIFIER_TAIL_TURNS,
  DEFAULT_CLASSIFIER_TAIL_CHARS,
  CLASSIFIER_FALLBACK_LEVELS,
  CLASSIFIER_INPUT_MODES,
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

// Text of a message's content across OpenAI (string) and Claude (blocks) shapes.
// Mirrors the original extractor: typed text blocks first, then a per-block
// fallback for array content that carries no `type: "text"` marker.
function contentText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const typed = extractTextContent(content, "\n").trim();
    if (typed) return typed;
    return content.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n").trim();
  }
  return "";
}

// Text carried by Claude `tool_result` blocks inside a user message's content.
function claudeToolResultText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block?.type !== CLAUDE_BLOCK.TOOL_RESULT) continue;
    const inner = block.content;
    if (typeof inner === "string") parts.push(inner);
    else if (Array.isArray(inner)) parts.push(inner.map((c) => (typeof c === "string" ? c : c?.text || "")).join("\n"));
  }
  return parts.join("\n").trim();
}

// Stringify a Gemini functionResponse payload for classification.
function coerceToolJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

// Responses input blocks (`input_text`/`output_text`/`text`) are not OpenAI
// `text` blocks, so the shared extractor skips them — read them directly.
function responsesContentText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (typeof b === "string") return b;
      const type = b?.type;
      return type === RESPONSES_ITEM.INPUT_TEXT || type === RESPONSES_ITEM.OUTPUT_TEXT || type === "text" ? b.text || "" : "";
    })
    .join("\n")
    .trim();
}

// One normalized turn list across OpenAI/Claude/Gemini/Responses shapes. A turn
// carries `text` (the message's own text) and `toolText` (a tool result's
// output) separately so each input mode can choose what to read. `role` is
// "user" | "assistant" | "tool". System/developer turns are dropped — they are
// not what a profile classifies.
export function collectTurns(body) {
  const turns = [];

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (messages) {
    for (const msg of messages) {
      const role = msg?.role;
      if (role === "user") {
        turns.push({ role: "user", text: contentText(msg.content), toolText: claudeToolResultText(msg.content) });
      } else if (role === "assistant") {
        turns.push({ role: "assistant", text: contentText(msg.content), toolText: "" });
      } else if (role === "tool") {
        turns.push({ role: "tool", text: "", toolText: contentText(msg.content) });
      }
    }
  }

  const contents = Array.isArray(body?.contents) ? body.contents : null;
  if (contents) {
    for (const entry of contents) {
      const parts = Array.isArray(entry?.parts) ? entry.parts : null;
      if (!parts) continue;
      // Gemini labels assistant turns "model"; anything else (or a missing
      // role) is a user turn. Role-aware on purpose: a trailing model turn is
      // not the user's prompt.
      const role = entry?.role === "model" ? "assistant" : "user";
      const text = parts.map((p) => p?.text || "").join("\n").trim();
      const toolText = parts
        .filter((p) => p?.functionResponse)
        .map((p) => coerceToolJson(p.functionResponse.response ?? p.functionResponse))
        .join("\n")
        .trim();
      turns.push({ role, text, toolText });
    }
  }

  const input = Array.isArray(body?.input) ? body.input : null;
  if (input) {
    for (const item of input) {
      const type = item?.type;
      if (type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || type === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
        turns.push({ role: "tool", text: "", toolText: coerceResponsesOutput(item.output) });
        continue;
      }
      const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null;
      if (!role) continue;
      turns.push({ role, text: responsesContentText(item.content), toolText: "" });
    }
  }

  return turns;
}

// Keep the newest `maxChars` characters (front-truncate), so the freshest text
// survives the budget. Returns the input unchanged when it already fits.
function clampFromFront(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars).trimStart();
}

/**
 * The request text handed to a profile's decision model, selected by its input
 * mode (see CLASSIFIER_INPUT_MODES):
 *   latest-turn (default) — the newest turn with any text, tool results included.
 *   last-user   — the newest user turn's text, skipping tool results and
 *                 assistant turns (the original single-message behavior).
 *   tail-window — the last N turns joined (any role), bounded by a turn count
 *                 and a character budget.
 * The caller applies the final PROMPT_TEXT_MAX cap.
 */
export function extractPromptText(body, options = {}) {
  const mode = CLASSIFIER_INPUT_MODES.includes(options.mode) ? options.mode : DEFAULT_CLASSIFIER_INPUT_MODE;
  const turns = collectTurns(body);

  if (mode === "latest-turn") {
    for (let i = turns.length - 1; i >= 0; i--) {
      const text = turns[i].text || turns[i].toolText;
      if (text) return text;
    }
    return "";
  }

  if (mode === "tail-window") {
    const maxTurns = clampClassifierTailTurns(options.tailTurns) ?? DEFAULT_CLASSIFIER_TAIL_TURNS;
    const maxChars = clampClassifierTailChars(options.tailChars) ?? DEFAULT_CLASSIFIER_TAIL_CHARS;
    const picked = [];
    for (let i = turns.length - 1; i >= 0 && picked.length < maxTurns; i--) {
      const text = (turns[i].text || turns[i].toolText).trim();
      if (text) picked.push(text);
    }
    picked.reverse();
    return clampFromFront(picked.join("\n"), maxChars);
  }

  // last-user
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role !== "user") continue;
    if (turn.text) return turn.text;
  }
  return "";
}

/**
 * Run one classifier profile over the request's prompt text.
 *
 * The profile's models are tried IN ORDER as fallbacks: the first model that
 * returns usable answers wins. A model that cannot be routed (a combo name, a
 * typo), has no available account, errors, times out, or answers nothing usable
 * simply advances to the next. Each attempt gets its own timeout budget.
 *
 * Fail-open by contract: when every model fails this resolves to
 * `{ levels: [], scores: [] }` and the caller falls back to the profile's
 * fallbackLevel. Never throws, never locks a classifier account (a classifier
 * call must not degrade routing health).
 *
 * @returns {Promise<{ levels: string[], scores: {level:string,score:number}[], answers: object|null, usedModel: string|null, attempts: number, latencyMs: number, error: string|null }>}
 */
export async function classifyWithProfile({ profile, body, log }) {
  const startedAt = Date.now();
  const models = profileModels(profile);
  const fail = (error) => ({
    levels: [], scores: [], answers: null, usedModel: null,
    attempts: 0, latencyMs: Date.now() - startedAt, error,
  });
  if (models.length === 0) return fail("profile has no model");

  let attempts = 0;
  let lastError = null;

  try {
    const text = extractPromptText(body, {
      mode: profile?.inputMode,
      tailTurns: profile?.tailTurns,
      tailChars: profile?.tailChars,
    }).slice(0, PROMPT_TEXT_MAX);
    if (!text) return fail("no prompt text");

    const questions = buildClassifierQuestions(profile);
    if (!questions) return fail("profile has no questions");

    for (const entry of models) {
      const modelStr = entry.model;
      const timeoutMs = Number.isFinite(entry.timeoutMs) ? entry.timeoutMs : DEFAULT_CLASSIFIER_TIMEOUT_MS;
      attempts += 1;
      try {
        const modelInfo = await getModelInfo(modelStr);
        if (!modelInfo?.provider) {
          // A combo name or an unresolvable id — nothing to route.
          lastError = `invalid classifier model: ${modelStr}`;
          continue;
        }

        const credentials = await getProviderCredentials(modelInfo.provider, null, modelInfo.model);
        if (!credentials || credentials.allRateLimited) {
          lastError = `${modelStr}: account unavailable`;
          continue;
        }

        const refreshed = await checkAndRefreshToken(modelInfo.provider, credentials);

        const result = await handleSystemoneCore({
          body: { model: modelStr, state: text, questions },
          modelInfo,
          credentials: refreshed,
          log,
          timeoutMs,
        });

        if (!result?.success) {
          lastError = `${modelStr}: ${result?.error || "request failed"}`;
          continue;
        }

        const json = await result.response.json().catch(() => null);
        const answers = json?.answers || null;
        const levels = resolveClassifierLevel(profile, answers);
        // Per-question scores for Usage → Details; the winner leads the list.
        const scores = resolveClassifierScores(profile, answers);

        // Cost stays visible in Usage; endpoint tags it as internal so it is not
        // mistaken for client traffic. Recorded even on an unusable answer — the
        // call was billed.
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

        if (levels.length === 0) {
          lastError = `${modelStr}: no usable answer`;
          continue;
        }

        return {
          levels, scores, answers, usedModel: modelStr, attempts,
          latencyMs: Date.now() - startedAt, error: null,
        };
      } catch (error) {
        // A single model's failure (timeout, network, provider throw) must not
        // abort the fallback chain.
        lastError = `${modelStr}: ${error?.message || String(error)}`;
        continue;
      }
    }

    return { ...fail(lastError || "no usable answer"), attempts };
  } catch (error) {
    return { ...fail(error?.message || String(error)), attempts };
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
 * A profile may also run as the target's DEFAULT tier: when the client expressed
 * no thinking intent at all (no effort value and no thinking/thinkingConfig
 * object) and `target.defaultClassifier` names an active profile, that profile
 * decides the level and it is written to the canonical `reasoning_effort` field.
 * Any client intent — a real level, a budget, a disable — always wins.
 *
 * @param {object} body - the client request body (mutated in place)
 * @param {object|null} log
 * @param {{ modelStr?: string, comboModels?: string[]|null, defaultClassifier?: string }} [target] -
 *   the requested target, used to resolve its supported thinking levels and the
 *   default-tier profile name.
 * @returns {Promise<{ profile: string, requested: string, level: string, candidates: string[], scores: {level:string,score:number}[], usedModel: string|null, fallback: boolean, latencyMs: number }|null>}
 */
export async function applyThinkingClassifier(body, log, target = null) {
  const resolved = await resolveClassifierRequest(body);
  const defaultName = typeof target?.defaultClassifier === "string" ? target.defaultClassifier.trim() : "";

  let profile = resolved?.profile || null;
  let field = resolved?.field || null;
  let requested = resolved?.requested || null;
  let isDefault = false;

  // Default tier: only when the client sent no effort name AND no other thinking
  // intent. An unknown/inactive stored name is a silent no-op (fail-open).
  if (!resolved && defaultName && extractThinking(body) === null) {
    let candidate = null;
    try {
      candidate = await getThinkingClassifierByName(defaultName);
    } catch {
      candidate = null;
    }
    if (candidate && candidate.isActive !== false) {
      profile = candidate;
      requested = candidate.name;
      isDefault = true;
    }
  }
  if (!profile) return null;

  const result = await classifyWithProfile({ profile, body, log });
  const fallback = result.levels.length === 0;
  const supported = fallback ? null : await resolveTargetLevels(target);
  const level = fallback
    ? resolveFallbackLevel(profile)
    : pickFirstSupported(result.levels, supported);

  // Explicit tier: rewrite the exact field the client used. Default tier: no
  // effort field existed, so write the canonical OpenAI effort field —
  // extractThinking reads it format-agnostically and applyThinking re-emits it
  // in the target's native shape downstream.
  if (field) writeEffortField(body, field, level);
  else body.reasoning_effort = level;

  const via = result.usedModel ? ` via ${result.usedModel}` : "";
  const note = fallback
    ? `classifier failed (${result.error}) → fallback ${level}`
    : `→ ${level}${result.levels.length > 1 ? ` (from ${result.levels.join(",")})` : ""}${via}`;
  const label = isDefault ? `default system one (${profile.name})` : `system one (${profile.name})`;
  log?.info?.("CLASSIFIER", `${label} ${note} · ${result.latencyMs}ms`);

  return {
    profile: profile.name,
    requested,
    level,
    candidates: result.levels,
    scores: result.scores,
    usedModel: result.usedModel,
    fallback,
    latencyMs: result.latencyMs,
  };
}
