import { describe, expect, it } from "vitest";
import { clampTimerMinutes, createDeadline, minutesToSeconds, secondsUntil } from "./timer";

describe("adjustable Pomodoro timer", () => {
  it("converts chosen minutes into seconds", () => {
    expect(minutesToSeconds(40)).toBe(2400);
  });

  it("keeps timer lengths within sensible limits", () => {
    expect(clampTimerMinutes(0)).toBe(1);
    expect(clampTimerMinutes(500)).toBe(120);
    expect(clampTimerMinutes("15")).toBe(15);
  });

  it("derives remaining time from an absolute deadline", () => {
    const deadline = createDeadline(90, 1_000);
    expect(deadline).toBe(91_000);
    expect(secondsUntil(deadline, 31_000)).toBe(60);
    expect(secondsUntil(deadline, 92_000)).toBe(0);
  });
});
