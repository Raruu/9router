// Pure helpers for exporting/importing ONE thinking-classifier profile as JSON.
// The dashboard page owns the UI; keeping parsing and validation here makes the
// trust-sensitive half testable, mirroring the server-side rules in
// /api/thinking-classifiers.
//
// Export format:
//   {
//     "format": "9router-thinking-classifiers",
//     "version": 1,
//     "exportedAt": "<ISO>",
//     "classifier": { name, models, timeoutMode, timeoutMs, mode, inputMode,
//                     tailTurns, tailChars, questions, threshold, fallbackLevel }
//   }
//
// `id`, timestamps and `isActive` are deliberately NOT exported: ids are
// install-local, and the active flag is routing state a file must not flip
// (import leaves an existing profile's flag untouched, new ones default active).
import {
  CLASSIFIER_MODES,
  CLASSIFIER_TIMEOUT_MODES,
  CLASSIFIER_FALLBACK_LEVELS,
  CLASSIFIER_INPUT_MODES,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  DEFAULT_CLASSIFIER_TIMEOUT_MODE,
  DEFAULT_CLASSIFIER_FALLBACK_LEVEL,
  DEFAULT_CLASSIFIER_INPUT_MODE,
  DEFAULT_CLASSIFIER_TAIL_TURNS,
  DEFAULT_CLASSIFIER_TAIL_CHARS,
  MAX_CLASSIFIER_MODELS,
  validateClassifierName,
  clampClassifierTimeout,
  clampClassifierTailTurns,
  clampClassifierTailChars,
  normalizeClassifierModels,
  questionLevels,
  questionIdFromLevels,
} from "@/shared/constants/thinkingClassifier";

export const CLASSIFIER_EXPORT_FORMAT = "9router-thinking-classifiers";
export const CLASSIFIER_EXPORT_VERSION = 1;

/**
 * Build the portable payload for one profile. The `classifier` object is
 * exactly what the import side and POST/PUT routes accept.
 */
export function buildClassifierExport(classifier, date = new Date()) {
  return {
    format: CLASSIFIER_EXPORT_FORMAT,
    version: CLASSIFIER_EXPORT_VERSION,
    exportedAt: date.toISOString(),
    classifier: {
      name: String(classifier?.name || ""),
      models: normalizeClassifierModels(
        classifier?.models !== undefined ? classifier.models : classifier?.model,
        classifier?.timeoutMs,
      ),
      timeoutMode: CLASSIFIER_TIMEOUT_MODES.includes(classifier?.timeoutMode)
        ? classifier.timeoutMode
        : DEFAULT_CLASSIFIER_TIMEOUT_MODE,
      timeoutMs: clampClassifierTimeout(classifier?.timeoutMs) ?? DEFAULT_CLASSIFIER_TIMEOUT_MS,
      mode: CLASSIFIER_MODES.includes(classifier?.mode) ? classifier.mode : "argmax",
      inputMode: CLASSIFIER_INPUT_MODES.includes(classifier?.inputMode) ? classifier.inputMode : DEFAULT_CLASSIFIER_INPUT_MODE,
      tailTurns: clampClassifierTailTurns(classifier?.tailTurns) ?? DEFAULT_CLASSIFIER_TAIL_TURNS,
      tailChars: clampClassifierTailChars(classifier?.tailChars) ?? DEFAULT_CLASSIFIER_TAIL_CHARS,
      questions: Array.isArray(classifier?.questions) ? classifier.questions : [],
      threshold: classifier?.threshold && typeof classifier.threshold === "object" ? classifier.threshold : {},
      fallbackLevel: CLASSIFIER_FALLBACK_LEVELS.includes(classifier?.fallbackLevel)
        ? classifier.fallbackLevel
        : DEFAULT_CLASSIFIER_FALLBACK_LEVEL,
    },
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * Download filename: 9router-thinking-classifier-<name>-<YYYYMMDD-HHMMSS>.json
 * The name is sanitized so an arbitrary profile name stays filename-safe.
 */
export function buildClassifierExportFilename(name, date = new Date()) {
  const safeName = String(name || "classifier").replace(/[^a-zA-Z0-9_-]/g, "-");
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `9router-thinking-classifier-${safeName}-${stamp}.json`;
}

/**
 * Parse an imported JSON document into a profile payload the API accepts.
 * Accepts the export wrapper or a bare classifier object.
 * @param {string} text
 * @returns {{ classifier: object }}
 * @throws {Error} with a user-facing message on malformed or invalid input
 */
export function parseClassifierImport(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("File is empty");

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }

  // Wrapped export → its classifier field; a bare object is the profile itself.
  const raw = parsed.classifier !== undefined ? parsed.classifier : parsed;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected a classifier object");
  }

  const nameCheck = validateClassifierName(raw.name);
  if (!nameCheck.ok) throw new Error(nameCheck.error);

  const models = normalizeClassifierModels(
    raw.models !== undefined ? raw.models : raw.model,
    raw.timeoutMs,
  );
  if (models.length === 0) throw new Error("No classifier model in file");
  if (models.length > MAX_CLASSIFIER_MODELS) {
    throw new Error(`Too many models (max ${MAX_CLASSIFIER_MODELS})`);
  }

  const mode = CLASSIFIER_MODES.includes(raw.mode) ? raw.mode : "argmax";
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (mode === "argmax") {
    // Same rule the server applies: every question needs a level chain, and no
    // two may share one (their derived ids would collide upstream).
    const ids = new Set();
    for (const q of questions) {
      const levels = questionLevels(q);
      const id = questionIdFromLevels(levels);
      if (!id) throw new Error("Every question must list a level");
      if (ids.has(id)) throw new Error(`Two questions use the same level chain: ${levels.join(",")}`);
      ids.add(id);
    }
    if (questions.length === 0) throw new Error("At least one question must list a level");
  }
  const threshold = raw.threshold && typeof raw.threshold === "object" ? raw.threshold : {};
  if (mode === "threshold") {
    const cuts = Array.isArray(threshold.cuts) ? threshold.cuts : [];
    if (cuts.filter((c) => questionLevels(c).length > 0).length === 0) {
      throw new Error("Threshold mode needs at least one cut with a level");
    }
  }

  return {
    classifier: {
      name: nameCheck.value,
      models,
      timeoutMode: CLASSIFIER_TIMEOUT_MODES.includes(raw.timeoutMode)
        ? raw.timeoutMode
        : DEFAULT_CLASSIFIER_TIMEOUT_MODE,
      timeoutMs: clampClassifierTimeout(raw.timeoutMs) ?? DEFAULT_CLASSIFIER_TIMEOUT_MS,
      mode,
      inputMode: CLASSIFIER_INPUT_MODES.includes(raw.inputMode) ? raw.inputMode : DEFAULT_CLASSIFIER_INPUT_MODE,
      tailTurns: clampClassifierTailTurns(raw.tailTurns) ?? DEFAULT_CLASSIFIER_TAIL_TURNS,
      tailChars: clampClassifierTailChars(raw.tailChars) ?? DEFAULT_CLASSIFIER_TAIL_CHARS,
      questions,
      threshold,
      fallbackLevel: CLASSIFIER_FALLBACK_LEVELS.includes(raw.fallbackLevel)
        ? raw.fallbackLevel
        : DEFAULT_CLASSIFIER_FALLBACK_LEVEL,
    },
  };
}
