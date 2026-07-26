const DEFAULT_CLOUD_BUDGET = 700_000;

export function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function fitQuestionsForCloud(questions, maxBytes = DEFAULT_CLOUD_BUDGET) {
  const source = Array.isArray(questions) ? questions : [];
  let fitted = source.map((question) => ({ ...question, attempts: [...(question.attempts || [])] }));

  while (fitted.length && jsonBytes({ questions: fitted }) > maxBytes) {
    const oldestAttemptIndex = fitted.findIndex((question) => question.attempts.length > 1);
    if (oldestAttemptIndex >= 0) {
      fitted[oldestAttemptIndex] = {
        ...fitted[oldestAttemptIndex],
        attempts: fitted[oldestAttemptIndex].attempts.slice(0, -1),
      };
      continue;
    }
    fitted = fitted.slice(1);
  }
  return fitted;
}
