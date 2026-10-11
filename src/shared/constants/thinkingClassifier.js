// Thinking Effort Classifier — shared constants, validation and the generic
// profile template. A classifier profile advertises its `name` inside
// `capabilities.effort_tiers`; a client selects it by sending that name as its
// effort value, and the gateway swaps it for the level the System One decision
// model picks for the prompt.
import { LEVEL_TO_BUDGET } from "open-sse/translator/concerns/thinking.js";

// Names a profile may NOT take: they are real effort values on some wire, so a
// profile named "high" would be indistinguishable from the client asking for
// high effort and could never be intercepted reliably.
export const RESERVED_EFFORT_VALUES = Object.freeze([
  ...Object.keys(LEVEL_TO_BUDGET), // none, minimal, low, medium, high, xhigh, max
  "off", "auto", "ultra", "thinking",
]);

export const CLASSIFIER_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const CLASSIFIER_MODES = Object.freeze(["argmax", "threshold"]);

// Values a profile's fallback dropdown offers. Wider than the old five-level
// decision vocabulary: a chain may name "none"/"xhigh", so the fallback must be
// able to hold whatever the user configured as the profile's intent.
export const CLASSIFIER_FALLBACK_LEVELS = Object.freeze([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "auto",
]);

// Per-field caps. Values are NOT validated against a vocabulary: users may
// target levels this install's tables do not know yet (a new provider level,
// a future wire value), so any non-empty token is accepted and passed through.
export const MAX_LEVEL_CHAIN = 16;
export const MAX_LEVEL_TOKEN_LENGTH = 32;

export const DEFAULT_CLASSIFIER_TIMEOUT_MS = 10000;
export const MIN_CLASSIFIER_TIMEOUT_MS = 1000;
export const MAX_CLASSIFIER_TIMEOUT_MS = 60000;
export const DEFAULT_CLASSIFIER_FALLBACK_LEVEL = "medium";

// Parse a comma-separated level chain ("high,xhigh" → ["high","xhigh"]).
// Accepts an array too, so a stored profile round-trips unchanged. Trims,
// lowercases, dedupes, drops empties and caps length — no value validation.
export function parseLevelList(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const token = entry.trim().toLowerCase().slice(0, MAX_LEVEL_TOKEN_LENGTH);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_LEVEL_CHAIN) break;
  }
  return out;
}

// A profile entry's level chain. Reads `levels` (current shape) and falls back
// to the legacy single `level` string, so profiles created before chains keep
// working without a data migration.
export function questionLevels(entry) {
  if (!entry || typeof entry !== "object") return [];
  if (entry.levels !== undefined) return parseLevelList(entry.levels);
  return parseLevelList(entry.level);
}

// First candidate the target actually supports. "auto" is a mode rather than a
// level — every model accepts it — so it always wins when listed. An empty
// `supported` list means "no level information": the first candidate is sent
// and the existing per-member clamp handles it downstream.
export function pickFirstSupported(candidates, supported) {
  const list = parseLevelList(candidates);
  if (list.length === 0) return null;
  if (!Array.isArray(supported) || supported.length === 0) return list[0];
  for (const candidate of list) {
    if (candidate === "auto" || supported.includes(candidate)) return candidate;
  }
  return list[0];
}

// Validate a profile name. Returns { ok: true } or { ok: false, error }.
export function validateClassifierName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return { ok: false, error: "Name is required" };
  if (RESERVED_EFFORT_VALUES.includes(value)) {
    return { ok: false, error: `"${value}" is a reserved effort value` };
  }
  if (!CLASSIFIER_NAME_REGEX.test(value)) {
    return { ok: false, error: "Name must be lowercase letters, digits, - or _ (max 32 chars)" };
  }
  return { ok: true, value };
}

