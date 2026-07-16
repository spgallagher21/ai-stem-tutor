import { confidenceFlag, normalizeConfidence } from "./confidence";

const DAY = 24 * 60 * 60 * 1000;

export function scheduleReview(entry = {}, result = {}, now = Date.now()) {
  const score = Math.max(0, Math.min(100, Number(result.partial_credit_percent ?? (result.correct ? 100 : 0))));
  const previousInterval = Math.max(0, Number(entry.intervalDays || 0));
  const confidence = normalizeConfidence(result.confidence);
  const confidenceSignal = confidenceFlag({ ...result, confidence });
  let intervalDays;
  if (score < 60) intervalDays = 1;
  else if (previousInterval < 1) intervalDays = 2;
  else if (score < 80) intervalDays = Math.max(2, Math.round(previousInterval * 1.4));
  else intervalDays = Math.min(120, Math.max(3, Math.round(previousInterval * 2.2)));
  if (confidenceSignal === "confident_misconception") intervalDays = 1;
  if (confidenceSignal === "uncertain_correct") intervalDays = Math.max(1, Math.round(intervalDays * 0.6));
  return {
    intervalDays,
    dueAt: now + intervalDays * DAY,
    lastReviewedAt: now,
    retentionStage: intervalDays >= 21 ? "long-term" : intervalDays >= 7 ? "building" : "new",
    confidenceSignal,
  };
}

export function dueSubtopics(subjects, now = Date.now()) {
  return subjects.flatMap((subject) => (subject.meta?.curriculum?.topics || []).flatMap((topic) =>
    (topic.subtopics || []).map((subtopic) => ({ subject, topic, subtopic, mastery: subject.masteryLog?.[subtopic.id] || {} }))
  )).filter((item) => item.mastery.status === "attempted" || (item.mastery.dueAt && item.mastery.dueAt <= now))
    .sort((a, b) => {
      const priority = (item) => item.mastery.confidenceSignal === "confident_misconception" ? 2 : item.mastery.confidenceSignal === "uncertain_correct" ? 1 : 0;
      return priority(b) - priority(a) || (a.mastery.dueAt || 0) - (b.mastery.dueAt || 0);
    });
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

export function assessmentScopeItems(assessment, subject) {
  if (!assessment || !subject) return [];
  const selectedTopics = new Set([...(assessment.topicIds || []), ...(assessment.resolvedTopicIds || [])]);
  const selectedLessons = new Set([...(assessment.subtopicIds || []), ...(assessment.resolvedSubtopicIds || [])]);
  const all = (subject.meta?.curriculum?.topics || []).flatMap((topic) => (topic.subtopics || []).map((subtopic) => ({ subject, topic, subtopic, mastery: subject.masteryLog?.[subtopic.id] || {} })));
  if (assessment.fullModule) return all;
  return all.filter((item) => selectedTopics.has(item.topic.id) || selectedLessons.has(item.subtopic.id));
}

export function buildDeadlinePlan(assessments, subjects, { now = Date.now(), sessionMinutes = 30, maxAssessments = 3 } = {}) {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const plans = (assessments || [])
    .filter((assessment) => assessment.status !== "completed" && Number(assessment.dueAt) >= now - DAY)
    .map((assessment) => {
      const subject = subjectById.get(assessment.subjectId);
      const scope = assessmentScopeItems(assessment, subject);
      const remaining = scope.filter((item) => item.mastery.status !== "mastered");
      const remainingMinutes = remaining.reduce((sum, item) => sum + Math.max(5, Number(item.subtopic.estimatedMinutes || 10)), 0);
      const daysRemaining = Math.max(0, Math.ceil((Number(assessment.dueAt) - now) / DAY));
      const studyDays = Math.max(1, daysRemaining);
      const dailyMinutes = Math.ceil(remainingMinutes / studyDays / 5) * 5;
      const urgency = daysRemaining <= 2 ? "urgent" : daysRemaining <= 7 ? "soon" : "planned";
      const recommendedItems = remaining.slice(0, Math.max(1, Math.floor(sessionMinutes / 10)));
      return { ...assessment, subject, scope, remaining, remainingMinutes, daysRemaining, dailyMinutes, urgency, recommendedItems, completedCount: scope.length - remaining.length, totalCount: scope.length };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining || b.remainingMinutes - a.remainingMinutes)
    .slice(0, maxAssessments);
  const weights = plans.map((plan) => Math.max(1, Math.min(plan.dailyMinutes || 1, sessionMinutes)) * (plan.urgency === "urgent" ? 2 : plan.urgency === "soon" ? 1.4 : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const minimum = sessionMinutes >= plans.length * 5 ? 5 : 0;
  const flexibleBudget = Math.max(0, sessionMinutes - minimum * plans.length);
  let allocated = 0;
  return plans.map((plan, index) => {
    const remainingBudget = Math.max(0, sessionMinutes - allocated);
    const todayMinutes = index === plans.length - 1 ? remainingBudget : Math.min(remainingBudget, minimum + Math.round(flexibleBudget * weights[index] / totalWeight / 5) * 5);
    allocated += todayMinutes;
    return { ...plan, todayMinutes };
  });
}
