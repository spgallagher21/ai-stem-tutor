import { describe, expect, it } from "vitest";
import { normalizeQuestionBatch } from "./App";

const base = { type: "multiple_choice", question: "What is 6 × 7?", modelAnswer: "42", hint: "Multiply." };

describe("resilient question normalization", () => {
  it("accepts short numerical options and resolves letter answers", () => {
    const [question] = normalizeQuestionBatch([{ ...base, options: ["40", "42", "46", "49"], correct_option: "B" }]);
    expect(question.correct_option).toBe("42");
  });

  it("keeps usable questions when another item is malformed", () => {
    const questions = normalizeQuestionBatch([
      { ...base, options: ["only one"], correct_option: "A" },
      { ...base, options: ["40", "42", "46", "49"], correct_option: "42" },
    ], { expectedCount: 2 });
    expect(questions).toHaveLength(1);
  });
});
