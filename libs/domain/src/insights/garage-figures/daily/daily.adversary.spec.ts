// @traces 098-FR-003 098-FR-004 098-FR-005 098-FR-008 098-FR-011
import {
  dailyPeriods,
  estimatedWork,
  freeSlotsKey,
  nextFreeSlots,
} from './daily';

const HOUR = 3_600_000;
const hours = (w: { gte: Date; lt: Date }) =>
  (w.lt.getTime() - w.gte.getTime()) / HOUR;

const quote = (
  fromBani: number,
  toBani: number,
  booking: {
    status: string;
    job: { finalPriceBani: number | null } | null;
  } | null = null,
) => ({ booking, fromBani, toBani });

describe('the daily periods at the edges of a year, a leap day and the clock changes', () => {
  it('rolls the day, the week and the month over New Year', () => {
    // Friday 1 January 2027, 00:00 in Bucharest.
    const p = dailyPeriods(new Date('2026-12-31T22:00:00Z'));

    expect(p.today).toEqual({
      gte: new Date('2026-12-31T22:00:00Z'),
      lt: new Date('2027-01-01T22:00:00Z'),
    });
    expect(p.yesterday.gte).toEqual(new Date('2026-12-30T22:00:00Z'));
    expect(p.week).toEqual({
      gte: new Date('2026-12-27T22:00:00Z'),
      lt: new Date('2027-01-03T22:00:00Z'),
    });
    expect(p.month).toEqual({
      gte: new Date('2026-12-31T22:00:00Z'),
      lt: new Date('2027-01-31T22:00:00Z'),
    });
    expect(p.monthDay).toBe('2027-01-01');
    expect(p.sunday).toBe('2027-01-03');
  });

  it('still belongs to December one millisecond before New Year in Bucharest', () => {
    const p = dailyPeriods(new Date('2026-12-31T21:59:59.999Z'));

    expect(p.monthDay).toBe('2026-12-01');
    expect(p.today.lt).toEqual(new Date('2026-12-31T22:00:00Z'));
  });

  it('gives February of a leap year 29 days', () => {
    const p = dailyPeriods(new Date('2028-02-29T10:00:00Z'));

    expect(hours(p.month)).toBe(29 * 24);
    expect(p.monthDay).toBe('2028-02-01');
  });

  it('gives March 743 hours and October 745 around the clock changes', () => {
    expect(hours(dailyPeriods(new Date('2026-03-15T10:00:00Z')).month)).toBe(
      743,
    );
    expect(hours(dailyPeriods(new Date('2026-10-15T10:00:00Z')).month)).toBe(
      745,
    );
  });

  it('gives the week of the March change 167 hours and yesterday of the Monday after 23', () => {
    expect(hours(dailyPeriods(new Date('2026-03-27T10:00:00Z')).week)).toBe(
      167,
    );
    const monday = dailyPeriods(new Date('2026-03-30T10:00:00Z'));
    expect(hours(monday.yesterday)).toBe(23);
    expect(hours(monday.today)).toBe(24);
  });

  it('begins the 25-hour day of October at local midnight on summer time', () => {
    // Sunday 25 October 2026, 00:00 in Bucharest is still UTC+3.
    const p = dailyPeriods(new Date('2026-10-24T21:00:00Z'));

    expect(p.today).toEqual({
      gte: new Date('2026-10-24T21:00:00Z'),
      lt: new Date('2026-10-25T22:00:00Z'),
    });
  });

  it('leaves no gap and no overlap between yesterday and today', () => {
    const p = dailyPeriods(new Date('2026-03-29T12:00:00Z'));

    expect(p.yesterday.lt).toEqual(p.today.gte);
  });

  it('answers the same for the same instant called twice', () => {
    const now = new Date('2026-11-04T09:00:00Z');

    expect(dailyPeriods(now)).toEqual(dailyPeriods(now));
  });

  it('does not move the instant it is given', () => {
    const now = new Date('2026-11-04T09:00:00Z');
    dailyPeriods(now);

    expect(now.toISOString()).toBe('2026-11-04T09:00:00.000Z');
  });
});

