// Thinking Effort Classifier — constants, answer mapping and effort-field I/O.
// Pure logic only; the DB-backed repo is covered by thinking-classifiers-repo.test.js.
import { describe, it, expect } from "vitest";

import {
  RESERVED_EFFORT_VALUES,
  CLASSIFIER_FALLBACK_LEVELS,
  validateClassifierName,
  genericClassifierTemplate,
  buildClassifierQuestions,
  resolveClassifierLevel,
  resolveClassifierScores,
  parseLevelList,
  questionLevels,
  pickFirstSupported,
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
      { id: "q_min", levels: ["minimal"] },
      { id: "q_low", levels: ["low"] },
      { id: "q_max", levels: ["max", "xhigh", "high"] },
    ],
  };

  it("returns the winning question's level chain", () => {
    expect(resolveClassifierLevel(argmaxProfile, {
      q_min: { noul: 0.1 }, q_low: { noul: 0.7 }, q_max: { noul: 0.2 },
    })).toEqual(["low"]);
    expect(resolveClassifierLevel(argmaxProfile, {
      q_min: { noul: 0.1 }, q_low: { noul: 0.2 }, q_max: { noul: 0.8 },
    })).toEqual(["max", "xhigh", "high"]);
  });

  it("reads the legacy single `level` field too", () => {
    expect(resolveClassifierLevel({
      mode: "argmax",
      questions: [{ id: "q_low", level: "low" }],
    }, { q_low: { noul: 0.9 } })).toEqual(["low"]);
  });

  it("ignores entries with non-numeric answers", () => {
    expect(resolveClassifierLevel(argmaxProfile, {
      q_min: { noul: 0.9 }, q_low: { noul: "junk" }, q_max: { noul: 0.5 },
    })).toEqual(["minimal"]);
  });

  it("returns an empty chain when nothing is usable", () => {
    expect(resolveClassifierLevel(argmaxProfile, null)).toEqual([]);
    expect(resolveClassifierLevel(argmaxProfile, {})).toEqual([]);
    expect(resolveClassifierLevel({ mode: "argmax", questions: [{ id: "q", levels: [] }] }, { q: { noul: 1 } })).toEqual([]);
  });

  it("threshold mode walks ascending cuts and returns their chains", () => {
    const thresholdProfile = {
      mode: "threshold",
      threshold: {
        question: { id: "complexity" },
        cuts: [
          { max: 0.2, levels: ["minimal"] },
          { max: 0.5, levels: ["low", "minimal"] },
          { max: 0.8, levels: ["high"] },
          { max: 1, levels: ["max", "xhigh"] },
        ],
      },
    };
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 0.1 } })).toEqual(["minimal"]);
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 0.5 } })).toEqual(["low", "minimal"]);
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 0.95 } })).toEqual(["max", "xhigh"]);
    expect(resolveClassifierLevel(thresholdProfile, { complexity: { noul: 1.4 } })).toEqual([]);
  });
});

