import {
  FREE_SLOTS_DURATION_MAX,
  type FreeSlotsDto,
  type FreeSlotsQueryDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { type FreeSlotsInput, freeSlots } from './free-slots';
import { FreeSlotsCache, type FreeSlotsKey } from './free-slots.cache';
import { recordFreeSlots } from './free-slots.metrics';
import { notFound, refusal } from '../../auth/http-refusal';
import { type Actor, forbidden } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { addDays, atLocal, localDay, localIso } from '../../bucharest';
import { switchesOf } from '../../garages/features/garage-options';
import type { GarageCalendar } from '../../garages/mechanic-hours';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

const MINUTE = 60_000;
const STEP = 30 * MINUTE;
const LEAD = 60 * MINUTE;
const STAFF = ['garage', 'receptionist', 'mechanic'];

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

type Db = PrismaClient | Prisma.TransactionClient;

const invalid = (field: string, message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code: 'invalid', field },
  ]);

// The first free starts of a garage for a job, for its staff and for a
// driver who may still book or move there. Reads only.
@Injectable()
export class FreeSlotsService {
  private readonly logger = new Logger('FreeSlots');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: FreeSlotsCache,
  ) {}

  // Who may ask (FR-002), run by FreeSlotsGuard before the query is
  // validated; freeSlots trusts it has passed.
  async access(actor: Actor, garageId: string): Promise<void> {
    try {
      await this.assertCaller(actor, garageId);
    } catch (error) {
      this.refused(error, actor, garageId);
      throw error;
    }
  }

  async freeSlots(
    actor: Actor,
    garageId: string,
    query: FreeSlotsQueryDto,
  ): Promise<FreeSlotsDto> {
    try {
      const key = await this.normalized(actor, garageId, query);
      const answer = await this.cache.entry(key, () => this.read(key));
      recordFreeSlots(answer.reason ?? 'slots');
      return answer;
    } catch (error) {
      this.refused(error, actor, garageId);
      throw error;
    }
  }

  private refused(error: unknown, actor: Actor, garageId: string) {
    if (error instanceof HttpException && error.getStatus() < 500) {
      const body = error.getResponse() as { code?: string };
      this.logger.warn({
        code: body.code ?? error.getStatus(),
        garageId,
        role: actor.role,
      });
    }
  }

  private async assertCaller(actor: Actor, garageId: string) {
    if (actor.role === 'driver') return this.assertDriver(actor, garageId);
    if (!STAFF.includes(actor.role) || actor.garageId !== garageId) {
      throw notFound();
    }
    const { canAnswerQuotes, canMoveBookings } = actor.permissions;
    if (actor.role === 'mechanic' && !canAnswerQuotes && !canMoveBookings) {
      throw forbidden(
        actor.language === 'en'
          ? 'Only a mechanic who answers quotes or moves bookings sees the free slots'
          : 'Doar un mecanic care răspunde la oferte sau mută programări vede orele libere',
      );
    }
  }

  // A booking of hers there she may still move, or a quote of the garage she
  // may still accept; at a garage the public can reach.
  private async assertDriver(actor: Actor, garageId: string) {
    const now = new Date();
    const garage = { status: 'approved' as const };
    const [booking, quote] = await Promise.all([
      this.prisma.booking.findFirst({
        select: { id: true },
        where: {
          driverId: actor.accountId,
          garage,
          garageId,
          startsAt: { gt: now },
          status: { in: ['awaiting_confirmation', 'confirmed'] },
        },
      }),
      this.prisma.quote.findFirst({
        select: { id: true },
        where: {
          expiresAt: { gt: now },
          garage,
          garageId,
          request: { driverId: actor.accountId },
          status: 'waiting',
        },
      }),
    ]);
    if (!booking && !quote) throw notFound();
  }

  // The question after its defaults, the clamp and the rounding of the
  // earliest start, and the lift its jobs need; its two ids checked.
  private async normalized(
    actor: Actor,
    garageId: string,
    query: FreeSlotsQueryDto,
  ): Promise<FreeSlotsKey> {
    const now = Date.now();
    const asked = query.earliest ? Date.parse(query.earliest) : now + LEAD;
    const { mechanicId, excludeBookingId } = query;
    if (mechanicId) await this.assertMechanic(garageId, mechanicId);
    if (excludeBookingId) {
      await this.assertExcluded(actor, garageId, excludeBookingId);
    }
    return {
      count: query.count,
      duration: query.duration,
      earliest: new Date(Math.ceil(Math.max(asked, now) / STEP) * STEP),
      excludeBookingId,
      garageId,
      horizonDays: query.horizonDays,
      mechanicId,
      needsLift: query.needsLift ?? (await this.jobsNeedLift(query.jobTypeIds)),
    };
  }

  private async jobsNeedLift(jobTypeIds: string[] | undefined) {
    if (!jobTypeIds?.length) return false;
    const lifting = await this.prisma.jobType.count({
      where: { id: { in: jobTypeIds }, needsLift: true },
    });
    return lifting > 0;
  }

  private async assertMechanic(garageId: string, mechanicId: string) {
    const [switches, mechanic] = await Promise.all([
      switchesOf(this.prisma, garageId),
      this.prisma.mechanic.findFirst({
        select: { id: true },
        where: { garageId, id: mechanicId, removedAt: null },
      }),
    ]);
    if (!switches.team || !mechanic) {
      throw invalid('mechanicId', 'Not a current mechanic of this garage');
    }
  }

  private async assertExcluded(actor: Actor, garageId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      select: { id: true },
      where: {
        garageId,
        id,
        ...(actor.role === 'driver' && { driverId: actor.accountId }),
      },
    });
    if (!booking) {
      throw invalid('excludeBookingId', 'Not a booking of this garage');
    }
  }

  private async read(key: FreeSlotsKey): Promise<FreeSlotsDto> {
    const { slots } = freeSlots(await question(this.prisma, key));
    const dto = slots.map((s) => ({
      endsAt: localIso(s.endsAt),
      startsAt: localIso(s.startsAt),
    }));
    return dto.length > 0
      ? { slots: dto }
      : { reason: 'none_in_horizon', slots: [] };
  }
}

