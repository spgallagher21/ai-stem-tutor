import { describe, expect, it } from "vitest";
import { groupQuestionBank, mergeStoredQuestionBanks, normalizePracticeTypes, questionCountForLesson, questionTypeInstructions, questionsForPracticeSession, recentLowScoreStreak, restorePracticeSession } from "./practiceEngine";

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
  it("keeps a new study session separate while retaining older questions", () => {
    const bank = [
      { id: "old-short", practiceSessionId: "old", practiceStage: "short" },
      { id: "new-short", practiceSessionId: "new", practiceStage: "short" },
      { id: "new-hard", practiceSessionId: "new", practiceStage: "hard" },
    ];
    expect(questionsForPracticeSession(bank, { sessionId: "new", stage: "short" }).map((question) => question.id)).toEqual(["new-short"]);
    expect(bank).toHaveLength(3);
  });
  it("separates the current, upcoming, and answered questions", () => {
    const bank = [
      { id: "answered", createdAt: 1, attempts: [{ correct: true }] },
      { id: "current", createdAt: 2, attempts: [] },
      { id: "upcoming", createdAt: 3, attempts: [] },
    ];
    const groups = groupQuestionBank(bank, "current");
    expect(groups.current.map((question) => question.id)).toEqual(["current"]);
    expect(groups.upcoming.map((question) => question.id)).toEqual(["upcoming"]);
    expect(groups.answered.map((question) => question.id)).toEqual(["answered"]);
  });
  it("restores the newest session that still has unanswered questions", () => {
    const bank = [
      { id: "older-unseen", createdAt: 1, attempts: [], practiceSessionId: "older", practiceStage: "short", practiceSelection: ["multiple_choice"] },
      { id: "current-done", createdAt: 2, attempts: [{ gradedAt: 3 }], practiceSessionId: "current", practiceStage: "short", practiceSelection: ["short_explain"] },
      { id: "current-next", createdAt: 4, attempts: [], practiceSessionId: "current", practiceStage: "short", practiceSelection: ["short_explain"] },
    ];
    const restored = restorePracticeSession(bank, { subjectId: "module", lessonId: "lesson" });
    expect(restored.question.id).toBe("current-next");
    expect(restored.config).toMatchObject({ subjectId: "module", lessonId: "lesson", sessionId: "current", types: ["short_explain"], stage: "short" });
  });
  it("migrates older saved questions into a recoverable practice session", () => {
    const restored = restorePracticeSession([{ id: "legacy", type: "multiple_choice", createdAt: 1, attempts: [] }], { subjectId: "module", lessonId: "lesson" });
    expect(restored.migrated).toBe(true);
    expect(restored.question.practiceSessionId).toBe("legacy:module:lesson");
    expect(restored.config.sessionId).toBe("legacy:module:lesson");
  });
  it("keeps the newest attempted question when local and remote storage differ", () => {
    const remote = [{ id: "q1", createdAt: 1, attempts: [] }, { id: "remote-only", createdAt: 2, attempts: [] }];
    const local = [{ id: "q1", createdAt: 1, attempts: [{ gradedAt: 3, correct: true }] }];
    const merged = mergeStoredQuestionBanks(remote, local);
    expect(merged.find((question) => question.id === "q1").attempts).toHaveLength(1);
    expect(merged.map((question) => question.id)).toEqual(["q1", "remote-only"]);
  });
});
