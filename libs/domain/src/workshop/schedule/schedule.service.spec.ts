import type { Interval, WeeklyHours } from '@motor-fix/contracts';

import {
  judgeOverlaps,
  type PlacementInput,
  placementOf,
  placeSegments,
  ScheduleService,
  type TakenSegment,
} from './schedule.service';
import { atLocal } from '../../bucharest';

const MON = '2026-11-09';
const TUE = '2026-11-10';
const WED = '2026-11-11';
const SAT = '2026-11-14';
const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000);
const minutes = (spans: [Date, Date][]) =>
  spans.reduce((sum, [a, b]) => sum + (b.getTime() - a.getTime()) / 60_000, 0);

const SPLIT: Interval[] = [
  ['08:00', '12:00'],
  ['13:00', '17:00'],
];
const week = (
  day: Interval[],
  extra: Partial<WeeklyHours> = {},
): WeeklyHours => ({
  fri: day,
  mon: day,
  sat: [],
  sun: [],
  thu: day,
  tue: day,
  wed: day,
  ...extra,
});

// The refusal a call throws, as the problem details carry it.
function refused(call: () => unknown) {
  try {
    call();
  } catch (error) {
    return (error as { getResponse: () => unknown }).getResponse();
  }
  throw new Error('not refused');
}

// @traces 150-FR-003
// @traces 150-FR-013
describe('placing a job on the working stretches', () => {
  const days: [Date, Date][] = [
    [at(MON, 8), at(MON, 16)],
    [at(TUE, 8), at(TUE, 16)],
    [at(WED, 8), at(WED, 16)],
  ];

  it('gives one segment to a job that ends inside the stretch it starts in', () => {
    expect(placeSegments(days, at(MON, 9), 90)).toEqual([
      [at(MON, 9), at(MON, 10, 30)],
    ]);
  });

  it('refuses a job no longer than its stretch that does not end inside it', () => {
    expect(placeSegments(days, at(MON, 15), 120)).toBeNull();
    expect(placeSegments(days, at(MON, 9), 480)).toBeNull();
  });

  it('fills the stretch of a longer job and continues at the start of the next ones', () => {
    const placed = placeSegments(days, at(MON, 15), 720);

    expect(placed).toEqual([
      [at(MON, 15), at(MON, 16)],
      [at(TUE, 8), at(TUE, 16)],
      [at(WED, 8), at(WED, 11)],
    ]);
    expect(minutes(placed ?? [])).toBe(720);
  });

  it("continues on the same day's next interval", () => {
    const split: [Date, Date][] = [
      [at(MON, 8), at(MON, 12)],
      [at(MON, 13), at(MON, 17)],
    ];

    expect(placeSegments(split, at(MON, 8), 300)).toEqual([
      [at(MON, 8), at(MON, 12)],
      [at(MON, 13), at(MON, 14)],
    ]);
  });

  it('refuses a start outside every stretch', () => {
    expect(placeSegments(days, at(MON, 7), 60)).toBeNull();
    expect(placeSegments(days, at(MON, 16), 60)).toBeNull();
  });

  it('refuses a job the stretches run out on', () => {
    expect(placeSegments(days, at(MON, 8), 8 * 3 * 60 + 1)).toBeNull();
  });

  it('counts the real minutes of a clock-change day', () => {
    const october: [Date, Date][] = [
      [at('2026-10-25', 0), at('2026-10-25', 8)],
    ];

    expect(placeSegments(october, at('2026-10-25', 0), 540)).toEqual(october);
    expect(placeSegments(october, at('2026-10-25', 1), 240)).toEqual([
      [
        at('2026-10-25', 1),
        new Date(at('2026-10-25', 1).getTime() + 240 * 60_000),
      ],
    ]);
  });
});