const LIFT_OF_JOBS = {
  select: {
    request: {
      select: {
        jobs: { select: { jobType: { select: { needsLift: true } } } },
      },
    },
  },
} as const;

const needsLiftOf = (booking: {
  request: { jobs: { jobType: { needsLift: boolean } }[] };
}) => booking.request.jobs.some((j) => j.jobType.needsLift);

// What the engine is asked for a key, read in the caller's client: a move's
// check reads it inside its own transaction, behind the garage's lock.
export async function question(
  db: Db,
  key: FreeSlotsKey,
): Promise<FreeSlotsInput> {
  const { garageId } = key;
  const first = localDay(key.earliest);
  const last = addDays(first, key.horizonDays);
  const from = atLocal(first, 0);
  const to = atLocal(last, 0);
  const days = { gte: asDate(first), lt: asDate(last) };
  const reach = {
    gte: new Date(from.getTime() - FREE_SLOTS_DURATION_MAX * MINUTE),
    lt: to,
  };
  const [
    garage,
    switches,
    closed,
    holidays,
    mechanics,
    segments,
    awaiting,
    asked,
  ] = await Promise.all([
    db.garage.findUniqueOrThrow({
      select: { hours: true, liftCount: true },
      where: { id: garageId },
    }),
    switchesOf(db, garageId),
    db.garageClosedDay.findMany({ where: { day: days, garageId } }),
    db.publicHoliday.findMany({ where: { day: days } }),
    db.mechanic.findMany({
      select: {
        daysOff: {
          select: { firstDay: true, lastDay: true },
          where: { firstDay: { lt: days.lt }, lastDay: { gte: days.gte } },
        },
        id: true,
        workingHours: true,
        worksSaturdays: true,
      },
      where: { garageId, removedAt: null },
    }),
    db.bookingSegment.findMany({
      select: {
        bookingId: true,
        endsAt: true,
        lift: true,
        mechanicId: true,
        startsAt: true,
      },
      where: { endsAt: { gt: from }, garageId, startsAt: { lt: to } },
    }),
    db.booking.findMany({
      select: {
        durationMinutes: true,
        id: true,
        startsAt: true,
        ...LIFT_OF_JOBS.select,
      },
      where: { garageId, startsAt: reach, status: 'awaiting_confirmation' },
    }),
    // A start a driver asked to move to is held like an awaiting booking
    // until the garage answers or the ask lapses.
    db.bookingMove.findMany({
      select: {
        booking: {
          select: { durationMinutes: true, id: true, ...LIFT_OF_JOBS.select },
        },
        newStartsAt: true,
      },
      where: {
        booking: { garageId, status: 'confirmed' },
        newStartsAt: reach,
        status: 'proposed',
      },
    }),
  ]);
  const held = [
    ...awaiting,
    ...asked.map((m) => ({ ...m.booking, startsAt: m.newStartsAt })),
  ];
  return {
    awaiting: held.map((b) => ({
      bookingId: b.id,
      endsAt: new Date(b.startsAt.getTime() + b.durationMinutes * MINUTE),
      needsLift: needsLiftOf(b),
      startsAt: b.startsAt,
    })),
    calendar: {
      closedDays: new Set(closed.map((c) => dayOf(c.day))),
      holidays: new Set(holidays.map((h) => dayOf(h.day))),
      hours: (garage.hours ?? {}) as GarageCalendar['hours'],
    },
    count: key.count,
    durationMinutes: key.duration,
    earliest: key.earliest,
    excludeBookingId: key.excludeBookingId,
    horizonDays: key.horizonDays,
    liftCount: switches.lifts ? garage.liftCount : 0,
    mechanicId: key.mechanicId,
    mechanics: mechanics.map((m) => ({
      id: m.id,
      schedule: {
        daysOff: m.daysOff.map((d) => ({
          firstDay: dayOf(d.firstDay),
          lastDay: dayOf(d.lastDay),
        })),
        workingHours: m.workingHours,
        worksSaturdays: m.worksSaturdays,
      },
    })),
    needsLift: key.needsLift,
    segments,
    switches,
  };
}
