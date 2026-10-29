import { removeMechanicBlocks, segmentsOf } from './time-blocks.service';
import { atLocal } from '../../bucharest';

const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000);
const total = (spans: [Date, Date][]) =>
  spans.reduce((sum, [a, b]) => sum + b.getTime() - a.getTime(), 0);
const hours = (spans: [Date, Date][]) =>
  spans.map(([a, b]) => (b.getTime() - a.getTime()) / 3_600_000);

// @traces 427-FR-005
describe('the day cut of a blocked interval, pushed', () => {
  it('cuts nothing from an empty interval', () => {
    const t = at('2026-11-10', 10);
    expect(segmentsOf(t, t)).toEqual([]);
  });

  it('cuts nothing from an interval that ends before it starts', () => {
    expect(segmentsOf(at('2026-11-10', 12), at('2026-11-10', 10))).toEqual([]);
  });

  it('keeps a whole day, midnight to midnight, as one segment', () => {
    const from = at('2026-11-10', 0);
    const to = at('2026-11-11', 0);
    expect(segmentsOf(from, to)).toEqual([[from, to]]);
  });

  it('cuts a block that starts exactly at midnight without an empty lead segment', () => {
    const from = at('2026-11-10', 0);
    const to = at('2026-11-11', 6);
    expect(segmentsOf(from, to)).toEqual([
      [from, at('2026-11-11', 0)],
      [at('2026-11-11', 0), to],
    ]);
  });

  it('keeps the last quarter hour before midnight and the first after in two segments', () => {
    const from = at('2026-11-10', 23, 45);
    const to = at('2026-11-11', 0, 15);
    expect(segmentsOf(from, to)).toEqual([
      [from, at('2026-11-11', 0)],
      [at('2026-11-11', 0), to],
    ]);
  });

  it('gives a 14-day block one segment per day touched with no gap and no overlap', () => {
    const from = at('2026-11-10', 8);
    const to = at('2026-11-24', 8);
    const spans = segmentsOf(from, to);
    expect(spans).toHaveLength(15);
    expect(spans[0][0]).toEqual(from);
    expect(spans[14][1]).toEqual(to);
    spans.slice(1).forEach(([start], i) => {
      expect(start).toEqual(spans[i][1]);
    });
    expect(total(spans)).toBe(to.getTime() - from.getTime());
  });

  it('sums to the wall-clock range across the whole spring clock-change week', () => {
    const from = at('2027-03-22', 9);
    const to = at('2027-04-05', 9);
    const spans = segmentsOf(from, to);
    expect(total(spans)).toBe(to.getTime() - from.getTime());
    expect(hours(spans)).toContain(23);
    expect(spans).toHaveLength(15);
  });

  it('sums to the wall-clock range across the whole autumn clock-change week', () => {
    const from = at('2026-10-20', 9);
    const to = at('2026-11-03', 9);
    const spans = segmentsOf(from, to);
    expect(total(spans)).toBe(to.getTime() - from.getTime());
    expect(hours(spans)).toContain(25);
    expect(spans).toHaveLength(15);
  });

  it('cuts a block that starts inside the 25-hour day at the day end, not 24 hours on', () => {
    const from = at('2026-10-25', 22);
    const to = at('2026-10-26', 2);
    const spans = segmentsOf(from, to);
    expect(spans[0][1]).toEqual(at('2026-10-26', 0));
    expect(hours(spans)).toEqual([2, 2]);
  });

  it('keeps a one-millisecond interval before midnight as one segment', () => {
    const from = new Date(at('2026-11-11', 0).getTime() - 1);
    const to = at('2026-11-11', 0);
    expect(segmentsOf(from, to)).toEqual([[from, to]]);
  });

  it('returns the same answer for the same input twice and leaves its dates alone', () => {
    const from = at('2026-11-13', 16);
    const to = at('2026-11-16', 10);
    const stamp = [from.getTime(), to.getTime()];
    const first = segmentsOf(from, to);
    const second = segmentsOf(from, to);
    expect(second).toEqual(first);
    expect([from.getTime(), to.getTime()]).toEqual(stamp);
  });
});

// @traces 427-FR-012
describe('removing the blocks of a card, pushed', () => {
  it('records nothing when the card has no block still to come', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const audit = { record: jest.fn(), write: jest.fn() };
    const events = { emit: jest.fn(), enqueue: jest.fn(), record: jest.fn() };
    const tx = {
      timeBlock: { delete: jest.fn(), deleteMany: jest.fn(), findMany },
    };
    const now = new Date('2026-11-10T10:00:00.000Z');

    await removeMechanicBlocks(
      tx as never,
      { audit, events } as never,
      { actorId: null, garageId: 'g', mechanicId: 'm' },
      now,
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      endsAt: { gt: now },
      garageId: 'g',
      mechanicId: 'm',
    });
    expect(tx.timeBlock.delete).not.toHaveBeenCalled();
    expect(tx.timeBlock.deleteMany).not.toHaveBeenCalled();
    for (const fn of [...Object.values(audit), ...Object.values(events)]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
