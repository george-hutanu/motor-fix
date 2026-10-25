import {
  clipStretch,
  DEFAULT_HOURS,
  type Interval,
  isHoursSection,
  lastClosedDay,
  storedWeek,
  stretchOf,
  WEEKDAYS,
} from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import { cardAudience } from './mechanics/garage-mechanics.service';
import type { AuditChange, AuditEntry, AuditPort } from '../audit/audit.port';
import { canonical } from '../audit/audit.service';
import { refusal } from '../auth/http-refusal';
import { local, localDay } from '../bucharest';
import type { EventPort } from '../events/event.port';
import type { Prisma } from '../generated/prisma/client';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// Writes a garage's hours, closed days, facilities and their note from the
// listing's step 5 section, inside the caller's transaction. A day before
// `today`, past the two-year window (an aged draft) or a legal holiday gets no
// row: the calendar alone closes a holiday. What changed goes to the history as the
// garage's own edit; the caller records the garage's event. Each team
// mechanic's own hours are clipped to the new span, each with its event;
// the names of the cards clipped are returned.
export async function writeGarageHours(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: Record<string, unknown>,
  today: string,
  {
    actorId,
    audit,
    events,
  }: { actorId: string; audit: AuditPort; events: EventPort },
): Promise<string[]> {
  if (!isHoursSection(section)) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The opening hours, closed days or facilities break a rule',
    );
  }
  const last = lastClosedDay(today);
  const upcoming = (section.closedDays ?? []).filter(
    (c) => c.day >= today && c.day <= last,
  );
  const holidays = await tx.publicHoliday.findMany({
    select: { day: true },
    where: { day: { in: upcoming.map((c) => asDate(c.day)) } },
  });
  const legal = new Set(holidays.map((h) => dayOf(h.day)));
  const days = upcoming
    .filter((c) => !legal.has(c.day))
    .map((c) => ({ day: c.day, note: c.note?.trim() || null }));
  const facilities = section.facilities ?? [];
  const change = {
    actorId,
    actorRole: 'garage' as const,
    garageId,
    subjectId: garageId,
  };

  const before = await tx.garage.findUniqueOrThrow({
    select: {
      closedDays: { select: { day: true, note: true } },
      facilities: { select: { facility: true } },
      facilitiesNote: true,
      hours: true,
    },
    where: { id: garageId },
  });
  const after = await tx.garage.update({
    data: {
      facilitiesNote: section.facilitiesNote?.trim() || null,
      hours: section.hours ?? DEFAULT_HOURS,
    },
    select: { facilitiesNote: true, hours: true },
    where: { id: garageId },
  });
  await audit.recordChanges(
    tx,
    { ...change, subjectType: 'garage' },
    { facilitiesNote: before.facilitiesNote, hours: before.hours },
    after,
  );
  await tx.garageClosedDay.deleteMany({ where: { garageId } });
  await tx.garageClosedDay.createMany({
    data: days.map((c) => ({ day: asDate(c.day), garageId, note: c.note })),
  });
  await tx.garageFacility.deleteMany({ where: { garageId } });
  await tx.garageFacility.createMany({
    data: facilities.map((facility) => ({ facility, garageId })),
  });

  const was = new Map(
    before.closedDays.map((c) => [
      dayOf(c.day),
      { day: dayOf(c.day), note: c.note },
    ]),
  );
  const is = new Map(days.map((c) => [c.day, c]));
  const had = new Set(before.facilities.map((f) => f.facility as string));
  const has = new Set<string>(facilities);
  const closedDay = { ...change, subjectType: 'garage_closed_day' };
  const facility = { ...change, subjectType: 'garage_facility' };
  const entries: AuditEntry[] = [
    ...[...was.values()]
      .filter((c) => !is.has(c.day))
      .map((c) => ({ ...closedDay, action: 'delete' as const, oldValue: c })),
    ...days.flatMap((c): AuditEntry[] => {
      const old = was.get(c.day);
      if (!old)
        return [{ ...closedDay, action: 'create' as const, newValue: c }];
      if (old.note === c.note) return [];
      return [
        {
          ...closedDay,
          action: 'update' as const,
          field: 'note',
          newValue: c,
          oldValue: old,
        },
      ];
    }),
    ...[...had]
      .filter((f) => !has.has(f))
      .map((f) => ({
        ...facility,
        action: 'delete' as const,
        oldValue: { facility: f },
      })),
    ...[...has]
      .filter((f) => !had.has(f))
      .map((f) => ({
        ...facility,
        action: 'create' as const,
        newValue: { facility: f },
      })),
  ];
  await audit.recordMany(tx, entries);
  return clipMechanics(tx, garageId, after.hours, change, { audit, events });
}

type Week = Partial<Record<string, Interval[]>>;

