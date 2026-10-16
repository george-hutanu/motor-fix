import { addDays, addLocalDays, localDay } from '../../bucharest';

// The working days after the sending's own day whose wall-clock hour of
// sending has passed by `now`, in Europe/Bucharest: Monday to Friday, less
// the legal holidays ("2026-12-01").
export function workingDaysWaited(
  submittedAt: Date,
  now: Date,
  holidays: ReadonlySet<string>,
): number {
  const sent = localDay(submittedAt);
  let count = 0;
  for (let n = 1; addLocalDays(submittedAt, n) <= now; n++) {
    const day = addDays(sent, n);
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(day)) count++;
  }
  return count;
}
