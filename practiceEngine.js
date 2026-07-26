export const PRACTICE_TYPE_OPTIONS = [
  { id: "all", label: "All question types" },
  { id: "multiple_choice", label: "Multiple choice" },
  { id: "fill_blank", label: "Fill in the blank" },
  { id: "short_explain", label: "Short explain" },
  { id: "long_explain", label: "Long explain" },
  { id: "exam_short", label: "Exam-style short question" },
  { id: "exam_long", label: "Exam-style long question" },
  { id: "image_based", label: "Image-based questions" },
];

export function normalizePracticeTypes(types = ["all"]) {
  const valid = new Set(PRACTICE_TYPE_OPTIONS.map((item) => item.id));
  const selected = [...new Set((types || []).filter((type) => valid.has(type)))];
  return !selected.length || selected.includes("all") ? ["all"] : selected;
}

export function questionCountForLesson(lesson = {}, difficulty = 1, stage = "short") {
  const sections = Math.max(1, lesson.sections?.length || 1);
  const concepts = (lesson.sections || []).reduce((sum, section) => sum + Math.min(5, section.key_points?.length || 0), 0);
  const base = Math.round(2 + sections / 2 + concepts / 8 + Math.max(1, Number(difficulty || 1)) / 2);
  const shortCount = Math.max(3, Math.min(8, base));
  return stage === "hard" ? Math.max(2, Math.min(6, Math.ceil(shortCount * 0.65))) : shortCount;
}

export function questionTypeInstructions(types = ["all"], stage = "short") {
  const selected = normalizePracticeTypes(types);
  const all = selected.includes("all");
  const allowed = all
    ? stage === "short"
      ? ["multiple_choice", "fill_blank", "short_answer"]
      : ["short_answer", "derivation", "long_answer"]
    : selected.flatMap((type) => ({
      multiple_choice: ["multiple_choice"],
      fill_blank: ["fill_blank"],
      short_explain: ["short_answer"],
      long_explain: ["long_answer"],
      exam_short: ["short_answer"],
      exam_long: ["derivation", "long_answer"],
      image_based: ["multiple_choice", "short_answer"],
    }[type] || []));
  return {
    allowedTypes: [...new Set(allowed.length ? allowed : ["short_answer"])],
    needsExamStyle: all || selected.some((type) => type.startsWith("exam_")),
    needsImage: selected.includes("image_based"),
  };
}

export function recentLowScoreStreak(bank = [], threshold = 60) {
  const attempts = bank
    .flatMap((question) => (question.attempts || []).map((attempt) => ({ ...attempt, gradedAt: attempt.gradedAt || 0 })))
    .sort((a, b) => b.gradedAt - a.gradedAt);
  let streak = 0;
  for (const attempt of attempts) {
    const score = Number(attempt.partial_credit_percent ?? (attempt.correct ? 100 : 0));
    if (score >= threshold) break;
    streak += 1;
  }
  return streak;
}

export function questionsForPracticeSession(bank = [], config = {}) {
  if (!config.sessionId) return [];
  return bank.filter((question) => (
    question.practiceSessionId === config.sessionId
    && question.practiceStage === config.stage
  ));
}

export function groupQuestionBank(bank = [], currentQuestionId = null) {
  const ordered = [...bank].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  return {
    current: ordered.filter((question) => question.id === currentQuestionId),
    upcoming: ordered.filter((question) => question.id !== currentQuestionId && !question.attempts?.length),
    answered: ordered.filter((question) => question.id !== currentQuestionId && question.attempts?.length),
  };
}
