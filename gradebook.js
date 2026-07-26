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

export function percentToGpa(percent, scale = 4.2) {
  if (percent === "" || percent === null || percent === undefined || !Number.isFinite(Number(percent))) return null;
  const value = Number(percent);
  const fourPointTwo = Number(scale) === 4.2;
  if (value >= 90) return fourPointTwo ? 4.2 : 4;
  if (value >= 85) return fourPointTwo ? 4 : 3.7;
  if (value >= 80) return fourPointTwo ? 3.7 : 3.3;
  if (value >= 75) return fourPointTwo ? 3.3 : 3;
  if (value >= 70) return fourPointTwo ? 3 : 2.7;
  if (value >= 65) return fourPointTwo ? 2.7 : 2.3;
  if (value >= 60) return fourPointTwo ? 2.3 : 2;
  if (value >= 55) return fourPointTwo ? 2 : 1.7;
  if (value >= 50) return fourPointTwo ? 1.7 : 1.3;
  if (value >= 45) return 1;
  return 0;
}

export function buildGradeSummary(subjects = [], assessments = [], gpaScale = 4.2) {
  const modules = subjects.map((subject) => ({ subject, ...weightedAverage(assessments.filter((item) => item.subjectId === subject.id)) })).filter((item) => item.average !== null);
  const overallAverage = modules.length ? modules.reduce((sum, item) => sum + item.average, 0) / modules.length : null;
  return { modules, overallAverage, estimatedGpa: percentToGpa(overallAverage, gpaScale), gpaScale: Number(gpaScale) === 4 ? 4 : 4.2 };
}
