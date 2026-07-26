export function clampTimerMinutes(value, { min = 1, max = 120 } = {}) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function minutesToSeconds(value, limits) {
  return clampTimerMinutes(value, limits) * 60;
}

export function createDeadline(durationSeconds, now = Date.now()) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  return now + seconds * 1000;
}

export function secondsUntil(deadlineAt, now = Date.now()) {
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((Number(deadlineAt) - now) / 1000));
}
