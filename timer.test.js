import { describe, expect, it } from "vitest";
import { clampTimerMinutes, minutesToSeconds } from "./timer";

describe("adjustable Pomodoro timer", () => {
  it("converts chosen minutes into seconds", () => {
    expect(minutesToSeconds(40)).toBe(2400);
  });

  it("keeps timer lengths within sensible limits", () => {
    expect(clampTimerMinutes(0)).toBe(1);
    expect(clampTimerMinutes(500)).toBe(120);
    expect(clampTimerMinutes("15")).toBe(15);
  });
});
