import { periodRange } from './periods';

const at = (iso: string) => new Date(iso);

// @traces 163-FR-002
describe('the period ranges', () => {
  const now = at('2026-10-08T10:00:00Z');

  it('gives no range for the default, where each figure keeps its own period', () => {
    expect(periodRange('default', now)).toBeNull();
  });

  it.each([
    ['today', '2026-10-08', '2026-10-07T21:00:00.000Z'],
    ['7d', '2026-10-02', '2026-10-01T21:00:00.000Z'],
    ['30d', '2026-09-09', '2026-09-08T21:00:00.000Z'],
    ['month', '2026-10-01', '2026-09-30T21:00:00.000Z'],
    ['12m', '2025-11-01', '2025-10-31T22:00:00.000Z'],
  ] as const)(
    'starts %s on %s at midnight in Bucharest',
    (period, firstDay, since) => {
      const range = periodRange(period, now);

      expect(range?.firstDay).toBe(firstDay);
      expect(range?.since.toISOString()).toBe(since);
    },
  );

  it('moves today to the next day at midnight in Bucharest, not in UTC', () => {
    expect(periodRange('today', at('2026-10-07T20:59:59Z'))?.firstDay).toBe(
      '2026-10-07',
    );
    expect(periodRange('today', at('2026-10-07T21:00:00Z'))?.firstDay).toBe(
      '2026-10-08',
    );
  });

  it('puts 23:30 in Bucharest on the last of September outside October', () => {
    const since = periodRange('month', now)?.since as Date;

    expect(at('2026-09-30T20:30:00Z') < since).toBe(true);
    expect(at('2026-09-30T21:00:00Z') >= since).toBe(true);
  });

  it('reads each start at its own offset across the clock change', () => {
    const after = at('2026-10-26T10:00:00Z');

    expect(periodRange('today', after)?.since.toISOString()).toBe(
      '2026-10-25T22:00:00.000Z',
    );
    expect(periodRange('7d', after)?.since.toISOString()).toBe(
      '2026-10-19T21:00:00.000Z',
    );
  });

  it('starts twelve months on the first of the month eleven months back, across a year', () => {
    expect(periodRange('12m', at('2026-01-15T10:00:00Z'))?.firstDay).toBe(
      '2025-02-01',
    );
  });
});
