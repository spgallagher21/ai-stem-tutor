import { describe, expect, it } from "vitest";
import { calibrateLearningMinutes, effectiveLearningMinutes } from "./timeEstimates";

describe("learning time estimates", () => {
  it("reduces inflated legacy estimates", () => expect(calibrateLearningMinutes(60, 3)).toBe(25));
  it("caps a class-sized lesson at 45 minutes", () => expect(calibrateLearningMinutes(180, 5)).toBe(45));
  it("does not recalibrate already migrated estimates", () => expect(effectiveLearningMinutes({ estimatedMinutes: 20, timeEstimateVersion: 2 })).toBe(20));
});
