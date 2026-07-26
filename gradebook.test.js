import { describe, expect, it } from "vitest";
import { buildGradeSummary, percentToGpa, weightedAverage } from "./gradebook";

describe("gradebook calculations", () => {
  it("normalises the average over graded weight only", () => expect(weightedAverage([{ weightPercent: 20, gradePercent: 80 }, { weightPercent: 30, gradePercent: 60 }, { weightPercent: 50 }]).average).toBe(68));
  it("keeps modules separate before calculating the overall average", () => {
    const summary = buildGradeSummary([{ id: "a" }, { id: "b" }], [{ subjectId: "a", weightPercent: 50, gradePercent: 80 }, { subjectId: "b", weightPercent: 100, gradePercent: 60 }]);
    expect(summary.overallAverage).toBe(70);
  });
  it("uses 4.2 by default and supports an optional 4.0 scale", () => {
    expect(percentToGpa(null)).toBeNull();
    expect(percentToGpa(90)).toBe(4.2);
    expect(percentToGpa(85, 4)).toBe(3.7);
  });
});