// @traces 150-FR-002
// @traces 150-FR-008
describe('the order of the refusals', () => {
  const input = (extra: Partial<PlacementInput> = {}): PlacementInput => ({
    calendar: {
      closedDays: new Set<string>(),
      holidays: new Set<string>(),
      hours: week(SPLIT, { sat: [['09:00', '14:00']] }),
    },
    durationMinutes: 90,
    language: 'ro',
    lift: null,
    mechanic: {
      id: 'elena',
      name: 'Elena Stan',
      schedule: {
        daysOff: [],
        workingHours: week([['08:00', '16:00']], { sat: [['09:00', '14:00']] }),
        worksSaturdays: false,
      },
    },
    startsAt: at(MON, 9),
    ...extra,
  });
  const withMechanic = (
    schedule: Partial<NonNullable<PlacementInput['mechanic']>['schedule']>,
    extra: Partial<PlacementInput> = {},
  ) => {
    const base = input(extra);
    const mechanic = base.mechanic as NonNullable<PlacementInput['mechanic']>;
    return {
      ...base,
      mechanic: {
        ...mechanic,
        schedule: { ...mechanic.schedule, ...schedule },
      },
    };
  };

  it('places a job inside both the garage and the mechanic hours', () => {
    expect(placementOf(input())).toEqual([
      {
        endsAt: at(MON, 10, 30),
        lift: null,
        mechanicId: 'elena',
        startsAt: at(MON, 9),
      },
    ]);
  });

  it("names the garage's holiday before the mechanic's day off", () => {
    const said = refused(() =>
      placementOf(
        withMechanic(
          { daysOff: [{ firstDay: MON, lastDay: MON }] },
          {
            calendar: { ...input().calendar, holidays: new Set([MON]) },
          },
        ),
      ),
    );

    expect(said).toMatchObject({
      code: 'outside_hours',
      message: '9 noiembrie e sărbătoare legală',
      reason: 'public_holiday',
    });
  });

  it('names a closed day, and a weekday the garage has no interval on, as closed', () => {
    expect(
      refused(() =>
        placementOf(
          input({
            calendar: { ...input().calendar, closedDays: new Set([MON]) },
          }),
        ),
      ),
    ).toMatchObject({ code: 'outside_hours', reason: 'closed_day' });
    expect(
      refused(() =>
        placementOf(
          input({
            calendar: { ...input().calendar, hours: week(SPLIT, { mon: [] }) },
            language: 'en',
          }),
        ),
      ),
    ).toMatchObject({
      code: 'outside_hours',
      message: 'The garage is closed that day',
      reason: 'closed_day',
    });
  });

  it("names the garage's hours before the mechanic's for a start outside both", () => {
    expect(
      refused(() =>
        placementOf(
          withMechanic(
            { workingHours: week([]) },
            { startsAt: at(MON, 12, 15) },
          ),
        ),
      ),
    ).toMatchObject({
      code: 'outside_hours',
      message: 'În afara programului (08:00–12:00, 13:00–17:00)',
      reason: 'outside_opening',
    });
  });

  it.each([
    [
      'a day off',
      { daysOff: [{ firstDay: MON, lastDay: MON }] },
      at(MON, 9),
      'day_off',
      'Elena Stan e liberă în ziua aceea',
    ],
    [
      'a Saturday without the switch',
      {},
      at(SAT, 10),
      'saturday_off',
      'Elena Stan nu lucrează sâmbăta',
    ],
    [
      'a weekday she has no stretch on',
      { workingHours: week([['08:00', '16:00']], { mon: [] }) },
      at(MON, 9),
      'not_working',
      'Elena Stan nu lucrează în ziua aceea',
    ],
    [
      'her stretch ending before the job',
      { workingHours: week([['08:00', '10:00']]) },
      at(MON, 9),
      'ends_early',
      'Elena Stan lucrează până la 10:00 în ziua aceea',
    ],
  ] as const)(
    'names the mechanic on %s',
    (_, schedule, startsAt, reason, message) => {
      expect(
        refused(() => placementOf(withMechanic(schedule, { startsAt }))),
      ).toEqual({ code: 'mechanic_unavailable', message, reason });
    },
  );

  it("names the garage's interval, not the mechanic, when it ends a short job first", () => {
    expect(
      refused(() => placementOf(input({ startsAt: at(MON, 11) }))),
    ).toMatchObject({ code: 'outside_hours', reason: 'outside_opening' });
  });

  it('names the opening hours when no stretch is left within 30 days', () => {
    expect(
      refused(() => placementOf(input({ durationMinutes: 31 * 8 * 60 }))),
    ).toMatchObject({ code: 'outside_hours', reason: 'outside_opening' });
  });

  it("takes the garage's intervals alone with the team off", () => {
    expect(
      placementOf(input({ mechanic: null, startsAt: at(SAT, 10) })),
    ).toEqual([
      {
        endsAt: at(SAT, 11, 30),
        lift: null,
        mechanicId: null,
        startsAt: at(SAT, 10),
      },
    ]);
  });

  it('places any time a garage and a mechanic that have set no hours', () => {
    const open = { ...input().calendar, hours: {} };

    expect(
      placementOf(
        withMechanic(
          { workingHours: null },
          { calendar: open, startsAt: at(MON, 23) },
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        endsAt: new Date(at(MON, 23).getTime() + 90 * 60_000),
        startsAt: at(MON, 23),
      }),
    ]);
    expect(
      refused(() =>
        placementOf(
          withMechanic(
            { daysOff: [{ firstDay: MON, lastDay: MON }], workingHours: null },
            { calendar: open },
          ),
        ),
      ),
    ).toMatchObject({ reason: 'day_off' });
  });
});