// A mechanic's week inside the garage's: a stretch the garage's span of that
// day cuts is shortened, or emptied when nothing is left. A day it leaves
// whole stays as stored.
function clippedWeek(own: Week, garage: Week): Week {
  return Object.fromEntries(
    WEEKDAYS.map((day) => {
      const list = own[day] ?? [];
      const stretch = stretchOf(list);
      if (!stretch) return [day, list];
      const kept = clipStretch(stretch, stretchOf(garage[day] ?? []));
      const same = kept?.[0] === stretch[0] && kept?.[1] === stretch[1];
      return [day, same ? list : kept ? [kept] : []];
    }),
  );
}

// What the garage's new hours change on one card: its week and its
// Saturday switch before and after, and the event's field names.
function clipOf(
  card: { workingHours: unknown; worksSaturdays: boolean },
  garage: Week,
) {
  const before = {
    workingHours: card.workingHours,
    worksSaturdays: card.worksSaturdays,
  };
  const after = {
    workingHours: clippedWeek(storedWeek(card.workingHours), garage),
    worksSaturdays:
      card.worksSaturdays && stretchOf(garage['sat'] ?? []) !== null,
  };
  const fields = [
    ...(canonical(before.workingHours) === canonical(after.workingHours)
      ? []
      : ['working_hours']),
    ...(before.worksSaturdays === after.worksSaturdays
      ? []
      : ['works_saturdays']),
  ];
  return { after, before, fields };
}

async function clipMechanics(
  tx: Prisma.TransactionClient,
  garageId: string,
  hours: unknown,
  change: Omit<AuditChange, 'subjectType'>,
  { audit, events }: { audit: AuditPort; events: EventPort },
): Promise<string[]> {
  const garage: Week = storedWeek(hours);
  const cards = await tx.mechanic.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      onProfile: true,
      workingHours: true,
      worksSaturdays: true,
    },
    where: { garageId, removedAt: null },
  });
  const clipped: string[] = [];
  for (const card of cards) {
    if (card.workingHours === null || typeof card.workingHours !== 'object') {
      continue;
    }
    const { after, before, fields } = clipOf(card, garage);
    if (fields.length === 0) continue;
    await tx.mechanic.update({
      data: after as Prisma.MechanicUpdateInput,
      where: { id: card.id },
    });
    await audit.recordChanges(
      tx,
      { ...change, subjectId: card.id, subjectType: 'mechanic' },
      before,
      after,
    );
    await events.record(tx, {
      audience: cardAudience(garageId, card),
      kind: 'mechanic.updated',
      payload: { fields, garageId, mechanicId: card.id },
      subjectId: card.id,
    });
    clipped.push(card.name);
  }
  return clipped;
}

// The Bucharest day and wall-clock minute of an instant. Romania's offsets are
// whole hours, so the minute is the UTC one.
export function wall(at: Date) {
  const day = localDay(at);
  return {
    day,
    minute: local(at).hour * 60 + at.getUTCMinutes(),
    weekday: WEEKDAYS[(new Date(day).getUTCDay() + 6) % 7],
  };
}

export const minuteOf = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Whether [start, start + duration) lies inside one interval of the garage's
// hours on one Bucharest day that is neither a closed day nor a public
// holiday. The ends are read on the local clock, so a span across a clock
// change keeps its real length. A garage that has set no hours at all takes
// any span that starts on an open day.
export function spanInsideHours(
  hours: Partial<Record<string, Interval[]>>,
  closedDays: ReadonlySet<string>,
  holidays: ReadonlySet<string>,
  startsAt: Date,
  durationMinutes: number,
): boolean {
  if (Number.isNaN(startsAt.getTime())) return false;
  const start = wall(startsAt);
  const end = wall(new Date(startsAt.getTime() + durationMinutes * 60_000));
  if (closedDays.has(start.day) || holidays.has(start.day)) return false;
  if (Object.keys(hours).length === 0) return true;
  if (end.day !== start.day) return false;
  return (hours[start.weekday] ?? []).some(
    ([from, to]) =>
      minuteOf(from) <= start.minute && end.minute <= minuteOf(to),
  );
}

// spanInsideHours for one garage, reading its closed day and the public
// holiday of the span's own Bucharest day.
export async function slotInsideHours(
  tx: Prisma.TransactionClient,
  garage: { id: string; hours: Prisma.JsonValue },
  startsAt: Date,
  durationMinutes: number,
): Promise<boolean> {
  const day = asDate(localDay(startsAt));
  const [closed, holiday] = await Promise.all([
    tx.garageClosedDay.findMany({ where: { day, garageId: garage.id } }),
    tx.publicHoliday.findMany({ where: { day } }),
  ]);
  return spanInsideHours(
    (garage.hours ?? {}) as Partial<Record<string, Interval[]>>,
    new Set(closed.map((c) => dayOf(c.day))),
    new Set(holiday.map((h) => dayOf(h.day))),
    startsAt,
    durationMinutes,
  );
}
