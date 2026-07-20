import { describe, expect, it } from "vitest";
import { curriculumStructureSignature, moveCurriculumLesson, renameCurriculumTopic } from "./curriculumEditor";

const curriculum = { topicGroups: [{ name: "Group", topicNames: ["Old", "Second"] }], topics: [{ id: "a", name: "Old", subtopics: [{ id: "lesson", name: "Lesson", sourceFileNames: ["notes.pdf"], sourcePageHints: [3] }] }, { id: "b", name: "Second", subtopics: [] }] };

describe("curriculum editing", () => {
  it("renames a topic without changing its id and updates group references", () => {
    const next = renameCurriculumTopic(curriculum, "a", "Renamed");
    expect(next.topics[0].id).toBe("a");
    expect(next.topicGroups[0].topicNames).toContain("Renamed");
  });
  it("moves a lesson while preserving its id and source mapping", () => {
    const next = moveCurriculumLesson(curriculum, "lesson", "b");
    expect(next.topics[1].subtopics[0]).toMatchObject({ id: "lesson", sourceFileNames: ["notes.pdf"], sourcePageHints: [3] });
    expect(next.topics[0].subtopics).toHaveLength(0);
  });
  it("changes the cache signature after manual organisation", () => expect(curriculumStructureSignature(renameCurriculumTopic(curriculum, "a", "New"))).not.toBe(curriculumStructureSignature(curriculum)));
});
