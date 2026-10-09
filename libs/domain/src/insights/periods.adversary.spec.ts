import { periodRange } from './periods';

// @traces 163-FR-002
describe('the period ranges at the calendar edges', () => {
  it('starts 12m in January of the previous year when run in December', () => {
    expect(periodRange('12m', new Date('2026-12-15T10:00:00Z'))?.firstDay).toBe(
      '2026-01-01',
    );
  });

  it('starts 12m in the previous year when run in January', () => {
    expect(periodRange('12m', new Date('2027-01-01T10:00:00Z'))?.firstDay).toBe(
      '2026-02-01',
    );
  });

  it('counts 30d across a leap day', () => {
    expect(periodRange('30d', new Date('2028-03-10T10:00:00Z'))?.firstDay).toBe(
      '2028-02-10',
    );
  });

  it('counts 7d across a year end', () => {
    expect(periodRange('7d', new Date('2027-01-03T10:00:00Z'))?.firstDay).toBe(
      '2026-12-28',
    );
  });

  it('starts at 22:00 UTC the evening before in winter and 21:00 in summer', () => {
    expect(
      periodRange(
        'today',
        new Date('2026-01-15T10:00:00Z'),
      )?.since.toISOString(),
    ).toBe('2026-01-14T22:00:00.000Z');
    expect(
      periodRange(
        'today',
        new Date('2026-07-15T10:00:00Z'),
      )?.since.toISOString(),
    ).toBe('2026-07-14T21:00:00.000Z');
  });

  it('puts the day of the spring clock change at midnight local, not 24 hours later', () => {
    const range = periodRange('7d', new Date('2026-03-29T12:00:00Z'));

    expect(range?.firstDay).toBe('2026-03-23');
    expect(range?.since.toISOString()).toBe('2026-03-22T22:00:00.000Z');
  });

  it('puts late evening UTC on the next local day at the new year', () => {
    expect(
      periodRange('today', new Date('2026-12-31T22:30:00Z'))?.firstDay,
    ).toBe('2027-01-01');
  });
});
