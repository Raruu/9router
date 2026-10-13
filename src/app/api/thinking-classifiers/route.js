import { NextResponse } from "next/server";
import {
  getThinkingClassifiers,
  createThinkingClassifier,
  getThinkingClassifierByName,
} from "@/lib/db/index.js";
import {
  validateClassifierName,
  CLASSIFIER_MODES,
  CLASSIFIER_FALLBACK_LEVELS,
  CLASSIFIER_TIMEOUT_MODES,
  CLASSIFIER_INPUT_MODES,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  DEFAULT_CLASSIFIER_TIMEOUT_MODE,
  DEFAULT_CLASSIFIER_INPUT_MODE,
  DEFAULT_CLASSIFIER_TAIL_TURNS,
  DEFAULT_CLASSIFIER_TAIL_TOKENS,
  GENERIC_ARGMAX_QUESTIONS,
  GENERIC_THRESHOLD_QUESTION,
  GENERIC_THRESHOLD_CUTS,
  questionLevels,
  questionIdFromLevels,
  clampClassifierTimeout,
  clampClassifierTailTurns,
  clampClassifierTailTokens,
  normalizeClassifierModels,
} from "@/shared/constants/thinkingClassifier.js";

// Validate a create/update payload. Unknown fields are dropped rather than
// merged blindly — the profile is interpolated into upstream request bodies.
export function normalizeClassifierInput(body = {}) {
  const nameCheck = validateClassifierName(body.name);
  if (!nameCheck.ok) return { error: nameCheck.error };

  const timeout = clampClassifierTimeout(body.timeoutMs);
  const timeoutMs = timeout ?? DEFAULT_CLASSIFIER_TIMEOUT_MS;
  const timeoutMode = CLASSIFIER_TIMEOUT_MODES.includes(body.timeoutMode)
    ? body.timeoutMode
    : DEFAULT_CLASSIFIER_TIMEOUT_MODE;
  // Accepts the model list or the legacy single `model` string; entries inherit
  // the profile timeout when they carry none.
  const models = normalizeClassifierModels(
    body.models !== undefined ? body.models : body.model,
    timeoutMs,
  );
  if (models.length === 0) return { error: "Classifier model is required" };

  const mode = CLASSIFIER_MODES.includes(body.mode) ? body.mode : "argmax";

  // Question ids are DERIVED from the level chain (questionIdFromLevels), never
  // taken from the client: an id must always describe its own levels, and two
  // questions must never share one — a duplicate would collapse into a single
  // key in the upstream questions object and silently drop a question. Blank
  // chains produce no id and are dropped (they cannot be addressed upstream).
  const rawQuestions = Array.isArray(body.questions) ? body.questions : GENERIC_ARGMAX_QUESTIONS;
  const questions = [];
  const seenIds = new Map();
  for (const q of rawQuestions.slice(0, 32)) {
    if (!q || typeof q !== "object") continue;
    const levels = questionLevels(q);
    // Truncate BEFORE deduping so two over-long chains that truncate to the
    // same id are rejected rather than silently collapsing upstream.
    const id = questionIdFromLevels(levels).slice(0, 200);
    if (!id) continue;
    if (seenIds.has(id)) {
      return { error: `Two questions use the same level chain: ${levels.join(",")}` };
    }
    seenIds.set(id, true);
    questions.push({
      id,
      levels,
      instructions: typeof q.instructions === "string" ? q.instructions.trim().slice(0, 2000) : "",
    });
  }
  if (mode === "argmax" && questions.length === 0) {
    return { error: "At least one question must list a level" };
  }

  const rawThreshold = body.threshold && typeof body.threshold === "object" ? body.threshold : {};
  const question = rawThreshold.question && typeof rawThreshold.question === "object" ? rawThreshold.question : GENERIC_THRESHOLD_QUESTION;
  const cuts = (Array.isArray(rawThreshold.cuts) ? rawThreshold.cuts : GENERIC_THRESHOLD_CUTS)
    .filter((c) => Number.isFinite(Number(c?.max)))
    .map((c) => ({ max: Number(c.max), levels: questionLevels(c) }))
    .filter((c) => c.levels.length > 0)
    .sort((a, b) => a.max - b.max);
  if (mode === "threshold" && cuts.length === 0) {
    return { error: "Threshold mode needs at least one cut with a level" };
  }

  return {
    value: {
      name: nameCheck.value,
      isActive: body.isActive !== false,
      models,
      timeoutMode,
      mode,
      questions,
      threshold: {
        question: {
          // The threshold question has no level chain, so its id is the fixed
          // sentinel — never client input (ids are always server-owned).
          id: GENERIC_THRESHOLD_QUESTION.id,
          instructions: typeof question.instructions === "string" ? question.instructions.trim().slice(0, 2000) : "",
        },
        cuts,
      },
      fallbackLevel: CLASSIFIER_FALLBACK_LEVELS.includes(body.fallbackLevel) ? body.fallbackLevel : "medium",
      timeoutMs,
      inputMode: CLASSIFIER_INPUT_MODES.includes(body.inputMode) ? body.inputMode : DEFAULT_CLASSIFIER_INPUT_MODE,
      tailTurns: clampClassifierTailTurns(body.tailTurns) ?? DEFAULT_CLASSIFIER_TAIL_TURNS,
      tailTokens: clampClassifierTailTokens(body.tailTokens) ?? DEFAULT_CLASSIFIER_TAIL_TOKENS,
    },
  };
}

// GET /api/thinking-classifiers - list profiles
export async function GET() {
  try {
    const classifiers = await getThinkingClassifiers();
    return NextResponse.json({ classifiers });
  } catch (error) {
    console.log("Error fetching thinking classifiers:", error);
    return NextResponse.json({ error: "Failed to fetch thinking classifiers" }, { status: 500 });
  }
}

// POST /api/thinking-classifiers - create profile
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const normalized = normalizeClassifierInput(body);
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const existing = await getThinkingClassifierByName(normalized.value.name);
    if (existing) {
      return NextResponse.json({ error: `Classifier "${normalized.value.name}" already exists` }, { status: 409 });
    }
    const classifier = await createThinkingClassifier(normalized.value);
    return NextResponse.json({ classifier }, { status: 201 });
  } catch (error) {
    console.log("Error creating thinking classifier:", error);
    return NextResponse.json({ error: "Failed to create thinking classifier" }, { status: 500 });
  }
}
