import { describe, expect, it } from "vitest";
import { buildStudySession, dueSubtopics, scheduleReview } from "./studyEngine";

describe("spaced review scheduling", () => {
  it("schedules weak work for tomorrow", () => expect(scheduleReview({}, { partial_credit_percent: 40 }, 1000).dueAt).toBe(1000 + 86_400_000));
  it("expands intervals after strong recall", () => expect(scheduleReview({ intervalDays: 7 }, { partial_credit_percent: 90 }).intervalDays).toBeGreaterThan(7));
  it("builds a bounded session", () => {
    const subjects = [{ meta: { curriculum: { topics: [{ name: "T", subtopics: [{ id: "s", name: "S", estimatedMinutes: 10 }] }] } }, masteryLog: { s: { status: "attempted", dueAt: 1 } } }];
    expect(dueSubtopics(subjects, 2)).toHaveLength(1);
    expect(buildStudySession(subjects, 15, 2).plannedMinutes).toBe(10);
  });
});
