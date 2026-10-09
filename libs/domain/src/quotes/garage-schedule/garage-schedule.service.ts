import { Inject, Injectable } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { addDays, atLocal, daysBetween, localDay } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';
import { bookedInclude, bookedOf, invalidInput } from '../reads';

interface ScheduleQuery {
  from?: string;
  to?: string;
  lift?: number;
  mechanicId?: string;
}

const MAX_DAYS = 7;
const MINUTE = 60_000;

// The garage's bookings over whole Bucharest days, as the schedule board
// shows them: what is still awaiting the garage, what is on, what was done or
// missed. Lapsed and cancelled bookings hold no slot and are left out.
@Injectable()
export class GarageScheduleService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(actor: Actor, query: ScheduleQuery, now = new Date()) {
    requireCapability(actor, 'garage.schedule');
    const garageId = actor.garageId as string;
    const from = query.from ?? localDay(now);
    const to = query.to ?? from;
    const span = daysBetween(from, to);
    if (!(span >= 0 && span < MAX_DAYS))
      throw invalidInput(`from and to span 1 to ${MAX_DAYS} days`);
    const lifts =
      (
        await this.prisma.garageFeature.findUnique({
          where: { garageId_key: { garageId, key: 'lift_schedule' } },
        })
      )?.enabled ?? true;
    if (!lifts && query.lift !== undefined)
      throw invalidInput('this garage schedules without lifts');
    const rows = await this.prisma.booking.findMany({
      include: { ...bookedInclude, mechanic: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      where: {
        garageId,
        lift: query.lift,
        mechanicId: query.mechanicId,
        startsAt: { gte: atLocal(from, 0), lt: atLocal(addDays(to, 1), 0) },
        status: { notIn: ['lapsed', 'cancelled'] },
      },
    });
    const entries = rows.map((row) => {
      const awaiting = row.status === 'awaiting_confirmation';
      return {
        ...bookedOf(row, actor.language),
        confirmBy: awaiting ? row.confirmBy.toISOString() : null,
        ...(lifts && { lift: row.lift }),
        mechanic: row.mechanic
          ? { id: row.mechanic.id, name: row.mechanic.name }
          : null,
        minutesLeft: awaiting
          ? Math.max(
              0,
              Math.floor((row.confirmBy.getTime() - now.getTime()) / MINUTE),
            )
          : null,
      };
    });
    return { entries, from, lifts, to };
  }
}
