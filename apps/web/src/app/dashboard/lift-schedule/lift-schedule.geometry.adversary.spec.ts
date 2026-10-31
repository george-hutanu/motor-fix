// @traces 151-FR-004 151-FR-005 151-FR-006 151-FR-009 151-FR-010
import type {
  GarageScheduleDto,
  GarageScheduleEntryDto,
} from '@motor-fix/data-access';

import { axisOf, nowAt, rowsOf } from './lift-schedule.geometry';
import { block, DAY, entry, schedule } from './lift-schedule.testing';

const OPEN = { day: DAY, open: [{ from: '08:00', to: '18:00' }] };

const axis = () => {
  const drawn = axisOf(OPEN, true);
  if (!drawn) throw new Error('no axis');
  return drawn;
};

const rowsFor = (more: Partial<GarageScheduleDto>) =>
  rowsOf(schedule(more), axis());

describe('axisOf under odd hours', () => {
  it('spans a split day from the first opening to the last closing', () => {
    const drawn = axisOf(
      {
        day: DAY,
        open: [
          { from: '13:00', to: '19:45' },
          { from: '07:15', to: '11:00' },
        ],
      },
      true,
    );

    expect([drawn?.start, drawn?.end]).toEqual([7 * 60, 20 * 60]);
  });

  it('keeps hours that are already whole', () => {
    const drawn = axisOf(
      { day: DAY, open: [{ from: '09:00', to: '17:00' }] },
      true,
    );

    expect([drawn?.start, drawn?.end]).toEqual([9 * 60, 17 * 60]);
  });

  it('rounds a closing one minute past the hour up to the next hour', () => {
    const drawn = axisOf(
      { day: DAY, open: [{ from: '08:00', to: '17:01' }] },
      true,
    );

    expect(drawn?.end).toBe(18 * 60);
  });

  it('runs a round-the-clock garage from 00:00 to 24:00', () => {
    const drawn = axisOf(
      { day: DAY, open: [{ from: '00:00', to: '24:00' }] },
      true,
    );

    expect([drawn?.start, drawn?.end]).toEqual([0, 24 * 60]);
    expect(drawn?.labels.map((l) => l.text)).toContain('24:00');
  });

  it('uses the unset default even when a day carries hours but none were set', () => {
    const drawn = axisOf(
      { day: DAY, open: [{ from: '10:00', to: '12:00' }] },
      false,
    );

    expect([drawn?.start, drawn?.end]).toEqual([8 * 60, 18 * 60]);
  });

  it('draws the unset default when the day is missing from the answer', () => {
    const drawn = axisOf(undefined, false);

    expect([drawn?.start, drawn?.end]).toEqual([8 * 60, 18 * 60]);
  });

  it('is closed when hours are set and the day is missing from the answer', () => {
    expect(axisOf(undefined, true)).toBeNull();
  });

  it('is closed on a day with an empty list of intervals', () => {
    expect(axisOf({ day: DAY, open: [] }, true)).toBeNull();
  });

  it('labels a one-hour garage with a single label at the start', () => {
    const drawn = axisOf(
      { day: DAY, open: [{ from: '09:00', to: '10:00' }] },
      true,
    );

    expect(drawn?.labels.map((l) => l.text)).toEqual(['09:00']);
    expect(drawn?.labels[0].at).toBe(0);
  });
});

describe('nowAt on the edges', () => {
  it('is 0 at the axis start and 100 at its end', () => {
    expect(nowAt(axis(), new Date('2026-10-09T05:00:00Z'))).toBe(0);
    expect(nowAt(axis(), new Date('2026-10-09T15:00:00Z'))).toBe(100);
  });

  it('is hidden one minute before the start and one minute after the end', () => {
    expect(nowAt(axis(), new Date('2026-10-09T04:59:00Z'))).toBeNull();
    expect(nowAt(axis(), new Date('2026-10-09T15:01:00Z'))).toBeNull();
  });

  it('is hidden at 00:00 Bucharest, the midnight just after UTC evening', () => {
    expect(nowAt(axis(), new Date('2026-10-08T21:00:00Z'))).toBeNull();
  });

  it('places 11:20 Bucharest on the first autumn clock-change day by the wall clock', () => {
    const at = nowAt(axis(), new Date('2026-10-25T09:20:00Z'));

    expect(at).toBeCloseTo(((11 * 60 + 20 - 8 * 60) / 600) * 100, 6);
  });

  it('places 11:20 Bucharest on the spring clock-change day by the wall clock', () => {
    const at = nowAt(axis(), new Date('2026-03-29T08:20:00Z'));

    expect(at).toBeCloseTo(((11 * 60 + 20 - 8 * 60) / 600) * 100, 6);
  });
});

