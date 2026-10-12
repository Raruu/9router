"use client";

import { useMemo } from "react";
import { Button, Input, Modal, Select, Toggle } from "@/shared/components";
import {
  CLASSIFIER_FALLBACK_LEVELS,
  CLASSIFIER_MODES,
  CLASSIFIER_TIMEOUT_MODES,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  DEFAULT_CLASSIFIER_TIMEOUT_MODE,
  GENERIC_ARGMAX_QUESTIONS,
  GENERIC_THRESHOLD_QUESTION,
  GENERIC_THRESHOLD_CUTS,
  MAX_CLASSIFIER_MODELS,
  MAX_CLASSIFIER_TIMEOUT_MS,
  MIN_CLASSIFIER_TIMEOUT_MS,
  clampClassifierTimeout,
  normalizeClassifierModels,
  parseLevelList,
  questionLevels,
  questionIdFromLevels,
} from "@/shared/constants/thinkingClassifier";

// Editable form state seeded from a profile (or the generic template).
export function classifierToForm(classifier = {}) {
  const mode = CLASSIFIER_MODES.includes(classifier.mode) ? classifier.mode : "argmax";
  const timeoutMs = clampClassifierTimeout(classifier.timeoutMs) ?? DEFAULT_CLASSIFIER_TIMEOUT_MS;
  // One row per model, tried in order as fallbacks.
  const models = (() => {
    const list = normalizeClassifierModels(
      classifier.models !== undefined ? classifier.models : classifier.model,
      timeoutMs,
    );
    return list.length > 0 ? list : [{ model: "", timeoutMs }];
  })();
  const questions = Array.isArray(classifier.questions) && classifier.questions.length > 0
    ? classifier.questions.map((q) => ({
        // The id is derived from the levels on save, so the form never carries it.
        levelsText: questionLevels(q).join(","),
        instructions: q.instructions || "",
      }))
    : GENERIC_ARGMAX_QUESTIONS.map((q) => ({ levelsText: q.levels.join(","), instructions: q.instructions }));
  const threshold = classifier.threshold && typeof classifier.threshold === "object"
    ? {
        question: {
          id: classifier.threshold.question?.id || GENERIC_THRESHOLD_QUESTION.id,
          instructions: classifier.threshold.question?.instructions || GENERIC_THRESHOLD_QUESTION.instructions,
        },
        cuts: Array.isArray(classifier.threshold.cuts) && classifier.threshold.cuts.length > 0
          ? classifier.threshold.cuts.map((c) => ({ max: Number(c.max), levelsText: questionLevels(c).join(",") }))
          : GENERIC_THRESHOLD_CUTS.map((c) => ({ max: c.max, levelsText: c.levels.join(",") })),
      }
    : {
        question: { ...GENERIC_THRESHOLD_QUESTION },
        cuts: GENERIC_THRESHOLD_CUTS.map((c) => ({ max: c.max, levelsText: c.levels.join(",") })),
      };
  return {
    name: classifier.name || "",
    models,
    timeoutMode: CLASSIFIER_TIMEOUT_MODES.includes(classifier.timeoutMode)
      ? classifier.timeoutMode
      : DEFAULT_CLASSIFIER_TIMEOUT_MODE,
    mode,
    isActive: classifier.isActive !== false,
    questions,
    threshold,
    fallbackLevel: CLASSIFIER_FALLBACK_LEVELS.includes(classifier.fallbackLevel) ? classifier.fallbackLevel : "medium",
    timeoutMs,
  };
}

const FALLBACK_OPTIONS = CLASSIFIER_FALLBACK_LEVELS.map((level) => ({ value: level, label: level.charAt(0).toUpperCase() + level.slice(1) }));

