import { segmentsOf } from './time-blocks';
import { atLocal } from '../../bucharest';

const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000);
const hours = (spans: [Date, Date][]) =>
  spans.map(([a, b]) => (b.getTime() - a.getTime()) / 3_600_000);
const total = (spans: [Date, Date][]) =>
  spans.reduce((sum, [a, b]) => sum + b.getTime() - a.getTime(), 0);

// @traces 427-FR-005
describe('the day cut of a blocked interval', () => {
  it('keeps a block inside one day as one segment', () => {
    const from = at('2026-11-10', 10);
    const to = at('2026-11-10', 11, 30);
    expect(segmentsOf(from, to)).toEqual([[from, to]]);
  });

  it('cuts Friday 16:00 to Monday 10:00 at each Bucharest midnight', () => {
    const from = at('2026-11-13', 16);
    const to = at('2026-11-16', 10);
    const spans = segmentsOf(from, to);
    expect(spans).toEqual([
      [from, at('2026-11-14', 0)],
      [at('2026-11-14', 0), at('2026-11-15', 0)],
      [at('2026-11-15', 0), at('2026-11-16', 0)],
      [at('2026-11-16', 0), to],
    ]);
    expect(total(spans)).toBe(to.getTime() - from.getTime());
  });

  it('ends a segment at midnight and starts none for a block ending there', () => {
    const from = at('2026-11-10', 20);
    const to = at('2026-11-11', 0);
    expect(segmentsOf(from, to)).toEqual([[from, to]]);
  });

  it('counts the 23-hour day of the spring clock change', () => {
    const spans = segmentsOf(at('2027-03-27', 12), at('2027-03-29', 6));
    expect(hours(spans)).toEqual([12, 23, 6]);
  });

  it('counts the 25-hour day of the autumn clock change', () => {
    const spans = segmentsOf(at('2026-10-24', 12), at('2026-10-26', 6));
    expect(hours(spans)).toEqual([12, 25, 6]);
  });
});
