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

// Levels a classifier may decide on. Deliberately excludes "none"/"xhigh":
// the decision is "how much effort", and every mapping format accepts these.
export const CLASSIFIER_LEVELS = Object.freeze(["minimal", "low", "medium", "high", "max"]);

export const DEFAULT_CLASSIFIER_TIMEOUT_MS = 10000;
export const MIN_CLASSIFIER_TIMEOUT_MS = 1000;
export const MAX_CLASSIFIER_TIMEOUT_MS = 60000;
export const DEFAULT_CLASSIFIER_FALLBACK_LEVEL = "medium";

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
// written to be model-agnostic; users can reword them per profile.
export const GENERIC_ARGMAX_QUESTIONS = Object.freeze([
  { id: "level_minimal", level: "minimal", instructions: "The request is trivial: a greeting, thanks, or a one-line lookup needing no analysis." },
  { id: "level_low", level: "low", instructions: "The request is simple: a short explanation or a small self-contained edit that needs no planning." },
  { id: "level_medium", level: "medium", instructions: "The request needs moderate work: multi-step reasoning, a change across a few files, or a balanced trade-off." },
  { id: "level_high", level: "high", instructions: "The request is complex: deep reasoning, architecture or debugging across systems, or strict correctness requirements." },
  { id: "level_max", level: "max", instructions: "The request is extremely hard: novel research-level reasoning, large-scale design, or a problem where an error is very costly." },
]);

export const GENERIC_THRESHOLD_QUESTION = Object.freeze({
  id: "complexity",
  instructions: "How much reasoning effort does this request need? 0 = trivial (greeting, one-line lookup), 1 = maximum (novel research-level reasoning).",
});

export const GENERIC_THRESHOLD_CUTS = Object.freeze([
  { max: 0.2, level: "minimal" },
  { max: 0.4, level: "low" },
  { max: 0.65, level: "medium" },
  { max: 0.85, level: "high" },
  { max: 1, level: "max" },
]);

// The template a brand-new profile starts from ("generic" prompt handling).
export function genericClassifierTemplate() {
  return {
    model: "oc/jev-1.13-free",
    mode: "argmax",
    questions: GENERIC_ARGMAX_QUESTIONS.map((q) => ({ ...q })),
    threshold: {
      question: { ...GENERIC_THRESHOLD_QUESTION },
      cuts: GENERIC_THRESHOLD_CUTS.map((c) => ({ ...c })),
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

// Map System One answers ({ <id>: { noul: 0..1 } }) to a level.
// argmax: highest probability among the per-level questions.
// threshold: first cut whose `max` the complexity answer is <= (cuts ascending).
// Returns null when the answers carry nothing usable.
export function resolveClassifierLevel(profile, answers) {
  if (!answers || typeof answers !== "object") return null;
  const score = (id) => {
    const value = Number(answers[id]?.noul);
    return Number.isFinite(value) ? value : null;
  };

  if (profile?.mode === "threshold") {
    const question = profile.threshold?.question;
    const cuts = Array.isArray(profile.threshold?.cuts) ? profile.threshold.cuts : [];
    if (!question?.id || cuts.length === 0) return null;
    const value = score(question.id);
    if (value === null) return null;
    const ordered = [...cuts].sort((a, b) => Number(a.max) - Number(b.max));
    for (const cut of ordered) {
      if (value <= Number(cut.max)) {
        return CLASSIFIER_LEVELS.includes(cut.level) ? cut.level : null;
      }
    }
    return null;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const q of Array.isArray(profile?.questions) ? profile.questions : []) {
    if (!q?.id || !CLASSIFIER_LEVELS.includes(q.level)) continue;
    const value = score(q.id);
    if (value === null) continue;
    if (value > bestScore) {
      bestScore = value;
      best = q.level;
    }
  }
  return best;
}
