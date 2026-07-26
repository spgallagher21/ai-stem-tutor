import { describe, expect, it } from "vitest";
import { normalizePracticeTypes, questionCountForLesson, questionTypeInstructions, recentLowScoreStreak } from "./practiceEngine";

describe("practice session planning", () => {
  it("uses lesson breadth and difficulty to size the session", () => {
    const small = questionCountForLesson({ sections: [{ key_points: [] }] }, 1);
    const large = questionCountForLesson({ sections: Array.from({ length: 9 }, () => ({ key_points: ["a", "b", "c"] })) }, 5);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(8);
  });
  it("keeps the first set short before advancing to harder work", () => {
    expect(questionTypeInstructions(["all"], "short").allowedTypes).toEqual(["multiple_choice", "fill_blank", "short_answer"]);
    expect(questionTypeInstructions(["all"], "hard").allowedTypes).toContain("long_answer");
  });
  it("honours explicit image and exam selections", () => {
    const plan = questionTypeInstructions(["image_based", "exam_long"], "hard");
    expect(plan.needsImage).toBe(true);
    expect(plan.needsExamStyle).toBe(true);
  });
  it("counts consecutive weak attempts from most recent", () => {
    const bank = [{ attempts: [{ partial_credit_percent: 40, gradedAt: 3 }] }, { attempts: [{ partial_credit_percent: 30, gradedAt: 2 }] }, { attempts: [{ partial_credit_percent: 90, gradedAt: 1 }] }];
    expect(recentLowScoreStreak(bank)).toBe(2);
  });
  it("normalises an empty selection to all", () => expect(normalizePracticeTypes([])).toEqual(["all"]));
});

