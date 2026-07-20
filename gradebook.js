const validNumber = (value) => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));

export function weightedAverage(assessments = []) {
  const graded = assessments.filter((item) => validNumber(item.gradePercent) && validNumber(item.weightPercent) && Number(item.weightPercent) > 0);
  const weightCompleted = graded.reduce((sum, item) => sum + Number(item.weightPercent), 0);
  if (!weightCompleted) return { average: null, weightCompleted: 0, gradedCount: 0 };
  return {
    average: graded.reduce((sum, item) => sum + Number(item.gradePercent) * Number(item.weightPercent), 0) / weightCompleted,
    weightCompleted,
    gradedCount: graded.length,
  };
}

export function percentToGpa(percent) {
  if (!Number.isFinite(Number(percent))) return null;
  const value = Number(percent);
  if (value >= 90) return 4;
  if (value >= 85) return 3.7;
  if (value >= 80) return 3.3;
  if (value >= 75) return 3;
  if (value >= 70) return 2.7;
  if (value >= 65) return 2.3;
  if (value >= 60) return 2;
  if (value >= 55) return 1.7;
  if (value >= 50) return 1.3;
  if (value >= 45) return 1;
  return 0;
}

export function buildGradeSummary(subjects = [], assessments = []) {
  const modules = subjects.map((subject) => ({ subject, ...weightedAverage(assessments.filter((item) => item.subjectId === subject.id)) })).filter((item) => item.average !== null);
  const overallAverage = modules.length ? modules.reduce((sum, item) => sum + item.average, 0) / modules.length : null;
  return { modules, overallAverage, estimatedGpa: percentToGpa(overallAverage) };
}
