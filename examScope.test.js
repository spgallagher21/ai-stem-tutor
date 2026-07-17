import { describe, expect, it } from "vitest";
import { buildModuleExamScope, moduleBoundaryText } from "./examScope";

const subject = { id: "measurement", meta: { name: "Measurement and Instrumentation", curriculum: { topics: [{ id: "sensors", name: "Sensors", subtopics: [{ id: "strain", name: "Strain gauges" }] }, { id: "daq", name: "Data acquisition", subtopics: [] }] } } };

describe("module exam scope", () => {
  it("includes only explicitly selected topics", () => {
    const scope = buildModuleExamScope(subject, ["daq"]);
    expect(scope.topics.map((topic) => topic.id)).toEqual(["daq"]);
    expect(scope.id).toContain("daq");
  });

  it("labels a complete selection as a full module exam", () => expect(buildModuleExamScope(subject, ["sensors", "daq"]).name).toBe("Full Module Exam"));

  it("names the current module and allowed topics in the boundary", () => {
    const boundary = moduleBoundaryText(subject);
    expect(boundary).toContain("Measurement and Instrumentation");
    expect(boundary).toContain("Sensors");
  });
});
