export function buildModuleExamScope(subject, selectedTopicIds = []) {
  const allowed = new Set(selectedTopicIds);
  const topics = (subject?.meta?.curriculum?.topics || []).filter((topic) => allowed.has(topic.id));
  const topicIds = topics.map((topic) => topic.id).sort();
  return {
    id: `module-exam-${topicIds.join("-")}`,
    subjectId: subject?.id || "",
    name: topics.length === (subject?.meta?.curriculum?.topics || []).length ? "Full Module Exam" : "Custom Module Exam",
    topics,
    subtopics: topics.flatMap((topic) => topic.subtopics || []),
    topicIds,
  };
}

export function moduleBoundaryText(subject) {
  const topicNames = (subject?.meta?.curriculum?.topics || []).map((topic) => topic.name);
  return `STRICT MODULE BOUNDARY:\n- Current module: "${subject?.meta?.name || "Unnamed module"}" (internal ID: ${subject?.id || "unknown"}).\n- Its allowed topic map is: ${JSON.stringify(topicNames)}.\n- Use only this module's attached files and saved indexes. Never import a concept, example, equation, scenario, or question style from another module, from generic prompt examples, or from prior conversations.\n- If the attached evidence is insufficient for a requested question, omit that question rather than filling the gap from general knowledge.`;
}