export default function ClassifierFormModal({
  isOpen,
  onClose,
  onSave,
  form,
  onChange,
  saving = false,
  onPickModel,
}) {
  const set = (patch) => onChange({ ...form, ...patch });
  const perModelTimeout = form.timeoutMode === "per-model";

  const setQuestion = (index, patch) => {
    set({ questions: form.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  };

  // Duplicate level chains are rejected by the server; mirror that here so the
  // offending rows are marked before the user hits Save. Keyed by the derived
  // id (the chain joined), the same value the server computes.
  const questionIdErrors = useMemo(() => {
    const counts = new Map();
    for (const q of form.questions) {
      const id = questionIdFromLevels(q.levelsText);
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [form.questions]);

  const questionError = (q) => {
    const id = questionIdFromLevels(q.levelsText);
    if (!id) return "List at least one level";
    if (questionIdErrors.get(id) > 1) return `Duplicate level chain: ${id}`;
    return null;
  };

  const argmaxInvalid = form.mode === "argmax" && form.questions.some((q) => questionError(q));

  const setCut = (index, patch) => {
    set({
      threshold: {
        ...form.threshold,
        cuts: form.threshold.cuts.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      },
    });
  };

  const setModelRow = (index, patch) => {
    set({ models: form.models.map((m, i) => (i === index ? { ...m, ...patch } : m)) });
  };

  const addModelRow = (model) => {
    const value = typeof model === "string" ? model : model?.value;
    if (!value) return;
    set({ models: normalizeClassifierModels([...form.models, { model: value, timeoutMs: form.timeoutMs }], form.timeoutMs) });
  };

  const removeModelRow = (index) => {
    const next = form.models.filter((_, i) => i !== index);
    set({ models: next.length > 0 ? next : [{ model: "", timeoutMs: form.timeoutMs }] });
  };

  const moveModelRow = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= form.models.length) return;
    const next = [...form.models];
    [next[index], next[target]] = [next[target], next[index]];
    set({ models: next });
  };

  const payload = useMemo(() => ({
    name: form.name.trim(),
    models: form.models
      .map((m) => ({ model: String(m.model || "").trim(), timeoutMs: Number(m.timeoutMs) || form.timeoutMs }))
      .filter((m) => m.model),
    timeoutMode: form.timeoutMode,
    mode: form.mode,
    isActive: form.isActive,
    questions: form.questions.map((q) => ({
      levels: parseLevelList(q.levelsText),
      instructions: q.instructions.trim(),
    })),
    threshold: {
      question: {
        id: form.threshold.question.id.trim(),
        instructions: form.threshold.question.instructions.trim(),
      },
      cuts: form.threshold.cuts.map((c) => ({ max: Number(c.max), levels: parseLevelList(c.levelsText) })),
    },
    fallbackLevel: form.fallbackLevel,
    timeoutMs: Number(form.timeoutMs) || DEFAULT_CLASSIFIER_TIMEOUT_MS,
  }), [form]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={form.name ? `Edit classifier "${form.name}"` : "New thinking classifier"}
      size="full"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => onSave(payload)} loading={saving} disabled={!payload.name || payload.models.length === 0 || argmaxInvalid}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
        <Input
          label="Tier name"
          required
          placeholder="generic"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          hint="Lowercase letters, digits, - or _. Clients send this as their effort value."
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-text-main">Classifier models</p>
              <p className="text-xs text-text-muted">
                Tried in order — the next model is used when one fails or returns no decision.
              </p>
            </div>
            <Button variant="secondary" size="sm" icon="add" onClick={onPickModel} className="shrink-0">
              Add model
            </Button>
          </div>
          {form.models.map((m, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-[10px] border border-border-subtle p-3 sm:flex-row sm:items-center">
              <span className="text-[10px] font-medium text-text-muted w-4 text-center shrink-0">{i + 1}</span>
              <Input
                className="flex-1"
                value={m.model}
                onChange={(e) => setModelRow(i, { model: e.target.value })}
                placeholder="oc/jev-1.13-free"
              />
              {perModelTimeout && (
                <Input
                  className="sm:w-32"
                  type="number"
                  min={MIN_CLASSIFIER_TIMEOUT_MS}
                  max={MAX_CLASSIFIER_TIMEOUT_MS}
                  value={m.timeoutMs}
                  onChange={(e) => setModelRow(i, { timeoutMs: e.target.value })}
                  title="Timeout for this model (ms)"
                />
              )}
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" icon="arrow_upward" onClick={() => moveModelRow(i, -1)} disabled={i === 0} title="Move up" />
                <Button variant="ghost" size="sm" icon="arrow_downward" onClick={() => moveModelRow(i, 1)} disabled={i === form.models.length - 1} title="Move down" />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="delete"
                  onClick={() => removeModelRow(i)}
                  disabled={form.models.length <= 1}
                  title="Remove"
                />
              </div>
            </div>
          ))}
          {form.models.length >= MAX_CLASSIFIER_MODELS && (
            <p className="text-xs text-text-muted">Maximum {MAX_CLASSIFIER_MODELS} models.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select
            label="Mode"
            value={form.mode}
            onChange={(e) => set({ mode: e.target.value })}
            options={[
              { value: "argmax", label: "Per-level questions (argmax)" },
              { value: "threshold", label: "Single score + thresholds" },
            ]}
          />
          <Select
            label="Fallback level"
            value={form.fallbackLevel}
            onChange={(e) => set({ fallbackLevel: e.target.value })}
            options={FALLBACK_OPTIONS}
          />
          <Select
            label="Timeout mode"
            value={form.timeoutMode}
            onChange={(e) => set({ timeoutMode: e.target.value })}
            options={[
              { value: "uniform", label: "Same for every model" },
              { value: "per-model", label: "Per model" },
            ]}
          />
          {!perModelTimeout && (
            <Input
              label="Timeout (ms)"
              type="number"
              min={MIN_CLASSIFIER_TIMEOUT_MS}
              max={MAX_CLASSIFIER_TIMEOUT_MS}
              value={form.timeoutMs}
              onChange={(e) => set({ timeoutMs: e.target.value })}
              hint="Applied to each model attempt"
            />
          )}
        </div>

        <Toggle
          checked={form.isActive}
          onChange={(v) => set({ isActive: v })}
          label="Active"
          description="Active classifiers are advertised in every reasoning model's effort_tiers and accepted as an effort value."
        />

        {form.mode === "argmax" ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-text-main">Questions</p>
              <p className="text-xs text-text-muted">
                One probability question per level; the highest answer wins. Level may be a
                comma-separated chain (e.g. <code className="font-mono">max,xhigh,high</code>) — the
                first level the target supports is sent.
              </p>
            </div>
            {form.questions.map((q, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-[10px] border border-border-subtle p-3 sm:flex-row sm:items-start">
                <Input
                  className="sm:w-40"
                  value={q.levelsText}
                  onChange={(e) => setQuestion(i, { levelsText: e.target.value })}
                  placeholder="high,xhigh"
                  error={questionError(q)}
                  hint={questionError(q) ? undefined : (questionIdFromLevels(q.levelsText) ? `id: ${questionIdFromLevels(q.levelsText)}` : undefined)}
                />
                <Input
                  className="flex-1"
                  multiline
                  rows={2}
                  value={q.instructions}
                  onChange={(e) => setQuestion(i, { instructions: e.target.value })}
                  placeholder="Question text sent to the decision model"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="delete"
                  onClick={() => set({ questions: form.questions.filter((_, idx) => idx !== i) })}
                  disabled={form.questions.length <= 1}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon="add"
              onClick={() => set({ questions: [...form.questions, { levelsText: "", instructions: "" }] })}
            >
              Add question
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-text-main">Complexity question</p>
              <p className="text-xs text-text-muted">
                One 0–1 score question; the first cut whose max the score is ≤ decides the level.
                Each cut may list a comma-separated chain — the first supported level is sent.
              </p>
            </div>
            <Input
              multiline
              rows={3}
              value={form.threshold.question.instructions}
              onChange={(e) => set({ threshold: { ...form.threshold, question: { ...form.threshold.question, instructions: e.target.value } } })}
              placeholder="Question text sent to the decision model"
            />
            {form.threshold.cuts.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-text-muted w-16">≤ score</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={c.max}
                  onChange={(e) => setCut(i, { max: e.target.value })}
                  className="w-28"
                />
                <span className="text-xs text-text-muted">→</span>
                <Input
                  className="w-40"
                  value={c.levelsText}
                  onChange={(e) => setCut(i, { levelsText: e.target.value })}
                  placeholder="high,xhigh"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="delete"
                  onClick={() => set({ threshold: { ...form.threshold, cuts: form.threshold.cuts.filter((_, idx) => idx !== i) } })}
                  disabled={form.threshold.cuts.length <= 1}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon="add"
              onClick={() => set({ threshold: { ...form.threshold, cuts: [...form.threshold.cuts, { max: 1, levelsText: "medium" }] } })}
            >
              Add cut
            </Button>
          </div>
        )}

        <p className="text-xs text-text-muted">
          The last user message of each request that selects this tier is sent to the classifier model above.
          If classification fails, requests fall back to the fallback level.
        </p>
      </div>
    </Modal>
  );
}
