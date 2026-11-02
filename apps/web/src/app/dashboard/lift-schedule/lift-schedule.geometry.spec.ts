// @traces 151-FR-004 151-FR-005 151-FR-006 151-FR-007 151-FR-008 151-FR-009 151-FR-010
import type {
  GarageScheduleDto,
  GarageScheduleEntryDto,
  TimeBlockDto,
} from '@motor-fix/data-access';

import { axisOf, nowAt, rowsOf } from './lift-schedule.geometry';

// Friday 9 October 2026: Bucharest is UTC+3, so 06:00Z is 09:00 on the wall.
const DAY = '2026-10-09';
const OPEN = { day: DAY, open: [{ from: '08:00', to: '18:00' }] };

const entry = (
  id: string,
  startsAt: string,
  minutes: number,
  more: Partial<GarageScheduleEntryDto> = {},
): GarageScheduleEntryDto => {
  const endsAt = new Date(
    Date.parse(startsAt) + minutes * 60_000,
  ).toISOString();
  const lift = more.lift === undefined ? 1 : more.lift;
  return {
    car: { brand: 'Dacia', model: 'Logan', year: 2019 },
    confirmBy: null,
    customer: 'Dan V.',
    durationMinutes: minutes,
    id,
    jobStatus: 'to_do',
    jobs: ['Schimb ulei'],
    lift,
    mechanic: null,
    minutesLeft: null,
    segments: [{ endsAt, lift, mechanicId: null, startsAt }],
    startsAt,
    status: 'confirmed',
    ...more,
  };
};

const block = (
  id: string,
  startsAt: string,
  endsAt: string,
  more: Partial<TimeBlockDto> = {},
): TimeBlockDto => ({
  endsAt,
  id,
  lift: 2,
  mechanic: null,
  note: 'Client la telefon',
  segments: [{ endsAt, startsAt }],
  startsAt,
  ...more,
});

const schedule = (
  more: Partial<GarageScheduleDto> = {},
): GarageScheduleDto => ({
  blocks: [],
  days: [OPEN],
  entries: [],
  from: DAY,
  hoursSet: true,
  liftCount: 3,
  lifts: true,
  to: DAY,
  ...more,
});

const axis = () => {
  const drawn = axisOf(OPEN, true);
  if (!drawn) throw new Error('no axis');
  return drawn;
};

const rows = (more: Partial<GarageScheduleDto> = {}) =>
  rowsOf(schedule(more), axis());

const items = (more: Partial<GarageScheduleDto> = {}) =>
  rows(more).flatMap((row) => row.items);

describe('the lift schedule axis', () => {
  it('runs from the first opening to the last closing, rounded out to whole hours', () => {
    const drawn = axisOf(
      {
        day: DAY,
        open: [
          { from: '09:30', to: '12:00' },
          { from: '13:00', to: '17:15' },
        ],
      },
      true,
    );
    expect(drawn).toMatchObject({ end: 18 * 60, start: 9 * 60 });
  });

  it('runs from 8:00 to 18:00 while the garage has set no hours', () => {
    expect(axisOf({ day: DAY, open: [] }, false)).toMatchObject({
      end: 18 * 60,
      start: 8 * 60,
    });
    expect(axisOf(undefined, false)).toMatchObject({
      end: 18 * 60,
      start: 8 * 60,
    });
  });

  it('draws no axis on a day the garage is closed', () => {
    expect(axisOf({ day: DAY, open: [] }, true)).toBeNull();
  });

  it('labels every two hours from its start, the first and last at the edges', () => {
    const drawn = axisOf(
      { day: DAY, open: [{ from: '07:00', to: '16:00' }] },
      true,
    );
    expect(drawn?.labels).toEqual([
      { align: 'start', at: 0, text: '07:00' },
      { align: 'middle', at: (2 / 9) * 100, text: '09:00' },
      { align: 'middle', at: (4 / 9) * 100, text: '11:00' },
      { align: 'middle', at: (6 / 9) * 100, text: '13:00' },
      { align: 'end', at: (8 / 9) * 100, text: '15:00' },
    ]);
    expect(axis().labels.at(-1)).toEqual({
      align: 'end',
      at: 100,
      text: '18:00',
    });
  });
});

