import { addDays, addLocalDays, daysBetween, localDay } from '../../bucharest';

// The working days after the sending's own day whose wall-clock hour of
// sending has passed by `now`, in Europe/Bucharest: Monday to Friday, less
// the legal holidays ("2026-12-01").
export function workingDaysWaited(
  submittedAt: Date,
  now: Date,
  holidays: ReadonlySet<string>,
): number {
  const sent = localDay(submittedAt);
  let days = daysBetween(sent, localDay(now));
  // Today counts once the hour of sending has come round.
  if (days > 0 && addLocalDays(submittedAt, days) > now) days--;
  let count = 0;
  for (let n = 1; n <= days; n++) {
    const day = addDays(sent, n);
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(day)) count++;
  }
  return count;
}
