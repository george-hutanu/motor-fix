import type { TimeBlockDto } from '@motor-fix/contracts';

import type { AuditPort } from '../../audit/audit.port';
import { addDays, atLocal, localDay } from '../../bucharest';
import type { EventPort } from '../../events/event.port';
import type {
  BookingSegment,
  Mechanic,
  Prisma,
  PrismaClient,
  TimeBlock,
} from '../../generated/prisma/client';

// The time-block reads and writes other modules share: the schedule read
// lists blocks and a card's removal takes its blocks along. Kept apart from
// TimeBlocksService, which needs the schedule service: the mechanics service
// imports this file, and the schedule service reaches it through the garage
// hours, so the service's import would run before the schedule service exists.

type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, 'timeBlock'> | Pick<Tx, 'timeBlock'>;

// The block as stored or asked, before it is written.
export interface Shape {
  mechanicId: string | null;
  lift: number | null;
  startsAt: Date;
  endsAt: Date;
  note: string | null;
}

type Stored = TimeBlock & {
  mechanic: Pick<Mechanic, 'id' | 'name'> | null;
  segments: Pick<BookingSegment, 'startsAt' | 'endsAt'>[];
};

export const storedInclude = {
  mechanic: { select: { id: true, name: true } },
  segments: {
    orderBy: { startsAt: 'asc' },
    select: { endsAt: true, startsAt: true },
  },
} satisfies Prisma.TimeBlockInclude;

// A block as staff read it; its lift only while the garage schedules lifts.
export function timeBlockOf(row: Stored, lifts: boolean): TimeBlockDto {
  return {
    endsAt: row.endsAt.toISOString(),
    id: row.id,
    ...(lifts && { lift: row.lift }),
    mechanic: row.mechanic
      ? { id: row.mechanic.id, name: row.mechanic.name }
      : null,
    note: row.note,
    segments: row.segments.map((segment) => ({
      endsAt: segment.endsAt.toISOString(),
      startsAt: segment.startsAt.toISOString(),
    })),
    startsAt: row.startsAt.toISOString(),
  };
}

// The garage's blocks whose segments touch [start, end), as the schedule
// board filters them: `mechanicId` matches the block's own mechanic only.
export async function blocksOf(
  db: Db,
  query: {
    garageId: string;
    start: Date;
    end: Date;
    lift?: number;
    mechanicId?: string;
  },
  lifts: boolean,
): Promise<TimeBlockDto[]> {
  const rows = await db.timeBlock.findMany({
    include: storedInclude,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    where: {
      garageId: query.garageId,
      lift: query.lift,
      mechanicId: query.mechanicId,
      segments: {
        some: { endsAt: { gt: query.start }, startsAt: { lt: query.end } },
      },
    },
  });
  return rows.map((row) => timeBlockOf(row, lifts));
}

// A block's range cut at each Bucharest midnight it crosses: one span per day
// it touches, a clock-change day 23 or 25 hours long.
export function segmentsOf(startsAt: Date, endsAt: Date): [Date, Date][] {
  const spans: [Date, Date][] = [];
  for (let from = startsAt; from < endsAt; ) {
    const midnight = atLocal(addDays(localDay(from), 1), 0);
    const to = midnight < endsAt ? midnight : endsAt;
    spans.push([from, to]);
    from = to;
  }
  return spans;
}

// The segments a block holds its mechanic and lift through, one per day.
export const segmentsAt = (shape: Shape) =>
  segmentsOf(shape.startsAt, shape.endsAt).map(([startsAt, endsAt]) => ({
    endsAt,
    lift: shape.lift,
    mechanicId: shape.mechanicId,
    startsAt,
  }));

export const segmentRows = (
  shape: Shape,
  garageId: string,
  timeBlockId: string,
) =>
  segmentsAt(shape).map((segment) => ({ ...segment, garageId, timeBlockId }));

// What the audit entries and the events carry of a block: never the note in
// an event.
export const valuesOf = (shape: Shape) => ({
  endsAt: shape.endsAt.toISOString(),
  lift: shape.lift,
  mechanicId: shape.mechanicId,
  startsAt: shape.startsAt.toISOString(),
});

type BlockEvent =
  | 'time_block.created'
  | 'time_block.updated'
  | 'time_block.deleted';

// The event of a write: the garage, the block's mechanic and the public
// stream of the garage hear it; never the note.
export function announced(
  events: EventPort,
  tx: Tx,
  kind: BlockEvent,
  garageId: string,
  blockId: string,
  shape: Shape,
) {
  return events.record(tx, {
    audience: { garageId, mechanicId: shape.mechanicId, type: 'time_block' },
    kind,
    payload: { blockId, garageId, ...valuesOf(shape) },
    subjectId: blockId,
  });
}

// What a removal's audit entry keeps of the block.
export const removedValues = (
  stored: TimeBlock & { mechanic: Pick<Mechanic, 'name'> | null },
) => ({
  ...valuesOf(stored),
  mechanicName: stored.mechanic?.name ?? null,
  note: stored.note,
});

// A card leaves the team: its blocks still to come go with it, each recorded
// as the system's removal on behalf of whoever removed the card. Blocks that
// already ended stay with their values.
export async function removeMechanicBlocks(
  tx: Tx,
  ports: { audit: AuditPort; events: EventPort },
  who: { actorId: string | null; garageId: string; mechanicId: string },
  now = new Date(),
): Promise<void> {
  const rows = await tx.timeBlock.findMany({
    include: storedInclude,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    where: {
      endsAt: { gt: now },
      garageId: who.garageId,
      mechanicId: who.mechanicId,
    },
  });
  if (rows.length === 0) return;
  await tx.timeBlock.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  await ports.audit.recordMany(
    tx,
    rows.map((row) => ({
      action: 'delete' as const,
      actorId: who.actorId,
      actorRole: 'system' as const,
      garageId: who.garageId,
      internal: true,
      newValue: null,
      oldValue: removedValues(row),
      subjectId: row.id,
      subjectType: 'time_block',
    })),
  );
  for (const row of rows) {
    await announced(
      ports.events,
      tx,
      'time_block.deleted',
      who.garageId,
      row.id,
      row,
    );
  }
}
