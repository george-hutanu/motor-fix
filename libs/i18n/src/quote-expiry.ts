import {
  bucharestDayStart,
  DAY_MS,
  dayAndTime,
  de,
  formatClock,
  instant,
  MINUTE,
  MISSING,
  TOMORROW,
} from './formats';
import type { Language } from './languages';

// Its own entry point (@motor-fix/i18n/quote-expiry), outside the barrel the
// first page loads: only the garage's requests view words a quote's expiry
// and deadline, so these load with that view.
const EXPIRES: Record<
  Language,
  {
    day: string;
    days(count: number): string;
    hours(count: number): string;
    minutes(count: number): string;
    moments: string;
  }
> = {
  en: {
    day: 'expires in 1 day',
    days: (n) => `expires in ${n} days`,
    hours: (n) => `expires in ${n} h`,
    minutes: (n) => `expires in ${n} min`,
    moments: 'expires in moments',
  },
  ro: {
    day: 'expiră într-o zi',
    days: (n) => `expiră în ${n} ${de(n)}zile`,
    hours: (n) => `expiră în ${n} h`,
    minutes: (n) => `expiră în ${n} min`,
    moments: 'expiră în câteva momente',
  },
};

// How long a sent quote still stands: from a day on, the days it touches
// (rounded up, so a fresh seven-day quote reads seven days); under a day,
// whole hours, then whole minutes, then moments, also once it has passed.
export function quoteExpiry(
  value: unknown,
  language: Language,
  now: Date,
): string {
  const date = instant(value);
  if (!date) return MISSING;
  const left = date.getTime() - now.getTime();
  const words = EXPIRES[language];
  if (left >= DAY_MS) {
    const days = Math.ceil(left / DAY_MS);
    return days === 1 ? words.day : words.days(days);
  }
  if (left >= 60 * MINUTE) return words.hours(Math.floor(left / (60 * MINUTE)));
  if (left >= MINUTE) return words.minutes(Math.floor(left / MINUTE));
  return words.moments;
}

// A deadline: the Bucharest time alone today, "mâine, 09:00" tomorrow, else
// "joi, 15 oct., 14:00".
export function formatDeadline(
  value: unknown,
  language: Language,
  now: Date,
): string {
  const date = instant(value);
  if (!date) return MISSING;
  return bucharestDayStart(date).getTime() === bucharestDayStart(now).getTime()
    ? formatClock(date)
    : dayAndTime(date, language, now, { 1: TOMORROW[language] });
}