describe("resolveClassifierScores", () => {
  const argmaxProfile = {
    mode: "argmax",
    questions: [
      { id: "q_min", levels: ["minimal"] },
      { id: "q_low", levels: ["low"] },
      { id: "q_max", levels: ["max", "xhigh"] },
    ],
  };

  it("lists every scored question, highest first (winner leads)", () => {
    expect(resolveClassifierScores(argmaxProfile, {
      q_min: { noul: 0.1 }, q_low: { noul: 0.7 }, q_max: { noul: 0.2 },
    })).toEqual([
      { level: "low", score: 0.7 },
      { level: "max", score: 0.2 },
      { level: "minimal", score: 0.1 },
    ]);
  });

  it("uses the chain's primary level as the entry's label", () => {
    expect(resolveClassifierScores(argmaxProfile, { q_max: { noul: 0.9 } }))
      .toEqual([{ level: "max", score: 0.9 }]);
  });

  it("skips non-numeric answers and questions with no level", () => {
    expect(resolveClassifierScores({
      mode: "argmax",
      questions: [
        { id: "q_a", levels: ["high"] },
        { id: "q_b", levels: [] },
        { id: "q_c", levels: ["low"] },
      ],
    }, { q_a: { noul: "junk" }, q_b: { noul: 0.9 }, q_c: { noul: 0.4 } }))
      .toEqual([{ level: "low", score: 0.4 }]);
  });

  it("returns a single complexity score in threshold mode", () => {
    const thresholdProfile = {
      mode: "threshold",
      threshold: {
        question: { id: "complexity" },
        cuts: [
          { max: 0.2, levels: ["minimal"] },
          { max: 0.8, levels: ["high", "medium"] },
          { max: 1, levels: ["max"] },
        ],
      },
    };
    expect(resolveClassifierScores(thresholdProfile, { complexity: { noul: 0.6 } }))
      .toEqual([{ level: "high", score: 0.6 }]);
  });

  it("returns an empty list when nothing is usable", () => {
    expect(resolveClassifierScores(argmaxProfile, null)).toEqual([]);
    expect(resolveClassifierScores(argmaxProfile, {})).toEqual([]);
    expect(resolveClassifierScores({ mode: "threshold", threshold: { cuts: [] } }, { complexity: { noul: 0.5 } })).toEqual([]);
    expect(resolveClassifierScores({ mode: "threshold", threshold: { question: { id: "c" }, cuts: [{ max: 1, levels: ["high"] }] } }, { complexity: { noul: 5 } })).toEqual([]);
  });
});

describe("parseLevelList", () => {
  it("parses a comma-separated chain", () => {
    expect(parseLevelList("high,xhigh")).toEqual(["high", "xhigh"]);
    expect(parseLevelList(" low , none ")).toEqual(["low", "none"]);
  });

  it("accepts arrays and normalizes case, duplicates and empties", () => {
    expect(parseLevelList(["HIGH", "high", "", " xhigh "])).toEqual(["high", "xhigh"]);
    expect(parseLevelList([])).toEqual([]);
    expect(parseLevelList(null)).toEqual([]);
    expect(parseLevelList(42)).toEqual([]);
  });

  it("caps the chain length and token length", () => {
    expect(parseLevelList(Array.from({ length: 40 }, (_, i) => `l${i}`))).toHaveLength(16);
    expect(parseLevelList(["a".repeat(80)])[0]).toHaveLength(32);
  });

  it("keeps unknown values — no vocabulary check", () => {
    expect(parseLevelList("hyper,high")).toEqual(["hyper", "high"]);
  });
});

describe("questionLevels", () => {
  it("prefers `levels` and falls back to the legacy `level`", () => {
    expect(questionLevels({ levels: ["max", "high"] })).toEqual(["max", "high"]);
    expect(questionLevels({ level: "high" })).toEqual(["high"]);
    expect(questionLevels({ levels: ["x"], level: "high" })).toEqual(["x"]);
    expect(questionLevels(null)).toEqual([]);
  });
});

describe("pickFirstSupported", () => {
  it("picks the first candidate the target supports", () => {
    expect(pickFirstSupported(["max", "xhigh", "high"], ["low", "medium", "high"])).toBe("high");
    expect(pickFirstSupported(["high", "xhigh"], ["xhigh"])).toBe("xhigh");
  });

  it("sends the first candidate when the target supports none of them", () => {
    expect(pickFirstSupported(["max", "xhigh"], ["low", "medium"])).toBe("max");
  });

  it("sends the first candidate when there is no level information", () => {
    expect(pickFirstSupported(["max", "high"], null)).toBe("max");
    expect(pickFirstSupported(["max", "high"], [])).toBe("max");
  });

  it("treats auto as always supported", () => {
    expect(pickFirstSupported(["auto"], ["low"])).toBe("auto");
    expect(pickFirstSupported(["high", "auto"], ["low"])).toBe("auto");
  });

  it("returns null for an empty chain", () => {
    expect(pickFirstSupported([], ["low"])).toBeNull();
    expect(pickFirstSupported(null, ["low"])).toBeNull();
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

describe("CLASSIFIER_FALLBACK_LEVELS", () => {
  it("covers the wider value set a chain may name", () => {
    expect(CLASSIFIER_FALLBACK_LEVELS).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max", "auto"]);
  });
});
