const roundFive = (value) => Math.max(5, Math.round(value / 5) * 5);

export function calibrateLearningMinutes(value, difficulty = 3) {
  const raw = Number.isFinite(Number(value)) ? Number(value) : 20;
  const scaled = raw > 45 ? raw * 0.45 : raw * 0.7;
  const floor = 5 + Math.max(1, Math.min(5, Number(difficulty) || 3)) * 2;
  return Math.min(45, roundFive(Math.max(floor, scaled)));
}

export function effectiveLearningMinutes(lesson = {}) {
  return lesson.timeEstimateVersion === 2 ? Math.max(5, Math.min(45, Number(lesson.estimatedMinutes) || 15)) : calibrateLearningMinutes(lesson.estimatedMinutes, lesson.difficulty);
}
