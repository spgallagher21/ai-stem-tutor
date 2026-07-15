const DAY = 24 * 60 * 60 * 1000;

export function scheduleReview(entry = {}, result = {}, now = Date.now()) {
  const score = Math.max(0, Math.min(100, Number(result.partial_credit_percent ?? (result.correct ? 100 : 0))));
  const previousInterval = Math.max(0, Number(entry.intervalDays || 0));
  let intervalDays;
  if (score < 60) intervalDays = 1;
  else if (previousInterval < 1) intervalDays = 2;
  else if (score < 80) intervalDays = Math.max(2, Math.round(previousInterval * 1.4));
  else intervalDays = Math.min(120, Math.max(3, Math.round(previousInterval * 2.2)));
  return {
    intervalDays,
    dueAt: now + intervalDays * DAY,
    lastReviewedAt: now,
    retentionStage: intervalDays >= 21 ? "long-term" : intervalDays >= 7 ? "building" : "new",
  };
}

export function dueSubtopics(subjects, now = Date.now()) {
  return subjects.flatMap((subject) => (subject.meta?.curriculum?.topics || []).flatMap((topic) =>
    (topic.subtopics || []).map((subtopic) => ({ subject, topic, subtopic, mastery: subject.masteryLog?.[subtopic.id] || {} }))
  )).filter((item) => item.mastery.status === "attempted" || (item.mastery.dueAt && item.mastery.dueAt <= now))
    .sort((a, b) => (a.mastery.dueAt || 0) - (b.mastery.dueAt || 0));
}

export function buildStudySession(subjects, minutes = 30, now = Date.now()) {
  const due = dueSubtopics(subjects, now);
  const selected = [];
  let used = 0;
  for (const item of due) {
    const duration = Math.min(20, Math.max(5, Number(item.subtopic.estimatedMinutes || 10)));
    if (selected.length && used + duration > minutes) break;
    selected.push({ ...item, duration });
    used += duration;
  }
  return { minutes, plannedMinutes: used, items: selected };
}

