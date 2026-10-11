import {
  addLocalDays,
  atLocal,
  isoWeek,
  localDay,
  monthStart,
  weekStart,
} from './bucharest';

describe('monthStart', () => {
  it.each([
    ['2026-10-07', '2026-10-01'],
    ['2026-10-01', '2026-10-01'],
    ['2026-10-31', '2026-10-01'],
    ['2026-03-29', '2026-03-01'],
    ['2027-01-15', '2027-01-01'],
  ])('gives the first day of the month of %s', (day, first) => {
    expect(monthStart(day)).toBe(first);
  });

  it('starts the month at midnight in Bucharest, the evening before in UTC', () => {
    const now = new Date('2026-10-31T22:30:00Z');

    expect(localDay(now)).toBe('2026-11-01');
    expect(atLocal(monthStart(localDay(now)), 0)).toEqual(
      new Date('2026-10-31T22:00:00Z'),
    );
  });
});

// @traces 374-FR-009
describe('weekStart', () => {
  it.each([
    ['2026-10-05', '2026-10-05'],
    ['2026-10-09', '2026-10-05'],
    ['2026-10-11', '2026-10-05'],
    ['2026-10-25', '2026-10-19'],
    ['2026-10-26', '2026-10-26'],
    ['2027-01-03', '2026-12-28'],
  ])('gives the Monday of the week of %s', (day, monday) => {
    expect(weekStart(day)).toBe(monday);
  });

  it('starts the week of the autumn clock change at midnight in Bucharest, summer time', () => {
    expect(atLocal(weekStart('2026-10-25'), 0)).toEqual(
      new Date('2026-10-18T21:00:00Z'),
    );
  });
});

// @traces 220-FR-001
describe('addLocalDays', () => {
  it('keeps the Bucharest wall clock across the autumn clock change', () => {
    // 21 October, 10:15:30.250 in Bucharest (UTC+3).
    const sent = new Date('2026-10-21T07:15:30.250Z');

    const expires = addLocalDays(sent, 7);

    // 28 October, 10:15:30.250 in Bucharest (UTC+2): 169 hours later.
    expect(expires).toEqual(new Date('2026-10-28T08:15:30.250Z'));
    expect(expires.getTime() - sent.getTime()).toBe(169 * 3_600_000);
  });

  it('keeps the Bucharest wall clock across the spring clock change', () => {
    const sent = new Date('2026-03-25T21:59:00.000Z');

    const expires = addLocalDays(sent, 7);

    expect(expires).toEqual(new Date('2026-04-01T20:59:00.000Z'));
    expect(expires.getTime() - sent.getTime()).toBe(167 * 3_600_000);
  });

  it('moves across a month and a year end on the same local day count', () => {
    const sent = new Date('2026-12-28T22:30:00.000Z');

    expect(localDay(addLocalDays(sent, 7))).toBe('2027-01-05');
    expect(addLocalDays(sent, 7)).toEqual(new Date('2027-01-04T22:30:00.000Z'));
  });

  it('adds whole days of 24 hours when no clock change lies between', () => {
    const sent = new Date('2026-11-10T09:00:00.000Z');

    expect(addLocalDays(sent, 2)).toEqual(new Date('2026-11-12T09:00:00.000Z'));
  });
});

// @traces 143-FR-013
describe('isoWeek', () => {
  it.each([
    ['2026-09-28', '2026-W40'],
    ['2026-10-04', '2026-W40'],
    ['2026-10-05', '2026-W41'],
    ['2026-10-12', '2026-W42'],
    ['2025-12-29', '2026-W01'],
    ['2026-01-01', '2026-W01'],
    ['2026-12-31', '2026-W53'],
    ['2027-01-03', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2024-12-30', '2025-W01'],
    ['2021-01-03', '2020-W53'],
    ['2020-12-31', '2020-W53'],
  ])('labels %s as %s', (day, week) => {
    expect(isoWeek(day)).toBe(week);
  });
});
