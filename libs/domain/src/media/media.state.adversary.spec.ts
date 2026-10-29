// @traces 333-FR-001
import { purgeAfter } from './media.state';

describe('purge date', () => {
  const sent = new Date('2026-03-28T23:30:00.000Z');

  it('adds whole days in milliseconds across a daylight-saving change', () => {
    expect(purgeAfter(sent, 1).toISOString()).toBe('2026-03-29T23:30:00.000Z');
    expect(purgeAfter(sent, 90).toISOString()).toBe('2026-06-26T23:30:00.000Z');
  });

  it('does not mutate the sent date', () => {
    purgeAfter(sent, 90);
    expect(sent.toISOString()).toBe('2026-03-28T23:30:00.000Z');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %p days',
    (days) => {
      expect(() => purgeAfter(sent, days)).toThrow(/whole number of days/);
    },
  );

  it('refuses days given as a string', () => {
    expect(() => purgeAfter(sent, '90' as unknown as number)).toThrow();
  });
});
