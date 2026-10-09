import type { Period } from '@motor-fix/contracts';

import { addDays, atLocal, localDay, monthStart } from '../bucharest';

// The Europe/Bucharest days a period covers, today always the last of them;
// `default` has none, each figure keeping its own.
export function periodRange(period: Period, now: Date) {
  const today = localDay(now);
  const firstDay = {
    '7d': addDays(today, -6),
    '12m': monthsBack(monthStart(today), 11),
    '30d': addDays(today, -29),
    default: null,
    month: monthStart(today),
    today,
  }[period];
  return firstDay === null ? null : { firstDay, since: atLocal(firstDay, 0) };
}

const monthsBack = (first: string, n: number) => {
  const [year, month] = first.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 - n, 1)).toISOString().slice(0, 10);
};
