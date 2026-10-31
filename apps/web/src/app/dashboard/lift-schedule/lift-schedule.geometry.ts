import type {
  GarageScheduleDto,
  GarageScheduleEntryDto,
  ScheduleDayDto,
  TimeBlockDto,
} from '@motor-fix/data-access';

import { bucharestWall } from '../bucharest-time';

// The lift schedule's drawing, as numbers: the hours axis of today, the rows
// of lifts and the blocks placed on them in percent of the axis.

const HOUR = 60;
const DAY = 24 * HOUR;
// A block shorter than this is drawn this long, with the car alone on it.
const SHORTEST = 30;
// The axis while the garage has set no opening hours.
const UNSET = { end: 18 * HOUR, start: 8 * HOUR };
// Only a confirmed or completed booking holds its lift.
const DRAWN = new Set(['confirmed', 'completed']);

interface AxisLabel {
  align: 'start' | 'middle' | 'end';
  at: number;
  text: string;
}

interface Axis {
  // Minutes since midnight on the Bucharest wall clock.
  start: number;
  end: number;
  labels: AxisLabel[];
}

type BlockStyle = 'todo' | 'work' | 'done' | 'blocked';
type BlockState = 'todo' | 'work' | 'paused' | 'done' | 'blocked';

export interface Placed {
  id: string;
  liveId: string;
  kind: 'booking' | 'block';
  // Percent of the axis.
  left: number;
  width: number;
  // The sub-row it is stacked in, from 0.
  sub: number;
  style: BlockStyle;
  state: BlockState;
  // "HH:mm" on the wall clock.
  start: string;
  minutes: number;
  short: boolean;
  mechanic: string | null;
  entry?: GarageScheduleEntryDto;
  block?: TimeBlockDto;
}