describe('the lift schedule blocks', () => {
  it('places a block by its start and sizes it by its length on the axis', () => {
    // 09:00 to 10:30 on an axis of 8:00 to 18:00.
    const [placed] = items({
      entries: [entry('b-1', '2026-10-09T06:00:00Z', 90)],
    });
    expect(placed).toMatchObject({
      kind: 'booking',
      left: 10,
      liveId: 'b-1',
      minutes: 90,
      short: false,
      start: '09:00',
    });
    expect(placed.width).toBeCloseTo(15);
  });

  it('keeps a block shorter than 30 minutes 30 minutes wide and marks it short', () => {
    const [placed] = items({
      entries: [entry('b-1', '2026-10-09T06:00:00Z', 15)],
    });
    expect(placed.short).toBe(true);
    expect(placed.width).toBeCloseTo(5);
  });

  it('cuts a block at the axis edges and leaves out one wholly outside', () => {
    const drawn = items({
      entries: [
        // 07:00 to 09:00: cut at 08:00.
        entry('early', '2026-10-09T04:00:00Z', 120),
        // 17:00 to 19:00: cut at 18:00.
        entry('late', '2026-10-09T14:00:00Z', 120),
        // 19:00 to 20:00: outside.
        entry('after', '2026-10-09T16:00:00Z', 60),
      ],
    });
    expect(drawn.map((p) => p.liveId)).toEqual(['early', 'late']);
    expect(drawn[0].left).toBe(0);
    expect(drawn[0].width).toBeCloseTo(10);
    expect(drawn[1].left).toBeCloseTo(90);
    expect(drawn[1].width).toBeCloseTo(10);
  });

  it('draws one block per segment of today, on the segment’s lift', () => {
    const long = entry('b-1', '2026-10-08T06:00:00Z', 600, {
      segments: [
        {
          endsAt: '2026-10-08T14:00:00Z',
          lift: 1,
          mechanicId: null,
          startsAt: '2026-10-08T06:00:00Z',
        },
        {
          endsAt: '2026-10-09T07:00:00Z',
          lift: 3,
          mechanicId: 'm-2',
          startsAt: '2026-10-09T05:00:00Z',
        },
      ],
    });
    const drawn = rows({
      entries: [
        long,
        entry('b-2', '2026-10-09T09:00:00Z', 60, {
          mechanic: { id: 'm-2', name: 'Ana Pop' },
        }),
      ],
    });
    const three = drawn.find((row) => row.key === 'lift:3');
    expect(three?.items).toHaveLength(1);
    expect(three?.items[0]).toMatchObject({
      liveId: 'b-1',
      mechanic: 'Ana Pop',
      start: '08:00',
    });
    expect(drawn.find((row) => row.key === 'lift:1')?.items).toHaveLength(1);
  });

  it('places a booking with no segments by its start and length', () => {
    const [placed] = items({
      entries: [
        entry('b-1', '2026-10-09T06:00:00Z', 60, {
          segments: [],
          status: 'completed',
        }),
      ],
    });
    expect(placed).toMatchObject({ left: 10, liveId: 'b-1', start: '09:00' });
  });

  it('leaves out bookings awaiting confirmation and no-shows', () => {
    expect(
      items({
        entries: [
          entry('wait', '2026-10-09T06:00:00Z', 60, {
            segments: [],
            status: 'awaiting_confirmation',
          }),
          entry('missed', '2026-10-09T07:00:00Z', 60, { status: 'no_show' }),
          entry('done', '2026-10-09T08:00:00Z', 60, { status: 'completed' }),
        ],
      }).map((p) => p.liveId),
    ).toEqual(['done']);
  });

  it.each([
    ['to_do', 'todo', 'todo'],
    [null, 'todo', 'todo'],
    ['in_work', 'work', 'work'],
    ['paused', 'work', 'paused'],
    ['done', 'done', 'done'],
  ])('styles a block whose job is %s as %s', (jobStatus, style, state) => {
    const [placed] = items({
      entries: [entry('b-1', '2026-10-09T06:00:00Z', 60, { jobStatus })],
    });
    expect(placed).toMatchObject({ state, style });
  });

  it('draws the lift time blocks hatched and leaves out the mechanic-only ones', () => {
    const drawn = items({
      blocks: [
        block('t-1', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z'),
        block('t-2', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z', {
          lift: null,
          mechanic: { id: 'm-1', name: 'Vlad Stan' },
        }),
      ],
    });
    expect(drawn).toEqual([
      expect.objectContaining({
        kind: 'block',
        left: 20,
        liveId: 't-1',
        state: 'blocked',
        style: 'blocked',
      }),
    ]);
  });
});

