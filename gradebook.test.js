import { describe, expect, it } from "vitest";
import { buildGradeSummary, percentToGpa, weightedAverage } from "./gradebook";

describe("gradebook calculations", () => {
  it("normalises the average over graded weight only", () => expect(weightedAverage([{ weightPercent: 20, gradePercent: 80 }, { weightPercent: 30, gradePercent: 60 }, { weightPercent: 50 }]).average).toBe(68));
  it("keeps modules separate before calculating the overall average", () => {
    const summary = buildGradeSummary([{ id: "a" }, { id: "b" }], [{ subjectId: "a", weightPercent: 50, gradePercent: 80 }, { subjectId: "b", weightPercent: 100, gradePercent: 60 }]);
    expect(summary.overallAverage).toBe(70);
  });
  it("provides an explicitly estimated 4.0 GPA", () => expect(percentToGpa(85)).toBe(3.7));
});
