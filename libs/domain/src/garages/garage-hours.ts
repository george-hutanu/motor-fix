import { DEFAULT_HOURS, isHoursSection } from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import { refusal } from '../auth/sign-up.service';
import type { Prisma } from '../generated/prisma/client';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Writes a garage's hours, closed days and facilities from the listing's
// step 5 section, inside the caller's transaction. A day before `today` or a
// legal holiday gets no row: the calendar alone closes a holiday. The
// caller records the event; this writes rows only.
export async function writeGarageHours(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: Record<string, unknown>,
  today: string,
): Promise<void> {
  if (!isHoursSection(section)) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The opening hours, closed days or facilities break a rule',
    );
  }
  const upcoming = (section.closedDays ?? []).filter((c) => c.day >= today);
  const holidays = await tx.publicHoliday.findMany({
    select: { day: true },
    where: { day: { in: upcoming.map((c) => asDate(c.day)) } },
  });
  const legal = new Set(holidays.map((h) => h.day.toISOString().slice(0, 10)));

  await tx.garage.update({
    data: { hours: section.hours ?? DEFAULT_HOURS },
    where: { id: garageId },
  });
  await tx.garageClosedDay.deleteMany({ where: { garageId } });
  await tx.garageClosedDay.createMany({
    data: upcoming
      .filter((c) => !legal.has(c.day))
      .map((c) => ({
        day: asDate(c.day),
        garageId,
        note: c.note?.trim() || null,
      })),
  });
  await tx.garageFacility.deleteMany({ where: { garageId } });
  await tx.garageFacility.createMany({
    data: (section.facilities ?? []).map((facility) => ({
      facility,
      garageId,
    })),
  });
}
