import {
  DEFAULT_HOURS,
  isHoursSection,
  lastClosedDay,
} from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import type { AuditEntry, AuditPort } from '../audit/audit.port';
import { refusal } from '../auth/sign-up.service';
import type { Prisma } from '../generated/prisma/client';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// Writes a garage's hours, closed days and facilities from the listing's
// step 5 section, inside the caller's transaction. A day before `today`, past
// the two-year window (an aged draft) or a legal holiday gets no row: the
// calendar alone closes a holiday. What changed goes to the history as the
// garage's own edit; the caller records the event.
export async function writeGarageHours(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: Record<string, unknown>,
  today: string,
  { actorId, audit }: { actorId: string; audit: AuditPort },
): Promise<void> {
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
      hours: true,
    },
    where: { id: garageId },
  });
  const after = await tx.garage.update({
    data: { hours: section.hours ?? DEFAULT_HOURS },
    select: { hours: true },
    where: { id: garageId },
  });
  await audit.recordChanges(
    tx,
    { ...change, subjectType: 'garage' },
    { hours: before.hours },
    { hours: after.hours },
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
}