export interface Row {
  key: string;
  lift: number | null;
  subRows: number;
  items: Placed[];
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / HOUR)).padStart(2, '0')}:${String(minutes % HOUR).padStart(2, '0')}`;

const minutesOf = (time: string) => {
  const [hh, mm] = time.split(':').map(Number);
  return hh * HOUR + mm;
};

// An instant's minutes since midnight of `day` on the Bucharest wall clock.
function wallMinutes(day: string, instant: string): number {
  const wall = bucharestWall(instant);
  const days = Math.round(
    (Date.parse(wall.day) - Date.parse(day)) / 86_400_000,
  );
  return days * DAY + minutesOf(wall.time);
}

// Today's axis: the first opening to the last closing, out to whole hours;
// 8:00 to 18:00 while no hours are set; none on a closed day.
export function axisOf(
  day: ScheduleDayDto | undefined,
  hoursSet: boolean,
): Axis | null {
  let bounds = UNSET;
  if (hoursSet) {
    const open = day?.open ?? [];
    if (open.length === 0) return null;
    bounds = {
      end:
        Math.ceil(Math.max(...open.map((o) => minutesOf(o.to))) / HOUR) * HOUR,
      start:
        Math.floor(Math.min(...open.map((o) => minutesOf(o.from))) / HOUR) *
        HOUR,
    };
  }
  const span = bounds.end - bounds.start;
  const labels: AxisLabel[] = [];
  for (let at = bounds.start; at <= bounds.end; at += 2 * HOUR) {
    labels.push({
      align: 'middle',
      at: ((at - bounds.start) / span) * 100,
      text: clock(at),
    });
  }
  labels[0].align = 'start';
  if (labels.length > 1) labels[labels.length - 1].align = 'end';
  return { ...bounds, labels };
}

// Where the now line stands, in percent of the axis; null outside it.
export function nowAt(axis: Axis, now: Date): number | null {
  const minutes = minutesOf(bucharestWall(now.toISOString()).time);
  if (minutes < axis.start || minutes > axis.end) return null;
  return ((minutes - axis.start) / (axis.end - axis.start)) * 100;
}

const STYLES: Record<string, [BlockStyle, BlockState]> = {
  done: ['done', 'done'],
  in_work: ['work', 'work'],
  paused: ['work', 'paused'],
};

type Unplaced = Omit<Placed, 'sub'> & { row: number | null };

// A stretch of `day` on the axis, cut at its edges; none when wholly outside.
function stretch(day: string, axis: Axis, startsAt: string, endsAt: string) {
  const from = wallMinutes(day, startsAt);
  const to = wallMinutes(day, endsAt);
  const start = Math.max(from, axis.start);
  const end = Math.min(to, axis.end);
  if (end <= start) return null;
  const span = axis.end - axis.start;
  const length = Math.max(end - start, SHORTEST);
  const width = (length / span) * 100;
  const left = Math.min(((start - axis.start) / span) * 100, 100 - width);
  return {
    left: Math.max(left, 0),
    minutes: to - from,
    short: to - from < SHORTEST,
    start: clock(((from % DAY) + DAY) % DAY),
    width,
  };
}

// A booking's working stretches; one from its start and length when the read
// gives it none.
const segmentsOf = (e: GarageScheduleEntryDto) =>
  e.segments.length
    ? e.segments.map((segment) => ({
        ...segment,
        lift: segment.lift === undefined ? e.lift : segment.lift,
      }))
    : [
        {
          endsAt: new Date(
            Date.parse(e.startsAt) + e.durationMinutes * 60_000,
          ).toISOString(),
          lift: e.lift,
          mechanicId: e.mechanic?.id ?? null,
          startsAt: e.startsAt,
        },
      ];

function bookings(schedule: GarageScheduleDto, axis: Axis): Unplaced[] {
  const names = new Map<string, string>();
  for (const e of schedule.entries)
    if (e.mechanic) names.set(e.mechanic.id, e.mechanic.name);
  const nameOf = (id: string | null, e: GarageScheduleEntryDto) =>
    id ? (names.get(id) ?? null) : (e.mechanic?.name ?? null);
  return schedule.entries
    .filter((e) => DRAWN.has(e.status))
    .flatMap((e) => {
      const [style, state] = STYLES[e.jobStatus ?? ''] ?? ['todo', 'todo'];
      return segmentsOf(e).flatMap((segment, i) => {
        const at = stretch(
          schedule.from,
          axis,
          segment.startsAt,
          segment.endsAt,
        );
        return at
          ? [
              {
                ...at,
                entry: e,
                id: `${e.id}:${i}`,
                kind: 'booking' as const,
                liveId: e.id,
                mechanic: nameOf(segment.mechanicId, e),
                row: segment.lift ?? null,
                state,
                style,
              },
            ]
          : [];
      });
    });
}

// The lift's blocked time; a block held for a mechanic alone is not drawn.
function blocked(schedule: GarageScheduleDto, axis: Axis): Unplaced[] {
  return schedule.blocks
    .filter((b) => b.lift != null)
    .flatMap((b) =>
      b.segments.flatMap((segment, i) => {
        const at = stretch(
          schedule.from,
          axis,
          segment.startsAt,
          segment.endsAt,
        );
        if (!at) return [];
        return [
          {
            ...at,
            block: b,
            id: `${b.id}:${i}`,
            kind: 'block' as const,
            liveId: b.id,
            mechanic: b.mechanic?.name ?? null,
            row: b.lift ?? null,
            state: 'blocked' as const,
            style: 'blocked' as const,
          },
        ];
      }),
    );
}

// Overlapping blocks go to the first sub-row free at their start.
function stacked(items: Unplaced[]): { items: Placed[]; subRows: number } {
  const ends: number[] = [];
  const placed = [...items]
    .sort((a, b) => a.left - b.left || a.id.localeCompare(b.id))
    .map(({ row: _row, ...item }) => {
      let sub = ends.findIndex((end) => end <= item.left + 1e-9);
      if (sub === -1) sub = ends.length;
      ends[sub] = item.left + item.width;
      return { ...item, sub };
    });
  return { items: placed, subRows: Math.max(ends.length, 1) };
}

// One row per lift, then any lift number above the count, then the bookings
// with no lift last.
export function rowsOf(schedule: GarageScheduleDto, axis: Axis): Row[] {
  const all = [...bookings(schedule, axis), ...blocked(schedule, axis)];
  const lifts = new Set<number>();
  for (let n = 1; n <= schedule.liftCount; n++) lifts.add(n);
  for (const item of all) if (item.row !== null) lifts.add(item.row);
  const rows: Row[] = [...lifts]
    .sort((a, b) => a - b)
    .map((lift) => ({
      key: `lift:${lift}`,
      lift,
      ...stacked(all.filter((item) => item.row === lift)),
    }));
  const none = all.filter((item) => item.row === null);
  if (none.length) rows.push({ key: 'none', lift: null, ...stacked(none) });
  return rows;
}
