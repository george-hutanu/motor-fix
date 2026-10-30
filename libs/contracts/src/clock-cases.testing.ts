// The status function's cases, shared by its own spec and by every rule that
// must answer as it does (the search's open-now filter).
import type { WeeklyHours } from './garage-hours';
import type { ClosedDayAhead, OpenStatus } from './open-status';

const DAY: [string, string][] = [['08:00', '19:00']];
export const WEEK: WeeklyHours = {
  fri: DAY,
  mon: DAY,
  sat: [['09:00', '14:00']],
  sun: [],
  thu: DAY,
  tue: DAY,
  wed: DAY,
};
export const EVERY_DAY: WeeklyHours = {
  fri: DAY,
  mon: DAY,
  sat: DAY,
  sun: DAY,
  thu: DAY,
  tue: DAY,
  wed: DAY,
};
const LUNCH: WeeklyHours = {
  ...WEEK,
  mon: [
    ['08:00', '12:00'],
    ['13:00', '19:00'],
  ],
};
const ROUND_THE_CLOCK: WeeklyHours = Object.fromEntries(
  Object.keys(WEEK).map((day) => [day, [['00:00', '23:45']]]),
) as WeeklyHours;

const holiday = (day: string): ClosedDayAhead => ({
  day,
  reason: 'holiday',
});
export const closed = (day: string): ClosedDayAhead => ({
  day,
  reason: 'closed',
});
export const shut = (
  reason: 'hours' | 'holiday' | 'closed',
  inDays: number,
  at: string,
) => ({ kind: 'closed', next: { at, inDays }, reason }) as const;

// Every instant is written with its Bucharest offset: +02:00 in winter,
// +03:00 in summer.
export const OPEN_STATUS_CASES: [
  string,
  WeeklyHours,
  ClosedDayAhead[],
  string,
  OpenStatus,
][] = [
  [
    'open on a weekday morning',
    WEEK,
    [],
    '2027-11-02T10:15:00+02:00',
    { kind: 'open', until: '19:00' },
  ],
  [
    'before opening',
    WEEK,
    [],
    '2027-11-02T07:30:00+02:00',
    shut('hours', 0, '08:00'),
  ],
  [
    'after closing',
    WEEK,
    [],
    '2027-11-02T19:30:00+02:00',
    shut('hours', 1, '08:00'),
  ],
  [
    'open at the exact start of an interval',
    WEEK,
    [],
    '2027-11-02T08:00:00+02:00',
    { kind: 'open', until: '19:00' },
  ],
  [
    'closed at the exact end of an interval',
    WEEK,
    [],
    '2027-11-02T19:00:00+02:00',
    shut('hours', 1, '08:00'),
  ],
  [
    'on Saturday with hours',
    WEEK,
    [],
    '2027-11-06T10:00:00+02:00',
    { kind: 'open', until: '14:00' },
  ],
  [
    'after Saturday hours, opening on Monday',
    WEEK,
    [],
    '2027-11-06T15:00:00+02:00',
    shut('hours', 2, '08:00'),
  ],
  [
    'on a Sunday with no hours',
    WEEK,
    [],
    '2027-11-07T12:00:00+02:00',
    shut('hours', 1, '08:00'),
  ],
  [
    'in the morning interval of a split day',
    LUNCH,
    [],
    '2027-11-08T10:00:00+02:00',
    { kind: 'open', until: '12:00' },
  ],
  [
    'on the lunch break',
    LUNCH,
    [],
    '2027-11-08T12:20:00+02:00',
    { kind: 'break', until: '13:00' },
  ],
  [
    'on the break from the end of the first interval',
    LUNCH,
    [],
    '2027-11-08T12:00:00+02:00',
    { kind: 'break', until: '13:00' },
  ],
  [
    'on a legal holiday',
    WEEK,
    [holiday('2027-12-01')],
    '2027-12-01T10:15:00+02:00',
    shut('holiday', 1, '08:00'),
  ],
  [
    'on a closed day of the garage',
    WEEK,
    [closed('2027-12-27')],
    '2027-12-27T10:15:00+02:00',
    shut('closed', 1, '08:00'),
  ],
  [
    'on two holidays in a row',
    EVERY_DAY,
    [holiday('2027-12-25'), holiday('2027-12-26')],
    '2027-12-25T10:00:00+02:00',
    shut('holiday', 2, '08:00'),
  ],
  [
    'on Orthodox Easter Monday',
    WEEK,
    [holiday('2027-05-03')],
    '2027-05-03T10:00:00+03:00',
    shut('holiday', 1, '08:00'),
  ],
  [
    'with a holiday and a closed day on one day',
    WEEK,
    [closed('2027-12-01'), holiday('2027-12-01')],
    '2027-12-01T10:15:00+02:00',
    shut('holiday', 1, '08:00'),
  ],
  [
    'at opening time on the night summer time starts',
    EVERY_DAY,
    [],
    '2027-03-28T08:00:00+03:00',
    { kind: 'open', until: '19:00' },
  ],
  [
    'just before opening on the night summer time starts',
    EVERY_DAY,
    [],
    '2027-03-28T07:59:00+03:00',
    shut('hours', 0, '08:00'),
  ],
  [
    'at opening time on the night summer time ends',
    EVERY_DAY,
    [],
    '2027-10-31T08:00:00+02:00',
    { kind: 'open', until: '19:00' },
  ],
  [
    'in the hour that repeats on the night summer time ends',
    EVERY_DAY,
    [],
    '2027-10-31T03:30:00+03:00',
    shut('hours', 0, '08:00'),
  ],
  [
    'after the last interval of a day open until 23:45',
    ROUND_THE_CLOCK,
    [],
    '2027-11-02T23:50:00+02:00',
    shut('hours', 1, '00:00'),
  ],
];
