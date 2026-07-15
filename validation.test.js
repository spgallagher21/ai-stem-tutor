import { describe, expect, it } from "vitest";
import { validateGrading, validateLesson, validateQuestion } from "./validation";

describe("AI output validation", () => {
  it("rejects malformed choices", () => expect(() => validateQuestion({ type: "multiple_choice", question: "Q", modelAnswer: "A", options: ["A"], correct_option: "A" })).toThrow());
  it("clamps grading", () => expect(validateGrading({ partial_credit_percent: 150 }).partial_credit_percent).toBe(100));
  it("removes invalid pages", () => expect(validateLesson({ sections: [{ heading: "H", body: "B" }], summary: "S", flagged_image_pages: [{ page: 9 }] }, [1, 2]).flagged_image_pages).toHaveLength(0));
});