describe('the lift schedule rows', () => {
  it('draws one row per lift in order, empty ones kept', () => {
    expect(rows().map((row) => [row.key, row.lift, row.subRows])).toEqual([
      ['lift:1', 1, 1],
      ['lift:2', 2, 1],
      ['lift:3', 3, 1],
    ]);
  });

  it('adds a row for a lift number above the count, and a last row for bookings with no lift', () => {
    const drawn = rows({
      blocks: [
        block('t-1', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z', {
          lift: 5,
        }),
      ],
      entries: [
        entry('b-1', '2026-10-09T06:00:00Z', 60, { lift: 4 }),
        entry('b-2', '2026-10-09T07:00:00Z', 60, { lift: null }),
      ],
    });
    expect(drawn.map((row) => row.key)).toEqual([
      'lift:1',
      'lift:2',
      'lift:3',
      'lift:4',
      'lift:5',
      'none',
    ]);
    expect(drawn.at(-1)?.lift).toBeNull();
  });

  it('draws no "no lift" row while every booking has one', () => {
    expect(
      rows({ entries: [entry('b-1', '2026-10-09T06:00:00Z', 60)] }).map(
        (row) => row.key,
      ),
    ).not.toContain('none');
  });

  it('stacks overlapping blocks in sub-rows so none hides another', () => {
    const [one] = rows({
      entries: [
        entry('a', '2026-10-09T06:00:00Z', 120),
        entry('b', '2026-10-09T07:00:00Z', 60),
        entry('c', '2026-10-09T08:00:00Z', 60),
      ],
    });
    expect(one.subRows).toBe(2);
    expect(one.items.map((p) => [p.liveId, p.sub])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
  });

  it('keeps one sub-row when blocks only touch', () => {
    const [one] = rows({
      entries: [
        entry('a', '2026-10-09T06:00:00Z', 60),
        entry('b', '2026-10-09T07:00:00Z', 60),
      ],
    });
    expect(one.subRows).toBe(1);
  });
});

describe('the now line', () => {
  it('stands at the Bucharest wall minute since the axis start', () => {
    // 13:00 in Bucharest.
    expect(nowAt(axis(), new Date('2026-10-09T10:00:00Z'))).toBeCloseTo(50);
  });

  it('is hidden outside the axis', () => {
    expect(nowAt(axis(), new Date('2026-10-09T03:00:00Z'))).toBeNull();
    expect(nowAt(axis(), new Date('2026-10-09T16:00:00Z'))).toBeNull();
  });

  it.each([
    // Spring forward: from 04:00 the wall is UTC+3.
    ['2026-03-29T07:00:00Z', 20],
    // Fall back: from 04:00 the wall is UTC+2 again.
    ['2026-10-25T08:00:00Z', 20],
  ])('reads the wall clock on a clock-change day (%s)', (now, at) => {
    expect(nowAt(axis(), new Date(now))).toBeCloseTo(at);
  });

  it('places a block by the wall clock on a clock-change day', () => {
    const day = '2026-10-25';
    const drawn = rowsOf(
      schedule({
        days: [{ day, open: [{ from: '08:00', to: '18:00' }] }],
        entries: [entry('b-1', '2026-10-25T08:00:00Z', 60)],
        from: day,
        to: day,
      }),
      axis(),
    );
    expect(drawn[0].items[0]).toMatchObject({ left: 20, start: '10:00' });
  });
});