describe('rowsOf under hostile schedules', () => {
  it('returns the lift rows alone for an empty schedule', () => {
    expect(rowsFor({}).map((r) => [r.key, r.items.length, r.subRows])).toEqual([
      ['lift:1', 0, 1],
      ['lift:2', 0, 1],
      ['lift:3', 0, 1],
    ]);
  });

  it('returns no rows at all for no lifts and no bookings', () => {
    expect(rowsFor({ liftCount: 0 })).toEqual([]);
  });

  it('puts every booking in the no-lift row when the count is 0', () => {
    const rows = rowsFor({
      entries: [
        entry('a', '2026-10-09T06:00:00Z', 60, { lift: null }),
        entry('b', '2026-10-09T09:00:00Z', 60, { lift: null }),
      ],
      liftCount: 0,
    });

    expect(rows.map((r) => [r.lift, r.items.length])).toEqual([[null, 2]]);
  });

  it('survives ten thousand non-overlapping bookings on one lift', () => {
    const entries: GarageScheduleEntryDto[] = Array.from(
      { length: 10_000 },
      (_, i) =>
        entry(
          `e-${i}`,
          new Date(
            Date.parse('2026-10-09T05:00:00Z') + (i % 600) * 60_000,
          ).toISOString(),
          1,
          { lift: 1 },
        ),
    );
    const started = Date.now();
    const rows = rowsFor({ entries });

    expect(rows[0].items).toHaveLength(10_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('stacks three identical bookings into three sub-rows', () => {
    const rows = rowsFor({
      entries: ['a', 'b', 'c'].map((id) =>
        entry(id, '2026-10-09T06:00:00Z', 60, { lift: 2 }),
      ),
    });

    expect(rows[1].subRows).toBe(3);
    expect(rows[1].items.map((i) => i.sub).sort()).toEqual([0, 1, 2]);
  });

  it('stacks a 20-minute booking over the 30-minute minimum width of its neighbour', () => {
    const rows = rowsFor({
      entries: [
        entry('a', '2026-10-09T06:00:00Z', 10, { lift: 1 }),
        entry('b', '2026-10-09T06:15:00Z', 10, { lift: 1 }),
      ],
    });

    expect(rows[0].subRows).toBe(2);
  });

  it('draws a booking that crosses midnight only for its part of today', () => {
    const rows = rowsFor({
      entries: [entry('a', '2026-10-08T19:00:00Z', 24 * 60, { lift: 1 })],
    });
    const [item] = rows[0].items;

    expect(item.left).toBe(0);
    expect(item.width).toBe(100);
  });

  it('leaves out a booking that ended yesterday and one that starts tomorrow', () => {
    const rows = rowsFor({
      entries: [
        entry('past', '2026-10-08T06:00:00Z', 60, { lift: 1 }),
        entry('next', '2026-10-10T06:00:00Z', 60, { lift: 1 }),
      ],
    });

    expect(rows.flatMap((r) => r.items)).toEqual([]);
  });

  it('keeps a block that ends exactly where the axis starts out of the picture', () => {
    const rows = rowsFor({
      entries: [entry('edge', '2026-10-09T04:00:00Z', 60, { lift: 1 })],
    });

    expect(rows[0].items).toEqual([]);
  });

  it('keeps a block that starts exactly where the axis ends out of the picture', () => {
    const rows = rowsFor({
      entries: [entry('edge', '2026-10-09T15:00:00Z', 60, { lift: 1 })],
    });

    expect(rows[0].items).toEqual([]);
  });

  it('keeps a 30-minute-minimum block inside the axis when it starts one minute before the end', () => {
    const [item] = rowsFor({
      entries: [entry('late', '2026-10-09T14:59:00Z', 5, { lift: 1 })],
    })[0].items;

    expect(item.left + item.width).toBeLessThanOrEqual(100 + 1e-9);
    expect(item.width).toBeCloseTo((30 / 600) * 100, 6);
  });

  it('decides the row by the segment lift even when the entry names another lift', () => {
    const e = entry('a', '2026-10-09T06:00:00Z', 60, { lift: 1 });
    e.segments = [
      {
        endsAt: '2026-10-09T07:00:00Z',
        lift: null,
        mechanicId: null,
        startsAt: '2026-10-09T06:00:00Z',
      },
    ];
    const rows = rowsFor({ entries: [e] });

    expect(rows[0].items).toEqual([]);
    expect(rows.at(-1)?.lift).toBeNull();
    expect(rows.at(-1)?.items).toHaveLength(1);
  });

  it('names no mechanic for a segment whose mechanic the entry does not carry', () => {
    const e = entry('a', '2026-10-09T06:00:00Z', 60, { lift: 1 });
    e.segments = [
      {
        endsAt: '2026-10-09T07:00:00Z',
        lift: 1,
        mechanicId: 'ghost',
        startsAt: '2026-10-09T06:00:00Z',
      },
    ];
    const [item] = rowsFor({ entries: [e] })[0].items;

    expect(item.mechanic).toBeNull();
  });

  it('does not draw a cancelled or lapsed booking the read should not have sent', () => {
    const rows = rowsFor({
      entries: [
        entry('c', '2026-10-09T06:00:00Z', 60, {
          lift: 1,
          status: 'cancelled' as never,
        }),
        entry('l', '2026-10-09T08:00:00Z', 60, {
          lift: 1,
          status: 'lapsed' as never,
        }),
      ],
    });

    expect(rows.flatMap((r) => r.items)).toEqual([]);
  });

  it('draws a completed booking', () => {
    const rows = rowsFor({
      entries: [
        entry('d', '2026-10-09T06:00:00Z', 60, {
          jobStatus: 'done',
          lift: 1,
          status: 'completed' as never,
        }),
      ],
    });

    expect(rows[0].items.map((i) => i.style)).toEqual(['done']);
  });

  it('draws a lift block whose note is null and one with a huge note without throwing', () => {
    const rows = rowsFor({
      blocks: [
        block('n', '2026-10-09T06:00:00Z', '2026-10-09T07:00:00Z', {
          note: null as never,
        }),
        block('h', '2026-10-09T08:00:00Z', '2026-10-09T09:00:00Z', {
          note: 'x'.repeat(100_000),
        }),
      ],
    });

    expect(rows[1].items.map((i) => i.kind)).toEqual(['block', 'block']);
  });

  it('draws a block with no segments from nothing and does not throw', () => {
    const b = block('s', '2026-10-09T06:00:00Z', '2026-10-09T07:00:00Z');
    b.segments = [];

    expect(rowsFor({ blocks: [b] })[1].items).toEqual([]);
  });

  it('adds rows for two distinct lifts above the count in ascending order', () => {
    const rows = rowsFor({
      entries: [
        entry('a', '2026-10-09T06:00:00Z', 60, { lift: 9 }),
        entry('b', '2026-10-09T06:00:00Z', 60, { lift: 5 }),
      ],
    });

    expect(rows.map((r) => r.lift)).toEqual([1, 2, 3, 5, 9]);
  });

  it('gives the same rows when called twice on the same schedule', () => {
    const s = schedule({
      entries: [
        entry('a', '2026-10-09T06:00:00Z', 60, { lift: 1 }),
        entry('b', '2026-10-09T06:30:00Z', 60, { lift: 1 }),
      ],
    });

    expect(rowsOf(s, axis())).toEqual(rowsOf(s, axis()));
  });

  it('does not depend on the order of the entries', () => {
    const a = entry('a', '2026-10-09T06:00:00Z', 60, { lift: 1 });
    const b = entry('b', '2026-10-09T06:30:00Z', 60, { lift: 1 });

    expect(rowsFor({ entries: [a, b] })).toEqual(rowsFor({ entries: [b, a] }));
  });

  it('does not mutate the schedule it is given', () => {
    const s = schedule({ entries: [entry('a', '2026-10-09T06:00:00Z', 60)] });
    const copy = JSON.stringify(s);
    rowsOf(s, axis());

    expect(JSON.stringify(s)).toBe(copy);
  });
});
