import {
  closed,
  EVERY_DAY,
  OPEN_STATUS_CASES,
  shut,
  WEEK,
} from './clock-cases.testing';
import type { WeeklyHours } from './garage-hours';
import { bucharestClock, openStatus } from './open-status';

const run = (from: string, days: number) =>
  Array.from({ length: days }, (_, i) =>
    closed(
      new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
    ),
  );

// @traces 309-FR-001 309-FR-002 309-FR-003 309-FR-004 309-FR-013
describe('whether a garage is open now', () => {
  it.each(OPEN_STATUS_CASES)(
    'answers %s',
    (_title, hours, closedDays, at, expected) => {
      expect(openStatus(hours, closedDays, new Date(at))).toEqual(expected);
    },
  );

  it('gives the next opening nine days ahead after a long run of closed days', () => {
    expect(
      openStatus(
        EVERY_DAY,
        run('2027-11-02', 9),
        new Date('2027-11-02T10:00:00+02:00'),
      ),
    ).toEqual(shut('closed', 9, '08:00'));
  });

  it('opens on the last day of the window when the fourteen days before it are shut', () => {
    expect(
      openStatus(
        EVERY_DAY,
        run('2027-11-02', 14),
        new Date('2027-11-02T10:00:00+02:00'),
      ),
    ).toEqual(shut('closed', 14, '08:00'));
  });

  it('answers no line when fifteen days in a row are shut', () => {
    expect(
      openStatus(
        EVERY_DAY,
        run('2027-11-02', 15),
        new Date('2027-11-02T10:00:00+02:00'),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('answers no line for weekly closed days and closed days that together shut fifteen days', () => {
    const weekendsOnly: WeeklyHours = {
      ...EVERY_DAY,
      fri: [],
      mon: [],
      thu: [],
      tue: [],
      wed: [],
    };
    const weekends = [
      '2027-11-06',
      '2027-11-07',
      '2027-11-13',
      '2027-11-14',
    ].map(closed);
    expect(
      openStatus(weekendsOnly, weekends, new Date('2027-11-02T10:00:00+02:00')),
    ).toEqual({ kind: 'none' });
  });

  it('answers no line for a garage that never sent its hours', () => {
    expect(openStatus({}, [], new Date('2027-11-02T10:00:00+02:00'))).toEqual({
      kind: 'none',
    });
  });

  it('answers no line for a table the hours guard refuses', () => {
    const now = new Date('2027-11-02T10:00:00+02:00');
    expect(openStatus({ ...WEEK, tue: [['19:00', '08:00']] }, [], now)).toEqual(
      { kind: 'none' },
    );
    expect(openStatus({ mon: 'all day' }, [], now)).toEqual({ kind: 'none' });
    expect(openStatus(null, [], now)).toEqual({ kind: 'none' });
  });

  it('ignores a closed day before today', () => {
    expect(
      openStatus(
        WEEK,
        [closed('2027-11-01')],
        new Date('2027-11-02T10:15:00+02:00'),
      ),
    ).toEqual({ kind: 'open', until: '19:00' });
  });
});

// @traces 1260-FR-002 1260-FR-003
describe('the Bucharest clock of an instant', () => {
  it.each([
    [
      '2027-11-02T10:15:00+02:00',
      { day: '2027-11-02', time: '10:15', weekday: 'tue' },
    ],
    [
      '2027-11-02T23:59:00+02:00',
      { day: '2027-11-02', time: '23:59', weekday: 'tue' },
    ],
    [
      '2027-11-02T22:30:00Z',
      { day: '2027-11-03', time: '00:30', weekday: 'wed' },
    ],
    [
      '2027-11-06T10:00:00+02:00',
      { day: '2027-11-06', time: '10:00', weekday: 'sat' },
    ],
    [
      '2027-03-28T00:59:00Z',
      { day: '2027-03-28', time: '02:59', weekday: 'sun' },
    ],
    [
      '2027-03-28T01:00:00Z',
      { day: '2027-03-28', time: '04:00', weekday: 'sun' },
    ],
    [
      '2027-10-31T00:30:00Z',
      { day: '2027-10-31', time: '03:30', weekday: 'sun' },
    ],
    [
      '2027-10-31T01:30:00Z',
      { day: '2027-10-31', time: '03:30', weekday: 'sun' },
    ],
  ])('reads %s as its Bucharest day, time and weekday', (at, clock) => {
    expect(bucharestClock(new Date(at))).toEqual(clock);
  });

  it('writes midnight as 00:00, never 24:00', () => {
    expect(bucharestClock(new Date('2027-11-02T22:00:00Z')).time).toBe('00:00');
  });
});