// @traces 150-FR-002
describe('the overlaps of each segment', () => {
  const segments = [
    {
      endsAt: at(MON, 16),
      lift: 1,
      mechanicId: 'elena',
      startsAt: at(MON, 15),
    },
    { endsAt: at(WED, 9), lift: 1, mechanicId: 'elena', startsAt: at(WED, 8) },
  ];
  const taken = (
    extra: Partial<TakenSegment> & Pick<TakenSegment, 'startsAt' | 'endsAt'>,
  ): TakenSegment => ({
    holder: { car: { brand: 'Dacia', model: 'Logan' }, kind: 'booking' },
    lift: null,
    mechanicId: null,
    ...extra,
  });
  const judged = (rows: TakenSegment[], language: 'ro' | 'en' = 'ro') =>
    refused(() =>
      judgeOverlaps(segments, rows, {
        language,
        mechanicName: 'Elena Stan',
        startsAt: at(MON, 15),
      }),
    );

  it('passes segments nothing overlaps, a touching one included', () => {
    expect(() =>
      judgeOverlaps(
        segments,
        [
          taken({
            endsAt: at(MON, 15),
            lift: 1,
            mechanicId: 'elena',
            startsAt: at(MON, 14),
          }),
          taken({
            endsAt: at(WED, 10),
            lift: 1,
            mechanicId: 'elena',
            startsAt: at(WED, 9),
          }),
          taken({
            endsAt: at(MON, 16),
            lift: 2,
            mechanicId: 'ion',
            startsAt: at(MON, 15),
          }),
        ],
        { language: 'ro', mechanicName: 'Elena Stan', startsAt: at(MON, 15) },
      ),
    ).not.toThrow();
  });

  it('names the mechanic before the lift inside one segment', () => {
    expect(
      judged([
        taken({ endsAt: at(MON, 16), lift: 1, startsAt: at(MON, 15) }),
        taken({
          endsAt: at(MON, 15, 45),
          mechanicId: 'elena',
          startsAt: at(MON, 15, 15),
        }),
      ]),
    ).toEqual({
      code: 'mechanic_busy',
      errors: [{ code: 'busy', field: 'mechanicId' }],
      message: 'Elena Stan are o programare 15:15–15:45',
    });
  });

  it('names the lift with the busy car', () => {
    expect(
      judged(
        [taken({ endsAt: at(MON, 17), lift: 1, startsAt: at(MON, 15, 30) })],
        'en',
      ),
    ).toEqual({
      code: 'lift_busy',
      errors: [{ code: 'busy', field: 'lift' }],
      message: 'Lift 1 is busy 15:30–17:00 (Dacia Logan)',
    });
  });

  it('names the earlier segment first, and a later day by its weekday', () => {
    expect(
      judged([
        taken({ endsAt: at(WED, 9), lift: 1, startsAt: at(WED, 8) }),
        taken({
          endsAt: at(WED, 8, 30),
          mechanicId: 'elena',
          startsAt: at(WED, 7),
        }),
      ]),
    ).toEqual({
      code: 'mechanic_busy',
      errors: [{ code: 'busy', field: 'mechanicId' }],
      message: 'Elena Stan are o programare miercuri 07:00–08:30',
    });
    expect(
      judged(
        [taken({ endsAt: at(WED, 9), lift: 1, startsAt: at(WED, 8) })],
        'en',
      ),
    ).toEqual({
      code: 'lift_busy',
      errors: [{ code: 'busy', field: 'lift' }],
      message: 'Lift 1 is busy Wednesday 08:00–09:00 (Dacia Logan)',
    });
  });
});

