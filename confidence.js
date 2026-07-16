export const DEFAULT_CONFIDENCE = 3;

export const CONFIDENCE_LABELS = {
  1: "Guessing",
  2: "Unsure",
  3: "Fairly confident",
  4: "Very confident",
  5: "Certain",
};

export function normalizeConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(1, Math.min(5, Math.round(confidence))) : DEFAULT_CONFIDENCE;
}

export function confidenceInsight(result = {}) {
  const confidence = normalizeConfidence(result.confidence);
  const score = Number(result.partial_credit_percent ?? (result.correct ? 100 : 0));
  const isGood = result.correct || score >= 80;
  if (!isGood && confidence >= 4) return "You felt confident, but the answer needs work. This may be a misconception, so it has been prioritised for review.";
  if (isGood && confidence <= 2) return "Your answer was strong, but your confidence was low. A shorter follow-up review will help make the knowledge feel secure.";
  if (isGood && confidence >= 4) return "Your answer and confidence were well calibrated.";
  return "Your confidence has been saved and will help tune future review timing.";
}

export function confidenceFlag(result = {}) {
  const confidence = normalizeConfidence(result.confidence);
  const score = Number(result.partial_credit_percent ?? (result.correct ? 100 : 0));
  const isGood = result.correct || score >= 80;
  if (!isGood && confidence >= 4) return "confident_misconception";
  if (isGood && confidence <= 2) return "uncertain_correct";
  return "calibrated";
}
