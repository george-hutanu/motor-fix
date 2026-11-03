// @traces 098-FR-003 098-FR-004 098-FR-005 098-FR-008 098-FR-011
import {
  dailyPeriods,
  estimatedWork,
  freeSlotsKey,
  nextFreeSlots,
} from './daily';

const HOUR = 3_600_000;
const span = (w: { gte: Date; lt: Date }) =>
  (w.lt.getTime() - w.gte.getTime()) / HOUR;

describe('the daily periods', () => {
  it('cut today, yesterday, the week and the month at Bucharest midnights', () => {
    // Wednesday 4 November 2026, 23:59 in Bucharest (UTC+2).
    const p = dailyPeriods(new Date('2026-11-04T21:59:00Z'));

    expect(p.today).toEqual({
      gte: new Date('2026-11-03T22:00:00Z'),
      lt: new Date('2026-11-04T22:00:00Z'),
    });
    expect(p.yesterday).toEqual({
      gte: new Date('2026-11-02T22:00:00Z'),
      lt: new Date('2026-11-03T22:00:00Z'),
    });
    expect(p.week).toEqual({
      gte: new Date('2026-11-01T22:00:00Z'),
      lt: new Date('2026-11-08T22:00:00Z'),
    });
    expect(p.month).toEqual({
      gte: new Date('2026-10-31T22:00:00Z'),
      lt: new Date('2026-11-30T22:00:00Z'),
    });
    expect(p.sunday).toBe('2026-11-08');
    expect(p.monthDay).toBe('2026-11-01');
  });

  it('moves to the next day at 00:00 Bucharest, not at UTC midnight', () => {
    const p = dailyPeriods(new Date('2026-11-04T22:00:00Z'));

    expect(p.today.gte).toEqual(new Date('2026-11-04T22:00:00Z'));
    expect(p.yesterday.gte).toEqual(new Date('2026-11-03T22:00:00Z'));
  });

  it('counts the 23-hour day of the March clock change and the 25-hour day of October', () => {
    expect(span(dailyPeriods(new Date('2026-03-29T10:00:00Z')).today)).toBe(23);
    expect(span(dailyPeriods(new Date('2026-10-25T10:00:00Z')).today)).toBe(25);
    expect(span(dailyPeriods(new Date('2026-10-26T10:00:00Z')).yesterday)).toBe(
      25,
    );
    expect(span(dailyPeriods(new Date('2026-10-14T10:00:00Z')).week)).toBe(
      7 * 24,
    );
    // The week of 19 to 25 October ends on the October change.
    expect(span(dailyPeriods(new Date('2026-10-25T10:00:00Z')).week)).toBe(
      7 * 24 + 1,
    );
  });

  it('starts the week on Monday 00:00 and ends it on Sunday 24:00', () => {
    // Monday 2 November 2026, 00:00 in Bucharest.
    const monday = dailyPeriods(new Date('2026-11-01T22:00:00Z'));
    // Sunday 8 November 2026, 23:59 in Bucharest.
    const sunday = dailyPeriods(new Date('2026-11-08T21:59:00Z'));

    expect(monday.week).toEqual(sunday.week);
    expect(monday.sunday).toBe('2026-11-08');
    // The Sunday before belongs to the week before.
    expect(dailyPeriods(new Date('2026-11-01T21:59:00Z')).sunday).toBe(
      '2026-11-01',
    );
  });

  it('names the month from the first of the month in Bucharest', () => {
    // 1 December 2026, 00:30 in Bucharest, still 30 November in UTC.
    const p = dailyPeriods(new Date('2026-11-30T22:30:00Z'));

    expect(p.monthDay).toBe('2026-12-01');
    expect(p.month.gte).toEqual(new Date('2026-11-30T22:00:00Z'));
    expect(p.month.lt).toEqual(new Date('2026-12-31T22:00:00Z'));
  });
});