// @traces 427-FR-005
// @traces 427-FR-006
describe('a blocked interval among the overlaps', () => {
  const segment = {
    endsAt: at(TUE, 11, 30),
    lift: 2,
    mechanicId: 'mihai',
    startsAt: at(TUE, 10),
  };
  const block = (
    startsAt: Date,
    endsAt: Date,
    row: Partial<TakenSegment> = {},
  ): TakenSegment => ({
    endsAt: row.endsAt ?? endsAt,
    holder: { endsAt, kind: 'time_block', startsAt },
    lift: null,
    mechanicId: null,
    startsAt: row.startsAt ?? startsAt,
    ...row,
  });
  const judged = (rows: TakenSegment[], language: 'ro' | 'en' = 'ro') =>
    refused(() =>
      judgeOverlaps([segment], rows, {
        language,
        mechanicName: 'Mihai Pop',
        startsAt: at(TUE, 10),
      }),
    );

  it('names the mechanic blocked over the whole interval, in both languages', () => {
    const rows = [block(at(TUE, 9), at(TUE, 10, 30), { mechanicId: 'mihai' })];
    expect(judged(rows)).toEqual({
      code: 'mechanic_busy',
      errors: [{ code: 'busy', field: 'mechanicId' }],
      message: 'Mihai Pop e blocat 09:00–10:30',
      reason: 'time_block',
    });
    expect(judged(rows, 'en')).toEqual({
      code: 'mechanic_busy',
      errors: [{ code: 'busy', field: 'mechanicId' }],
      message: 'Mihai Pop is blocked 09:00–10:30',
      reason: 'time_block',
    });
  });

  it('names a blocked lift without a car', () => {
    const rows = [block(at(TUE, 11), at(TUE, 12), { lift: 2 })];
    expect(judged(rows)).toEqual({
      code: 'lift_busy',
      errors: [{ code: 'busy', field: 'lift' }],
      message: 'Elevatorul 2 e blocat 11:00–12:00',
      reason: 'time_block',
    });
    expect(judged(rows, 'en')).toEqual({
      code: 'lift_busy',
      errors: [{ code: 'busy', field: 'lift' }],
      message: 'Lift 2 is blocked 11:00–12:00',
      reason: 'time_block',
    });
  });

  it('says the whole range of a block over several days, each end with its weekday', () => {
    // Monday 16:00 to Wednesday 09:00: the clashing segment is Tuesday's.
    const rows = [
      block(at(MON, 16), at(WED, 9), {
        endsAt: at(WED, 0),
        lift: 2,
        startsAt: at(TUE, 0),
      }),
    ];
    expect(judged(rows)).toMatchObject({
      message: 'Elevatorul 2 e blocat luni 16:00–miercuri 09:00',
    });
    expect(judged(rows, 'en')).toMatchObject({
      message: 'Lift 2 is blocked Monday 16:00–Wednesday 09:00',
    });
  });

  it("names the mechanic's block before the lift's booking", () => {
    expect(
      judged([
        {
          endsAt: at(TUE, 11),
          holder: { car: { brand: 'Dacia', model: 'Logan' }, kind: 'booking' },
          lift: 2,
          mechanicId: null,
          startsAt: at(TUE, 10),
        },
        block(at(TUE, 11), at(TUE, 12), { mechanicId: 'mihai' }),
      ]),
    ).toMatchObject({ code: 'mechanic_busy', reason: 'time_block' });
  });

  it('keeps the booking texts, with no reason, for a booking row', () => {
    expect(
      judged([
        {
          endsAt: at(TUE, 11),
          holder: { car: { brand: 'Dacia', model: 'Logan' }, kind: 'booking' },
          lift: 2,
          mechanicId: null,
          startsAt: at(TUE, 10),
        },
      ]),
    ).toEqual({
      code: 'lift_busy',
      errors: [{ code: 'busy', field: 'lift' }],
      message: 'Elevatorul 2 e ocupat 10:00–11:00 (Dacia Logan)',
    });
  });
});

// @traces 427-FR-005
// @traces 427-FR-007
describe("the rows a block's change is judged against", () => {
  it('keeps the bookings, whose segments hold no block, beside the other blocks', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { bookingSegment: { findMany } } as never;

    await new ScheduleService().assertFree(tx, {
      exceptTimeBlockId: 'block-1',
      garageId: 'garage-1',
      language: 'ro',
      lift: 2,
      mechanicId: 'mihai',
      mechanicName: 'Mihai Pop',
      segments: [
        {
          endsAt: at(TUE, 12),
          lift: 2,
          mechanicId: 'mihai',
          startsAt: at(TUE, 11),
        },
      ],
      startsAt: at(TUE, 11),
    });

    // `NOT: { timeBlockId }` alone drops every row whose timeBlockId is null:
    // every booking's segment.
    const { where } = findMany.mock.calls[0][0];
    expect(where.NOT).toBeUndefined();
    expect(where.AND).toEqual([
      { OR: [{ timeBlockId: null }, { timeBlockId: { not: 'block-1' } }] },
    ]);
  });
});
