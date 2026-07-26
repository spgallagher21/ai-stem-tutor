function repairLatexControls(value) {
  return String(value || "")
    .replace(/\t(?=ext\s*\{)/g, "\\t")
    .replace(/\f(?=rac\s*\{)/g, "\\f")
    .replace(/\r(?=(?:ight|mathrm|rm)\b)/g, "\\r");
}

function repairLatexBody(value) {
  return repairLatexControls(value)
    .replace(/\\{2,}(?=[A-Za-z])/g, "\\")
    .trim();
}

export function normalizeMathMarkdown(value) {
  return repairLatexControls(value)
    .replace(/\\+\$/g, "$")
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => `$${latex}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => `$$${latex}$$`)
    .replace(/(\${1,2})([\s\S]*?)\1/g, (_, delimiter, latex) => `${delimiter}${repairLatexBody(latex)}${delimiter}`);
}

function anchorKey(value) {
  return String(value ?? "").trim().replace(/^\(|\)$/g, "").toLowerCase();
}

export function placeLessonCalculations(lesson = {}) {
  const equationTargets = (lesson.sections || []).flatMap((section, sectionIndex) => (
    (section.equations || []).map((equation, equationIndex) => ({
      key: `${sectionIndex}:${equationIndex}`,
      number: anchorKey(equation.number),
    }))
  ));
  const workedStepCount = lesson.worked_example?.steps?.length || 0;
  const byEquation = {};
  const byWorkedStep = {};
  const unplaced = [];

  for (const calculation of lesson.verified_calculations || []) {
    const equationNumber = anchorKey(calculation.equation_number);
    const equation = equationNumber && equationTargets.find((target) => target.number === equationNumber);
    const workedStep = Number(calculation.worked_step);
    if (equation) {
      byEquation[equation.key] = [...(byEquation[equation.key] || []), calculation];
    } else if (Number.isInteger(workedStep) && workedStep >= 1 && workedStep <= workedStepCount) {
      const key = String(workedStep - 1);
      byWorkedStep[key] = [...(byWorkedStep[key] || []), calculation];
    } else {
      unplaced.push(calculation);
    }
  }

  if (unplaced.length && workedStepCount) {
    const key = String(workedStepCount - 1);
    byWorkedStep[key] = [...(byWorkedStep[key] || []), ...unplaced];
  } else if (unplaced.length && equationTargets.length) {
    const key = equationTargets[equationTargets.length - 1].key;
    byEquation[key] = [...(byEquation[key] || []), ...unplaced];
  }

  return {
    byEquation,
    byWorkedStep,
    unplaced: equationTargets.length || workedStepCount ? [] : unplaced,
  };
}
