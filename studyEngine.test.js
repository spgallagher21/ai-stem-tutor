import { describe, expect, it } from "vitest";
import { assessmentScopeItems, buildDeadlinePlan, buildStudySession, dueSubtopics, scheduleReview } from "./studyEngine";

describe("spaced review scheduling", () => {
  it("schedules weak work for tomorrow", () => expect(scheduleReview({}, { partial_credit_percent: 40 }, 1000).dueAt).toBe(1000 + 86_400_000));
  it("expands intervals after strong recall", () => expect(scheduleReview({ intervalDays: 7 }, { partial_credit_percent: 90 }).intervalDays).toBeGreaterThan(7));
  it("prioritises a confident error for tomorrow", () => {
    const result = scheduleReview({ intervalDays: 14 }, { partial_credit_percent: 20, confidence: 5 }, 1000);
    expect(result.intervalDays).toBe(1);
    expect(result.confidenceSignal).toBe("confident_misconception");
  });
  it("reviews an uncertain correct answer sooner than a confident one", () => {
    const uncertain = scheduleReview({ intervalDays: 7 }, { partial_credit_percent: 100, confidence: 2 }, 1000);
    const confident = scheduleReview({ intervalDays: 7 }, { partial_credit_percent: 100, confidence: 5 }, 1000);
    expect(uncertain.intervalDays).toBeLessThan(confident.intervalDays);
  });
  it("builds a bounded session", () => {
    const subjects = [{ meta: { curriculum: { topics: [{ name: "T", subtopics: [{ id: "s", name: "S", estimatedMinutes: 10 }] }] } }, masteryLog: { s: { status: "attempted", dueAt: 1 } } }];
    expect(dueSubtopics(subjects, 2)).toHaveLength(1);
    expect(buildStudySession(subjects, 15, 2).plannedMinutes).toBe(10);
  });
  it("puts confident misconceptions first in a study session", () => {
    const curriculum = { topics: [{ id: "t", name: "T", subtopics: [{ id: "ordinary", name: "Ordinary" }, { id: "confident", name: "Confident" }] }] };
    const subjects = [{ meta: { curriculum }, masteryLog: { ordinary: { status: "attempted", dueAt: 1 }, confident: { status: "attempted", dueAt: 2, confidenceSignal: "confident_misconception" } } }];
    expect(dueSubtopics(subjects, 3)[0].subtopic.id).toBe("confident");
  });
  it("maps full-module and selected-topic assessment scopes", () => {
    const subject = { id: "module", meta: { curriculum: { topics: [{ id: "t1", subtopics: [{ id: "s1", estimatedMinutes: 20 }] }, { id: "t2", subtopics: [{ id: "s2", estimatedMinutes: 30 }] }] } }, masteryLog: {} };
    expect(assessmentScopeItems({ fullModule: true }, subject)).toHaveLength(2);
    expect(assessmentScopeItems({ topicIds: ["t2"] }, subject).map((item) => item.subtopic.id)).toEqual(["s2"]);
  });
  it("prioritizes the nearest deadlines and excludes independently learned lessons", () => {
    const now = 1_000_000;
    const subject = { id: "module", meta: { curriculum: { topics: [{ id: "t1", subtopics: [{ id: "s1", estimatedMinutes: 20 }, { id: "s2", estimatedMinutes: 30 }] }] } }, masteryLog: { s1: { status: "mastered", learnedIndependently: true } } };
    const plan = buildDeadlinePlan([{ id: "later", subjectId: "module", title: "Exam", dueAt: now + 10 * 86_400_000, fullModule: true }, { id: "soon", subjectId: "module", title: "Quiz", dueAt: now + 2 * 86_400_000, fullModule: true }], [subject], { now });
    expect(plan[0].id).toBe("soon");
    expect(plan[0].remaining.map((item) => item.subtopic.id)).toEqual(["s2"]);
    expect(plan.reduce((sum, item) => sum + item.todayMinutes, 0)).toBe(30);
  });
});