// Prefilled generic template — one argmax question per level. Instructions are
// written to be model-agnostic; users can reword them per profile. Levels are
// chains: the hardest entry lists fallbacks so a target that cannot go that
// high still gets the strongest level it accepts.
export const GENERIC_ARGMAX_QUESTIONS = Object.freeze([
  { id: "level_minimal", levels: ["minimal"], instructions: "The request is trivial: a greeting, thanks, or a one-line lookup needing no analysis." },
  { id: "level_low", levels: ["low", "minimal"], instructions: "The request is simple: a short explanation or a small self-contained edit that needs no planning." },
  { id: "level_medium", levels: ["medium", "low"], instructions: "The request needs moderate work: multi-step reasoning, a change across a few files, or a balanced trade-off." },
  { id: "level_high", levels: ["high", "medium"], instructions: "The request is complex: deep reasoning, architecture or debugging across systems, or strict correctness requirements." },
  { id: "level_max", levels: ["max", "xhigh", "high"], instructions: "The request is extremely hard: novel research-level reasoning, large-scale design, or a problem where an error is very costly." },
]);

export const GENERIC_THRESHOLD_QUESTION = Object.freeze({
  id: "complexity",
  instructions: "How much reasoning effort does this request need? 0 = trivial (greeting, one-line lookup), 1 = maximum (novel research-level reasoning).",
});

export const GENERIC_THRESHOLD_CUTS = Object.freeze([
  { max: 0.2, levels: ["minimal"] },
  { max: 0.4, levels: ["low", "minimal"] },
  { max: 0.65, levels: ["medium", "low"] },
  { max: 0.85, levels: ["high", "medium"] },
  { max: 1, levels: ["max", "xhigh", "high"] },
]);

// The template a brand-new profile starts from ("generic" prompt handling).
export function genericClassifierTemplate() {
  return {
    model: "oc/jev-1.13-free",
    mode: "argmax",
    questions: GENERIC_ARGMAX_QUESTIONS.map((q) => ({ ...q, levels: [...q.levels] })),
    threshold: {
      question: { ...GENERIC_THRESHOLD_QUESTION },
      cuts: GENERIC_THRESHOLD_CUTS.map((c) => ({ ...c, levels: [...c.levels] })),
    },
    fallbackLevel: DEFAULT_CLASSIFIER_FALLBACK_LEVEL,
    timeoutMs: DEFAULT_CLASSIFIER_TIMEOUT_MS,
  };
}

// Build the `questions` object the System One endpoint expects for a profile.
export function buildClassifierQuestions(profile) {
  if (profile?.mode === "threshold") {
    const question = profile.threshold?.question;
    if (!question?.id) return null;
    return { [question.id]: { type: "noul", instructions: question.instructions || question.id } };
  }
  const questions = Array.isArray(profile?.questions) ? profile.questions : [];
  const out = {};
  for (const q of questions) {
    if (!q?.id) continue;
    out[q.id] = { type: "noul", instructions: q.instructions || q.id };
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Map System One answers ({ <id>: { noul: 0..1 } }) to a LEVEL CHAIN (array).
// argmax: the winning question's chain (highest probability).
// threshold: the matching cut's chain (first cut whose `max` the score is <=,
// cuts ascending).
// Returns [] when the answers carry nothing usable. The caller picks the first
// entry the target supports (pickFirstSupported).
export function resolveClassifierLevel(profile, answers) {
  if (!answers || typeof answers !== "object") return [];
  const score = (id) => {
    const value = Number(answers[id]?.noul);
    return Number.isFinite(value) ? value : null;
  };

  if (profile?.mode === "threshold") {
    const question = profile.threshold?.question;
    const cuts = Array.isArray(profile.threshold?.cuts) ? profile.threshold.cuts : [];
    if (!question?.id || cuts.length === 0) return [];
    const value = score(question.id);
    if (value === null) return [];
    const ordered = [...cuts].sort((a, b) => Number(a.max) - Number(b.max));
    for (const cut of ordered) {
      if (value <= Number(cut.max)) return questionLevels(cut);
    }
    return [];
  }

  let best = null;
  let bestScore = -Infinity;
  for (const q of Array.isArray(profile?.questions) ? profile.questions : []) {
    if (!q?.id) continue;
    const value = score(q.id);
    if (value === null) continue;
    if (value > bestScore) {
      bestScore = value;
      best = q;
    }
  }
  return questionLevels(best);
}
