import { de, instant, MINUTE, MISSING } from './formats';
import type { Language } from './languages';

// Kept out of the barrel and formats.ts, which the first page loads: only the
// garage's request drawer reads it, so it rides that lazy chunk.
const UNTIL: Record<
  Language,
  {
    days(count: number): string;
    hours(count: number): string;
    soon: string;
    past: string;
  }
> = {
  en: {
    days: (n) => `expires in ${n} ${n === 1 ? 'day' : 'days'}`,
    hours: (n) => `expires in ${n} ${n === 1 ? 'hour' : 'hours'}`,
    past: 'expired',
    soon: 'expires in less than an hour',
  },
  ro: {
    days: (n) => `expiră în ${n} ${de(n)}${n === 1 ? 'zi' : 'zile'}`,
    hours: (n) => `expiră în ${n} ${de(n)}${n === 1 ? 'oră' : 'ore'}`,
    past: 'a expirat',
    soon: 'expiră în mai puțin de o oră',
  },
};

// How long a request still waits for an answer, rounded down: whole days from
// a day on, whole hours under it, then less than an hour, then expired.
export function requestExpiry(
  value: unknown,
  language: Language,
  now: Date,
): string {
  const date = instant(value);
  if (!date) return MISSING;
  const left = date.getTime() - now.getTime();
  const words = UNTIL[language];
  if (left <= 0) return words.past;
  if (left >= 24 * 60 * MINUTE) {
    return words.days(Math.floor(left / (24 * 60 * MINUTE)));
  }
  if (left >= 60 * MINUTE) return words.hours(Math.floor(left / (60 * MINUTE)));
  return words.soon;
}
