import { de, instant, MINUTE, MISSING } from './formats';
import type { Language } from './languages';

// Kept out of the barrel and formats.ts, which the first page loads: only the
// admin's reported reviews read it, so it rides their lazy chunk.
const SPAN: Record<
  Language,
  {
    under: string;
    unit(count: number, unit: 'minute' | 'hour' | 'day'): string;
  }
> = {
  en: {
    under: 'under a minute',
    unit: (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`,
  },
  ro: {
    under: 'sub un minut',
    unit: (n, unit) =>
      `${n} ${de(n)}${
        {
          day: n === 1 ? 'zi' : 'zile',
          hour: n === 1 ? 'oră' : 'ore',
          minute: n === 1 ? 'minut' : 'minute',
        }[unit]
      }`,
  },
};

// How long a report has waited, in whole minutes, hours or days.
export function reportAge(
  value: unknown,
  language: Language,
  now: Date,
): string {
  const date = instant(value);
  if (!date) return MISSING;
  const elapsed = now.getTime() - date.getTime();
  const span = SPAN[language];
  if (elapsed < MINUTE) return span.under;
  if (elapsed < 60 * MINUTE) {
    return span.unit(Math.floor(elapsed / MINUTE), 'minute');
  }
  if (elapsed < 24 * 60 * MINUTE) {
    return span.unit(Math.floor(elapsed / (60 * MINUTE)), 'hour');
  }
  return span.unit(Math.floor(elapsed / (24 * 60 * MINUTE)), 'day');
}