describe('the estimated work at its extremes', () => {
  it('keeps a recorded final price of zero instead of falling back to the range', () => {
    expect(
      estimatedWork([
        quote(10_000, 20_000, {
          job: { finalPriceBani: 0 },
          status: 'completed',
        }),
      ]),
    ).toBe(0);
  });

  it('falls back to the range when the job has no final price yet', () => {
    expect(
      estimatedWork([
        quote(10_000, 20_000, {
          job: { finalPriceBani: null },
          status: 'confirmed',
        }),
      ]),
    ).toBe(15_000);
  });

  it('rounds .5 up for every odd sum and leaves even sums alone', () => {
    expect(estimatedWork([quote(0, 1)])).toBe(1);
    expect(estimatedWork([quote(1, 2)])).toBe(2);
    expect(estimatedWork([quote(2, 2)])).toBe(2);
    expect(estimatedWork([quote(0, 0)])).toBe(0);
  });

  it('rounds each quote before summing, not the total', () => {
    expect(estimatedWork([quote(0, 1), quote(0, 1), quote(0, 1)])).toBe(3);
  });

  it('sums ten thousand quotes exactly', () => {
    const many = Array.from({ length: 10_000 }, () => quote(100, 300));

    expect(estimatedWork(many)).toBe(2_000_000);
  });

  it('sums beyond the 32-bit range without wrapping', () => {
    const big = quote(4_000_000_000, 4_000_000_000);

    expect(estimatedWork([big, big, big])).toBe(12_000_000_000);
  });

  it('gives the same sum whatever the order of the quotes', () => {
    const a = quote(101, 202);
    const b = quote(5, 6, { job: { finalPriceBani: 77 }, status: 'completed' });
    const c = quote(9, 10, { job: null, status: 'lapsed' });

    expect(estimatedWork([a, b, c])).toBe(estimatedWork([c, b, a]));
  });

  it('counts a booking in a status it does not know', () => {
    expect(
      estimatedWork([quote(10, 20, { job: null, status: 'rescheduled' })]),
    ).toBe(15);
  });

  it('leaves out a lost booking even when a final price is recorded', () => {
    expect(
      estimatedWork([
        quote(10, 20, { job: { finalPriceBani: 999 }, status: 'cancelled' }),
        quote(10, 20, { job: { finalPriceBani: 999 }, status: 'lapsed' }),
      ]),
    ).toBe(0);
  });

  it('does not change the list it is given', () => {
    const list = [quote(10, 20), quote(1, 2, { job: null, status: 'lapsed' })];
    const copy = structuredClone(list);
    estimatedWork(list);

    expect(list).toEqual(copy);
  });
});

describe('the free-slot question around its rounding and Sunday edges', () => {
  const sunday = '2026-11-08';

  it('keeps a start exactly on the half hour an hour away', () => {
    // Wednesday 4 November 2026, 10:00:00.000 in Bucharest.
    const key = freeSlotsKey('g', new Date('2026-11-04T08:00:00Z'), sunday);

    expect(key?.earliest).toEqual(new Date('2026-11-04T09:00:00Z'));
  });

  it('rounds one millisecond past the half hour up to the next', () => {
    const key = freeSlotsKey('g', new Date('2026-11-04T08:00:00.001Z'), sunday);

    expect(key?.earliest).toEqual(new Date('2026-11-04T09:30:00Z'));
  });

  it('still asks at 22:59:59 on Sunday, when the earliest start is 00:00', () => {
    const key = freeSlotsKey('g', new Date('2026-11-08T20:29:59Z'), sunday);

    expect(key?.earliest).toEqual(new Date('2026-11-08T21:30:00Z'));
    expect(key?.horizonDays).toBe(1);
  });

  it('does not ask at 23:00:00 on Sunday, when the earliest start is midnight', () => {
    expect(
      freeSlotsKey('g', new Date('2026-11-08T21:00:00Z'), sunday),
    ).toBeUndefined();
  });

  it('asks for seven days from Monday morning', () => {
    // Monday 2 November 2026, 00:00 in Bucharest.
    const key = freeSlotsKey('g', new Date('2026-11-01T22:00:00Z'), sunday);

    expect(key?.horizonDays).toBe(7);
  });

  it('starts the horizon on Monday when the hour ahead crosses midnight', () => {
    // Sunday 1 November 2026, 23:30 in Bucharest; the week it asks about ends on the 8th.
    const key = freeSlotsKey('g', new Date('2026-11-01T21:30:00Z'), sunday);

    expect(key?.earliest).toEqual(new Date('2026-11-01T22:30:00Z'));
    expect(key?.horizonDays).toBe(7);
  });

  it('is undefined when Sunday is already past', () => {
    expect(
      freeSlotsKey('g', new Date('2026-11-20T08:00:00Z'), sunday),
    ).toBeUndefined();
  });

  it('carries the garage id through untouched', () => {
    const id = '3f0c1d9e-0000-4000-8000-000000000001';

    expect(
      freeSlotsKey(id, new Date('2026-11-04T08:00:00Z'), sunday)?.garageId,
    ).toBe(id);
  });

  it('asks the same of the same instant twice', () => {
    const now = new Date('2026-11-04T08:10:00Z');

    expect(freeSlotsKey('g', now, sunday)).toEqual(
      freeSlotsKey('g', now, sunday),
    );
  });
});

describe('the next free slots from the engine’s answer', () => {
  const sunday = '2026-11-08';
  const slot = (startsAt: string) => ({ endsAt: startsAt, startsAt });

  it('counts ten starts on one day', () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      slot(`2026-11-06T${String(8 + i).padStart(2, '0')}:00:00+02:00`),
    );

    expect(nextFreeSlots(ten, sunday)).toEqual({
      count: 10,
      day: '2026-11-06',
    });
  });

  it('keeps a start on Sunday itself and counts it alone', () => {
    expect(nextFreeSlots([slot('2026-11-08T00:00:00+02:00')], sunday)).toEqual({
      count: 1,
      day: '2026-11-08',
    });
  });

  it('is null when every start is a week late', () => {
    expect(
      nextFreeSlots([slot('2026-11-15T09:00:00+02:00')], sunday),
    ).toBeNull();
  });

  it('does not change the list it is given', () => {
    const list = [
      slot('2026-11-07T09:00:00+02:00'),
      slot('2026-11-06T09:00:00+02:00'),
    ];
    const copy = structuredClone(list);
    nextFreeSlots(list, sunday);

    expect(list).toEqual(copy);
  });
});
