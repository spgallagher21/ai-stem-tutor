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

function plainTextFromMath(value) {
  return String(value || "")
    .replace(/\\(?:text|textrm|mathrm|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenuineMath(value) {
  const latex = String(value || "").trim();
  const plain = plainTextFromMath(latex);
  if (/^[A-Za-z]$/.test(latex)) return true;
  if (/^\\[A-Za-z]+$/.test(latex)) return true;
  if (/^[A-Za-z]+(?:[ -][A-Za-z]+)+$/.test(plain)) return false;
  return /[=<>+\-*/^_]|\\(?:frac|sqrt|sum|prod|int|lim|log|ln|sin|cos|tan|exp|cdot|times|pm|mp|leq|geq|approx|equiv|propto|infty|partial|nabla|Delta|alpha|beta|gamma|theta|lambda|mu|rho|sigma|tau|phi|psi|omega|circ)\b/.test(latex);
}

function wrapBareMathSymbols(value) {
  const text = String(value || "");
  const mathSpan = /\$\$[\s\S]*?\$\$|\$[^$\n]*?\$/g;
  let output = "";
  let cursor = 0;
  for (const match of text.matchAll(mathSpan)) {
    output += wrapBareMathSymbolsInProse(text.slice(cursor, match.index));
    output += match[0];
    cursor = match.index + match[0].length;
  }
  return output + wrapBareMathSymbolsInProse(text.slice(cursor));
}

function wrapBareMathSymbolsInProse(value) {
  return String(value || "")
    .replace(/\\(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|rho|sigma|tau|phi|psi|omega|Delta|Omega)\b(?:_\{?[A-Za-z0-9]+\}?|\^\{?[A-Za-z0-9+\-]+\}?)*/g, (symbol) => `$${symbol}$`)
    .replace(/\b[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|\^\{?[A-Za-z0-9+\-]+\}?)+/g, (symbol) => `$${symbol}$`);
}

export function normalizeMathMarkdown(value) {
  const normalized = repairLatexControls(value)
    .replace(/\\+\$/g, "$")
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => `$${latex}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => `$$${latex}$$`)
    .replace(/(\${1,2})([\s\S]*?)\1/g, (_, delimiter, latex) => {
      const repaired = repairLatexBody(latex);
      if (delimiter === "$" && !isGenuineMath(repaired)) return plainTextFromMath(repaired);
      return `${delimiter}${repaired}${delimiter}`;
    });
  return wrapBareMathSymbols(normalized);
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
