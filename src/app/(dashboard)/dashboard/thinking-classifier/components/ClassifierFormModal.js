"use client";

import { useMemo } from "react";
import { Button, Input, Modal, Select, Toggle } from "@/shared/components";
import {
  CLASSIFIER_LEVELS,
  CLASSIFIER_MODES,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  GENERIC_ARGMAX_QUESTIONS,
  GENERIC_THRESHOLD_QUESTION,
  GENERIC_THRESHOLD_CUTS,
  MAX_CLASSIFIER_TIMEOUT_MS,
  MIN_CLASSIFIER_TIMEOUT_MS,
} from "@/shared/constants/thinkingClassifier";

// Editable form state seeded from a profile (or the generic template).
export function classifierToForm(classifier = {}) {
  const mode = CLASSIFIER_MODES.includes(classifier.mode) ? classifier.mode : "argmax";
  const questions = Array.isArray(classifier.questions) && classifier.questions.length > 0
    ? classifier.questions.map((q) => ({
        id: q.id || "",
        level: CLASSIFIER_LEVELS.includes(q.level) ? q.level : CLASSIFIER_LEVELS[0],
        instructions: q.instructions || "",
      }))
    : GENERIC_ARGMAX_QUESTIONS.map((q) => ({ ...q }));
  const threshold = classifier.threshold && typeof classifier.threshold === "object"
    ? {
        question: {
          id: classifier.threshold.question?.id || GENERIC_THRESHOLD_QUESTION.id,
          instructions: classifier.threshold.question?.instructions || GENERIC_THRESHOLD_QUESTION.instructions,
        },
        cuts: Array.isArray(classifier.threshold.cuts) && classifier.threshold.cuts.length > 0
          ? classifier.threshold.cuts.map((c) => ({ max: Number(c.max), level: CLASSIFIER_LEVELS.includes(c.level) ? c.level : "medium" }))
          : GENERIC_THRESHOLD_CUTS.map((c) => ({ ...c })),
      }
    : {
        question: { ...GENERIC_THRESHOLD_QUESTION },
        cuts: GENERIC_THRESHOLD_CUTS.map((c) => ({ ...c })),
      };
  return {
    name: classifier.name || "",
    model: classifier.model || "",
    mode,
    isActive: classifier.isActive !== false,
    questions,
    threshold,
    fallbackLevel: CLASSIFIER_LEVELS.includes(classifier.fallbackLevel) ? classifier.fallbackLevel : "medium",
    timeoutMs: Number.isFinite(classifier.timeoutMs) ? classifier.timeoutMs : DEFAULT_CLASSIFIER_TIMEOUT_MS,
  };
}

const LEVEL_OPTIONS = CLASSIFIER_LEVELS.map((level) => ({ value: level, label: level.charAt(0).toUpperCase() + level.slice(1) }));

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

  const setQuestion = (index, patch) => {
    set({ questions: form.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  };

  const setCut = (index, patch) => {
    set({
      threshold: {
        ...form.threshold,
        cuts: form.threshold.cuts.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      },
    });
  };

  const payload = useMemo(() => ({
    name: form.name.trim(),
    model: form.model,
    mode: form.mode,
    isActive: form.isActive,
    questions: form.questions.map((q) => ({
      id: q.id.trim(),
      level: q.level,
      instructions: q.instructions.trim(),
    })),
    threshold: {
      question: {
        id: form.threshold.question.id.trim(),
        instructions: form.threshold.question.instructions.trim(),
      },
      cuts: form.threshold.cuts.map((c) => ({ max: Number(c.max), level: c.level })),
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
          <Button onClick={() => onSave(payload)} loading={saving} disabled={!payload.name || !payload.model}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Tier name"
            required
            placeholder="generic"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            hint="Lowercase letters, digits, - or _. Clients send this as their effort value."
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">Classifier model</label>
            <div className="flex gap-2">
              <Input
                value={form.model}
                onChange={(e) => set({ model: e.target.value })}
                placeholder="oc/jev-1.13-free"
                className="flex-1"
              />
              <Button variant="secondary" onClick={onPickModel} className="shrink-0">Pick</Button>
            </div>
          </div>
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
            options={LEVEL_OPTIONS}
          />
          <Input
            label="Timeout (ms)"
            type="number"
            min={MIN_CLASSIFIER_TIMEOUT_MS}
            max={MAX_CLASSIFIER_TIMEOUT_MS}
            value={form.timeoutMs}
            onChange={(e) => set({ timeoutMs: e.target.value })}
          />
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
                One probability question per level; the highest answer wins.
              </p>
            </div>
            {form.questions.map((q, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-[10px] border border-border-subtle p-3 sm:flex-row sm:items-start">
                <Select
                  className="sm:w-36"
                  value={q.level}
                  onChange={(e) => setQuestion(i, { level: e.target.value })}
                  options={LEVEL_OPTIONS}
                />
                <Input
                  className="flex-1"
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
              onClick={() => set({ questions: [...form.questions, { id: `level_${Date.now()}`, level: "medium", instructions: "" }] })}
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
              </p>
            </div>
            <Input
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
                <Select
                  className="w-36"
                  value={c.level}
                  onChange={(e) => setCut(i, { level: e.target.value })}
                  options={LEVEL_OPTIONS}
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
              onClick={() => set({ threshold: { ...form.threshold, cuts: [...form.threshold.cuts, { max: 1, level: "medium" }] } })}
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
