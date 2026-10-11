// Thinking Effort Classifier — constants, answer mapping and effort-field I/O.
// Pure logic only; the DB-backed repo is covered by thinking-classifiers-repo.test.js.
import { describe, it, expect } from "vitest";

import {
  RESERVED_EFFORT_VALUES,
  CLASSIFIER_LEVELS,
  validateClassifierName,
  genericClassifierTemplate,
  buildClassifierQuestions,
  resolveClassifierLevel,
} from "../../src/shared/constants/thinkingClassifier.js";
import {
  readEffortField,
  writeEffortField,
  extractPromptText,
} from "../../src/sse/services/thinkingClassifier.js";

describe("classifier name validation", () => {
  it("accepts lowercase names with digits, dash and underscore", () => {
    for (const name of ["generic", "laya", "jev", "my_tier-2"]) {
      expect(validateClassifierName(name)).toEqual({ ok: true, value: name });
    }
  });

  it("rejects reserved effort values", () => {
    for (const name of ["low", "high", "max", "none", "auto", "xhigh", "ultra"]) {
      expect(RESERVED_EFFORT_VALUES).toContain(name);
      const result = validateClassifierName(name);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("reserved");
    }
  });

  it("rejects invalid shapes and empty input", () => {
    for (const name of ["", "  ", "Upper", "has space", "-leading", "a".repeat(33)]) {
      expect(validateClassifierName(name).ok).toBe(false);
    }
  });
});

describe("buildClassifierQuestions", () => {
  it("builds one noul question per argmax entry", () => {
    const questions = buildClassifierQuestions({
      mode: "argmax",
      questions: [
        { id: "q_low", level: "low", instructions: "simple?" },
        { id: "q_high", level: "high", instructions: "complex?" },
      ],
    });
    expect(questions).toEqual({
      q_low: { type: "noul", instructions: "simple?" },
      q_high: { type: "noul", instructions: "complex?" },
    });
  });

  it("builds the single threshold question", () => {
    const questions = buildClassifierQuestions({
      mode: "threshold",
      threshold: { question: { id: "complexity", instructions: "how hard?" } },
    });
    expect(questions).toEqual({ complexity: { type: "noul", instructions: "how hard?" } });
  });

  it("returns null when the profile carries nothing usable", () => {
    expect(buildClassifierQuestions({ mode: "argmax", questions: [] })).toBeNull();
    expect(buildClassifierQuestions({ mode: "threshold", threshold: {} })).toBeNull();
  });

  it("the generic template builds a full argmax question set", () => {
    const template = genericClassifierTemplate();
    const questions = buildClassifierQuestions(template);
    expect(Object.keys(questions)).toHaveLength(template.questions.length);
    for (const key of Object.keys(questions)) {
      expect(questions[key].type).toBe("noul");
    }
  });
});

describe("resolveClassifierLevel", () => {
  const argmaxProfile = {
    mode: "argmax",
    questions: [
      { id: "q_min", level: "minimal" },
      { id: "q_low", level: "low" },
      { id: "q_max", level: "max" },
    ],
  };

  it("picks the highest-probability level", () => {
    expect(resolveClassifierLevel(argmaxProfile, {
      q_min: { noul: 0.1 }, q_low: { noul: 0.7 }, q_max: { noul: 0.2 },
    })).toBe("low");
  });

  it("ignores entries with non-numeric answers", () => {
    expect(resolveClassifierLevel(argmaxProfile, {
      q_min: { noul: 0.9 }, q_low: { noul: "junk" }, q_max: { noul: 0.5 },
    })).toBe("minimal");
  });

  it("returns null when nothing is usable", () => {
    expect(resolveClassifierLevel(argmaxProfile, null)).toBeNull();
    expect(resolveClassifierLevel(argmaxProfile, {})).toBeNull();
  });

  it("threshold mode walks ascending cuts", () => {
    const thresholdProfile = {
      mode: "threshold",
      threshold: {
        question: { id: "complexity" },
        cuts: [
          { max: 0.2, level: "minimal" },
          { max: 0.5, level: "low" },
          { max: 0.8, level: "high" },
          { max: 1, level: "max" },
        ],
      },
    };
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 0.1 } })).toBe("minimal");
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 0.5 } })).toBe("low");
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 0.95 } })).toBe("max");
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 1.4 } })).toBeNull();
  });
});

describe("readEffortField / writeEffortField", () => {
  it("reads the four client shapes in extractThinking priority order", () => {
    expect(readEffortField({ output_config: { effort: "Laya" } })).toEqual({ field: "output_config.effort", value: "laya" });
    expect(readEffortField({ reasoning_effort: "jev" })).toEqual({ field: "reasoning_effort", value: "jev" });
    expect(readEffortField({ reasoning: { effort: "generic" } })).toEqual({ field: "reasoning.effort", value: "generic" });
    expect(readEffortField({ thinkingConfig: { thinkingLevel: "my_tier" } })).toEqual({ field: "thinkingConfig.thinkingLevel", value: "my_tier" });
    expect(readEffortField({ generationConfig: { thinkingConfig: { thinkingLevel: "tier_a" } } })).toEqual({ field: "generationConfig.thinkingConfig.thinkingLevel", value: "tier_a" });
  });

  it("prefers output_config.effort over reasoning_effort", () => {
    const body = { output_config: { effort: "first" }, reasoning_effort: "second" };
    expect(readEffortField(body).value).toBe("first");
  });

  it("ignores non-string efforts and Claude thinking objects", () => {
    expect(readEffortField({ thinking: { type: "enabled", budget_tokens: 1000 } })).toBeNull();
    expect(readEffortField({ reasoning_effort: 3 })).toBeNull();
    expect(readEffortField({})).toBeNull();
    expect(readEffortField(null)).toBeNull();
  });

  it("writes back to the exact field the client used", () => {
    const body = { reasoning: { effort: "laya" } };
    expect(writeEffortField(body, "reasoning.effort", "low")).toBe(true);
    expect(body.reasoning.effort).toBe("low");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("returns false for an unknown field id", () => {
    expect(writeEffortField({}, "nope", "low")).toBe(false);
  });
});

describe("extractPromptText", () => {
  it("takes the last user message across shapes", () => {
    expect(extractPromptText({ messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "last" },
    ] })).toBe("last");
    expect(extractPromptText({ messages: [{ role: "user", content: [{ type: "text", text: "blocks" }] }] })).toBe("blocks");
    expect(extractPromptText({ contents: [{ parts: [{ text: "gemini" }] }] })).toBe("gemini");
    expect(extractPromptText({ input: [{ role: "user", content: [{ type: "input_text", text: "responses" }] }] })).toBe("responses");
  });

  it("returns an empty string when there is no user text", () => {
    expect(extractPromptText({})).toBe("");
    expect(extractPromptText({ messages: [{ role: "assistant", content: "hi" }] })).toBe("");
  });
});

describe("CLASSIFIER_LEVELS", () => {
  it("stays in canonical ascending order", () => {
    expect(CLASSIFIER_LEVELS).toEqual(["minimal", "low", "medium", "high", "max"]);
  });
});
