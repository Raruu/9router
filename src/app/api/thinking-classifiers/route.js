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
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  MIN_CLASSIFIER_TIMEOUT_MS,
  MAX_CLASSIFIER_TIMEOUT_MS,
  GENERIC_ARGMAX_QUESTIONS,
  GENERIC_THRESHOLD_QUESTION,
  GENERIC_THRESHOLD_CUTS,
  parseLevelList,
  questionLevels,
} from "@/shared/constants/thinkingClassifier.js";

// Validate a create/update payload. Unknown fields are dropped rather than
// merged blindly — the profile is interpolated into upstream request bodies.
export function normalizeClassifierInput(body = {}) {
  const nameCheck = validateClassifierName(body.name);
  if (!nameCheck.ok) return { error: nameCheck.error };

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return { error: "Classifier model is required" };

  const mode = CLASSIFIER_MODES.includes(body.mode) ? body.mode : "argmax";

  const rawQuestions = Array.isArray(body.questions) ? body.questions : GENERIC_ARGMAX_QUESTIONS;
  const questions = rawQuestions
    .filter((q) => q && typeof q.id === "string" && q.id.trim())
    .slice(0, 32)
    .map((q) => ({
      id: q.id.trim().slice(0, 64),
      levels: questionLevels(q),
      instructions: typeof q.instructions === "string" ? q.instructions.trim().slice(0, 2000) : "",
    }));
  if (mode === "argmax" && questions.filter((q) => q.levels.length > 0).length === 0) {
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

  const timeout = Number(body.timeoutMs);
  const timeoutMs = Number.isFinite(timeout)
    ? Math.min(MAX_CLASSIFIER_TIMEOUT_MS, Math.max(MIN_CLASSIFIER_TIMEOUT_MS, Math.round(timeout)))
    : DEFAULT_CLASSIFIER_TIMEOUT_MS;

  return {
    value: {
      name: nameCheck.value,
      isActive: body.isActive !== false,
      model,
      mode,
      questions,
      threshold: {
        question: {
          id: typeof question.id === "string" && question.id.trim() ? question.id.trim().slice(0, 64) : "complexity",
          instructions: typeof question.instructions === "string" ? question.instructions.trim().slice(0, 2000) : "",
        },
        cuts,
      },
      fallbackLevel: CLASSIFIER_FALLBACK_LEVELS.includes(body.fallbackLevel) ? body.fallbackLevel : "medium",
      timeoutMs,
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