const row = (
  fromBani: number,
  toBani: number,
  booking?: { status: string; finalPriceBani?: number | null },
) => ({
  booking: booking
    ? {
        job:
          booking.finalPriceBani === undefined
            ? null
            : { finalPriceBani: booking.finalPriceBani },
        status: booking.status,
      }
    : null,
  fromBani,
  toBani,
});

describe('the estimated work', () => {
  it('takes the final price where recorded, else the middle of the range', () => {
    expect(
      estimatedWork([
        row(42_000, 65_000, { finalPriceBani: 60_000, status: 'completed' }),
        row(76_000, 110_000, { status: 'confirmed' }),
      ]),
    ).toBe(153_000);
  });

  it('leaves out lapsed, cancelled and no-show bookings', () => {
    expect(
      estimatedWork([
        row(10_000, 20_000, { status: 'lapsed' }),
        row(10_000, 20_000, { status: 'cancelled' }),
        row(10_000, 20_000, { finalPriceBani: 9_000, status: 'no_show' }),
        row(10_000, 20_000, { status: 'confirmed' }),
      ]),
    ).toBe(15_000);
  });

  it('counts a quote awaiting confirmation and one with no booking yet', () => {
    expect(
      estimatedWork([
        row(10_000, 20_000, { status: 'awaiting_confirmation' }),
        row(30_000, 40_000),
      ]),
    ).toBe(50_000);
  });

  it('rounds the middle half up to whole bani', () => {
    expect(estimatedWork([row(100, 101)])).toBe(101);
    expect(
      estimatedWork([
        row(100, 103, { finalPriceBani: null, status: 'confirmed' }),
      ]),
    ).toBe(102);
  });

  it('is 0 with no quote', () => {
    expect(estimatedWork([])).toBe(0);
  });
});

const slot = (startsAt: string) => ({
  endsAt: startsAt,
  startsAt,
});

describe('the next free slots of the week', () => {
  it('names the first day with a start and counts its starts', () => {
    expect(
      nextFreeSlots(
        [
          slot('2026-11-06T10:00:00+02:00'),
          slot('2026-11-06T14:30:00+02:00'),
          slot('2026-11-07T09:00:00+02:00'),
        ],
        '2026-11-08',
      ),
    ).toEqual({ count: 2, day: '2026-11-06' });
  });

  it('drops the starts after Sunday', () => {
    expect(
      nextFreeSlots(
        [slot('2026-11-09T08:00:00+02:00'), slot('2026-11-09T09:00:00+02:00')],
        '2026-11-08',
      ),
    ).toBeNull();
    expect(
      nextFreeSlots(
        [slot('2026-11-08T23:30:00+02:00'), slot('2026-11-09T08:00:00+02:00')],
        '2026-11-08',
      ),
    ).toEqual({ count: 1, day: '2026-11-08' });
  });

  it('is null with no start', () => {
    expect(nextFreeSlots([], '2026-11-08')).toBeNull();
  });
});

describe('the free-slot question of the week', () => {
  it('asks for an hour without a lift, from an hour on rounded up to the half hour, to Sunday', () => {
    // Wednesday 4 November 2026, 10:10 in Bucharest.
    const key = freeSlotsKey(
      'g-1',
      new Date('2026-11-04T08:10:00Z'),
      '2026-11-08',
    );

    expect(key).toEqual({
      count: 10,
      duration: 60,
      earliest: new Date('2026-11-04T09:30:00Z'),
      garageId: 'g-1',
      horizonDays: 5,
      needsLift: false,
    });
  });

  it('asks for Sunday alone late on Sunday', () => {
    // Sunday 8 November 2026, 20:00 in Bucharest.
    const key = freeSlotsKey(
      'g-1',
      new Date('2026-11-08T18:00:00Z'),
      '2026-11-08',
    );

    expect(key?.horizonDays).toBe(1);
  });

  it('does not ask once the earliest start falls after Sunday', () => {
    // Sunday 8 November 2026, 23:10 in Bucharest: the earliest start is Monday.
    expect(
      freeSlotsKey('g-1', new Date('2026-11-08T21:10:00Z'), '2026-11-08'),
    ).toBeUndefined();
  });
});
