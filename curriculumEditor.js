const normalize = (value) => String(value || "").trim();

export function renameCurriculumTopic(curriculum, topicId, nextName) {
  const name = normalize(nextName);
  if (!name) return curriculum;
  const topic = (curriculum?.topics || []).find((item) => item.id === topicId);
  if (!topic) return curriculum;
  const duplicate = (curriculum.topics || []).some((item) => item.id !== topicId && normalize(item.name).toLowerCase() === name.toLowerCase());
  if (duplicate) throw new Error("Topic names must be unique.");
  const oldName = topic.name;
  return {
    ...curriculum,
    topics: curriculum.topics.map((item) => item.id === topicId ? { ...item, name } : item),
    topicGroups: (curriculum.topicGroups || []).map((group) => ({
      ...group,
      topicNames: (group.topicNames || []).map((item) => normalize(item).toLowerCase() === normalize(oldName).toLowerCase() ? name : item),
    })),
  };
}

export function moveCurriculumLesson(curriculum, lessonId, targetTopicId) {
  const topics = curriculum?.topics || [];
  const sourceTopic = topics.find((topic) => (topic.subtopics || []).some((lesson) => lesson.id === lessonId));
  const targetTopic = topics.find((topic) => topic.id === targetTopicId);
  if (!sourceTopic || !targetTopic || sourceTopic.id === targetTopic.id) return curriculum;
  const lesson = sourceTopic.subtopics.find((item) => item.id === lessonId);
  return {
    ...curriculum,
    topics: topics.map((topic) => {
      if (topic.id === sourceTopic.id) return { ...topic, subtopics: (topic.subtopics || []).filter((item) => item.id !== lessonId) };
      if (topic.id === targetTopic.id) return { ...topic, subtopics: [...(topic.subtopics || []), lesson] };
      return topic;
    }),
  };
}

export function curriculumStructureSignature(curriculum) {
  return JSON.stringify((curriculum?.topics || []).map((topic) => ({ id: topic.id, name: topic.name, lessons: (topic.subtopics || []).map((lesson) => ({ id: lesson.id, name: lesson.name })) })));
}
