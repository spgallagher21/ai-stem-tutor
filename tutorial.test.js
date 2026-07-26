import { describe, expect, it } from "vitest";
import { TUTORIAL_STEPS, tutorialScreenForStep, tutorialStepFor } from "./tutorial";

describe("interactive tutorial", () => {
  it("targets unique real app controls", () => {
    const targets = TUTORIAL_STEPS.map((step) => step.target);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toEqual(expect.arrayContaining(["addModule", "fileUpload", "subtopicCard", "deadlines", "settings"]));
  });

  it("routes each step to the screen containing its target", () => {
    expect(tutorialScreenForStep(tutorialStepFor("moduleName"))).toBe("add");
    expect(tutorialScreenForStep(tutorialStepFor("moduleExam"))).toBe("subject");
    expect(tutorialScreenForStep(tutorialStepFor("pomodoro"))).toBe("dashboard");
  });
});
