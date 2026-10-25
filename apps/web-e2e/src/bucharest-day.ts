const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' });

// The Bucharest calendar day `days` after now's, as a date field takes it.
// Calendar arithmetic, not 24-hour steps: the day the clocks go back has 25
// hours, and 24 hours after its first midnight hour is still that day.
export function bucharestDay(days = 0, now = new Date()): string {
  const [year, month, date] = day.format(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}
