import { todayInBucharest } from '@motor-fix/contracts/garage-hours';
import type { OpenStatus } from '@motor-fix/contracts/open-status';
import { calendarNames, type I18n } from '@motor-fix/i18n';

const DAY_MS = 86_400_000;
const KEY = 'public.garageProfile.status';

// The opening day spelt as the header says it: today, tomorrow, its weekday
// within the week, its date from seven days ahead.
function whenSaid(inDays: number, now: Date, i18n: I18n): string {
  if (inDays === 0) return i18n.t(`${KEY}.today`);
  if (inDays === 1) return i18n.t(`${KEY}.tomorrow`);
  const day = new Date(
    Date.parse(`${todayInBucharest(now)}T00:00:00Z`) + inDays * DAY_MS,
  );
  const names = calendarNames(i18n.language());
  if (inDays < 7) return names.days[(day.getUTCDay() + 6) % 7] ?? '';
  return i18n.t(`${KEY}.onDate`, {
    d: day.getUTCDate(),
    month: names.months[day.getUTCMonth()] ?? '',
  });
}

export function openLine(
  status: OpenStatus,
  now: Date,
  i18n: I18n,
): string | null {
  switch (status.kind) {
    case 'none':
      return null;
    case 'open':
      return i18n.t(`${KEY}.open`, { end: status.until });
    case 'break':
      return i18n.t(`${KEY}.break`, { start: status.until });
    case 'closed': {
      const key = {
        closed: 'closedDay',
        holiday: 'closedHoliday',
        hours: 'closedNow',
      }[status.reason];
      return i18n.t(`${KEY}.${key}`, {
        start: status.next.at,
        when: whenSaid(status.next.inDays, now, i18n),
      });
    }
  }
}
