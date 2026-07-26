import { describe, expect, it } from "vitest";
import { normalizeStudyStreak, recordStudyDay } from "./streak";

describe("study streaks", () => {
  it("increments on consecutive days without double-counting a day", () => {
    const one = recordStudyDay({}, Date.parse("2026-07-20T12:00:00Z"));
    const same = recordStudyDay(one, Date.parse("2026-07-20T18:00:00Z"));
    const next = recordStudyDay(same, Date.parse("2026-07-21T10:00:00Z"));
    expect(same.current).toBe(1);
    expect(next.current).toBe(2);
  });
  it("resets the current streak after a missed day", () => {
    const streak = { days: ["2026-07-20"] };
    expect(normalizeStudyStreak(streak, Date.parse("2026-07-23T10:00:00Z")).current).toBe(0);
  });
});
