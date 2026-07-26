export function clampTimerMinutes(value, { min = 1, max = 120 } = {}) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function minutesToSeconds(value, limits) {
  return clampTimerMinutes(value, limits) * 60;
}
