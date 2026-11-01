import { type GarageScheduleEntryDto, storedWeek } from '@motor-fix/contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  type Actor,
  assertGarage,
  forbidden,
  requireCapability,
} from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { addDays, atLocal, daysBetween, localDay } from '../../bucharest';
import { wall } from '../../garages/garage-hours';
import { unset } from '../../garages/mechanic-hours';
import type { PrismaClient } from '../../generated/prisma/client';
import { blocksOf } from '../../workshop/time-blocks/time-blocks';
import { bookedInclude, bookedOf, shortName } from '../reads';

interface ScheduleQuery {
  from?: string;
  to?: string;
  lift?: number;
  mechanicId?: string;
}

const MAX_DAYS = 7;
const MINUTE = 60_000;

// The board's own refusal of a range or a lift: the API's 400 code, which the
// MCP tool passes on with this English message.
const invalidQuery = (message: string) =>
  new BadRequestException({ code: 'validation_failed', message });

// The garage's bookings over whole Bucharest days, as the schedule board
// shows them: what is still awaiting the garage, what is on, what was done or
// missed. Lapsed and cancelled bookings hold no slot and are left out. A
// booking is on each day one of its segments touches; one with none (still
// awaiting, a no-show, done before segments) on the day it starts.
@Injectable()
export class GarageScheduleService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(
    actor: Actor,
    garageId: string,
    query: ScheduleQuery,
    now = new Date(),
  ) {
    requireCapability(actor, 'garage.schedule');
    assertGarage(actor, garageId);
    const mechanicId = await this.mechanicOf(actor, query.mechanicId);
    const from = query.from ?? localDay(now);
    const to = query.to ?? from;
    const span = daysBetween(from, to);
    if (!(span >= 0 && span < MAX_DAYS))
      throw invalidQuery(`from and to span 1 to ${MAX_DAYS} days`);
    const lifts =
      (
        await this.prisma.garageFeature.findUnique({
          where: { garageId_key: { garageId, key: 'lift_schedule' } },
        })
      )?.enabled ?? true;
    if (!lifts && query.lift !== undefined)
      throw invalidQuery('this garage schedules without lifts');
    const start = atLocal(from, 0);
    const end = atLocal(addDays(to, 1), 0);
    const rows = await this.prisma.booking.findMany({
      include: {
        ...bookedInclude,
        driver: { select: { name: true } },
        job: { select: { status: true } },
        mechanic: true,
        segments: { orderBy: { startsAt: 'asc' } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      where: {
        garageId,
        lift: query.lift,
        mechanicId,
        OR: [
          {
            segments: {
              some: { endsAt: { gt: start }, startsAt: { lt: end } },
            },
          },
          { segments: { none: {} }, startsAt: { gte: start, lt: end } },
        ],
        status: { notIn: ['lapsed', 'cancelled'] },
      },
    });
    const entries = rows.map((row) => {
      const awaiting = row.status === 'awaiting_confirmation';
      const { state, ...booked } = bookedOf(row, actor.language);
      return {
        ...booked,
        confirmBy: awaiting ? row.confirmBy.toISOString() : null,
        customer: shortName(row.driver.name),
        jobStatus: row.job?.status ?? null,
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
        segments: row.segments.map((segment) => ({
          endsAt: segment.endsAt.toISOString(),
          ...(lifts && { lift: segment.lift }),
          mechanicId: segment.mechanicId,
          startsAt: segment.startsAt.toISOString(),
        })),
        // Lapsed and cancelled bookings are not read.
        status: state as GarageScheduleEntryDto['status'],
      };
    });
    const blocks = await blocksOf(
      this.prisma,
      { end, garageId, lift: query.lift, mechanicId, start },
      lifts,
    );
    const calendar = await this.calendarOf(garageId, from, span);
    return {
      blocks,
      entries,
      from,
      lifts,
      to,
      ...calendar,
      liftCount: lifts ? calendar.liftCount : 0,
    };
  }

  // The garage's lifts and when it opens on each day of the range: no
  // interval on a closed day, a public holiday or while it has set no hours.
  private async calendarOf(garageId: string, from: string, span: number) {
    const days = Array.from({ length: span + 1 }, (_, n) => addDays(from, n));
    const range = {
      gte: new Date(`${from}T00:00:00Z`),
      lte: new Date(`${days[span]}T00:00:00Z`),
    };
    const [garage, closed, holidays] = await Promise.all([
      this.prisma.garage.findUniqueOrThrow({
        select: { hours: true, liftCount: true },
        where: { id: garageId },
      }),
      this.prisma.garageClosedDay.findMany({
        select: { day: true },
        where: { day: range, garageId },
      }),
      this.prisma.publicHoliday.findMany({
        select: { day: true },
        where: { day: range },
      }),
    ]);
    const shut = new Set(
      [...closed, ...holidays].map((d) => d.day.toISOString().slice(0, 10)),
    );
    const week = storedWeek(garage.hours);
    return {
      days: days.map((day) => ({
        day,
        open: shut.has(day)
          ? []
          : (week[wall(atLocal(day, 12)).weekday] ?? []).map(
              ([open, close]) => ({
                from: open,
                to: close,
              }),
            ),
      })),
      hoursSet: !unset(garage.hours),
      liftCount: garage.liftCount,
    };
  }

  // A mechanic reads her own card's bookings only, and asks for no other,
  // unless she may move bookings: then she reads the garage's like the desk.
  // A removed card is no longer hers to read.
  private async mechanicOf(actor: Actor, asked?: string) {
    if (actor.role !== 'mechanic') return asked;
    const own = await this.prisma.mechanic.findUnique({
      select: { id: true, removedAt: true },
      where: { accountId: actor.accountId },
    });
    if (!own || own.removedAt) throw new NotFoundException();
    if (actor.permissions.canMoveBookings) return asked;
    if (asked !== undefined && asked !== own.id)
      throw forbidden('A mechanic reads only her own schedule');
    return own.id;
  }
}
