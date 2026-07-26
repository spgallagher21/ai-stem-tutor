const dayKey = (value = Date.now()) => new Date(value).toISOString().slice(0, 10);
const dayNumber = (key) => Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000);

export function recordStudyDay(streak = {}, now = Date.now()) {
  const today = dayKey(now);
  const days = [...new Set([...(streak.days || []), today])].sort().slice(-400);
  let current = 1;
  for (let index = days.length - 1; index > 0; index -= 1) {
    if (dayNumber(days[index]) - dayNumber(days[index - 1]) !== 1) break;
    current += 1;
  }
  let longest = 0;
  let run = 0;
  days.forEach((day, index) => {
    run = index > 0 && dayNumber(day) - dayNumber(days[index - 1]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return { days, current, longest, lastStudyDay: today };
}

export function normalizeStudyStreak(streak = {}, now = Date.now()) {
  const recorded = recordStudyDay({ days: streak.days || [] }, now);
  const last = (streak.days || []).slice().sort().at(-1);
  const distance = last ? dayNumber(dayKey(now)) - dayNumber(last) : Infinity;
  return { ...recorded, current: distance <= 1 ? recorded.current : 0 };
}

