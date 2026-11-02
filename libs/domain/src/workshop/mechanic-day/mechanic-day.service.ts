import {
  DAY,
  type MeDayDto,
  type MeDayQueryDto,
  type MeDayRowDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { firstName } from '../../audit/audit.service';
import { notFound, refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { addDays, atLocal, daysBetween, localDay } from '../../bucharest';
import { featureOn } from '../../garages/features/feature-on';
import type {
  BookingSegment,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { bookedInclude, bookedOf, iso } from '../../quotes/reads';
import { lockOf } from '../garage-jobs/garage-jobs.service';

// How far from today, either way, a day may be read.
const REACH_DAYS = 30;

const BOOKED = ['confirmed', 'completed'] as const;

const JOB_ROW = {
  car: { select: { plate: true } },
  driver: { select: { name: true } },
  lockHolder: { select: { name: true } },
  steps: { select: { doneAt: true } },
} as const;

type JobRow = Prisma.JobGetPayload<{ include: typeof JOB_ROW }>;
type BookedRow = Parameters<typeof bookedOf>[0];

// One calendar day as YYYY-MM-DD; a repeated query parameter arrives as an
// array and 2027-02-30 rolls over, so both are refused.
const isDay = (date: unknown): date is string =>
  typeof date === 'string' &&
  DAY.test(date) &&
  new Date(Date.parse(date) || 0).toISOString().startsWith(date);

const byStartThenBooking = (a: MeDayRowDto, b: MeDayRowDto) =>
  a.start.localeCompare(b.start) || a.bookingId.localeCompare(b.bookingId);

// One Bucharest day of the signed-in mechanic's jobs, each with the job's own
// status, so the queue, the garage and the customer read the same one.
@Injectable()
export class MechanicDayService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async get(
    actor: Actor,
    query: MeDayQueryDto,
    now = new Date(),
  ): Promise<MeDayDto> {
    const card = await this.card(actor);
    const today = localDay(now);
    const date: unknown = query.date ?? today;
    if (!isDay(date))
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation_failed',
        'The day must be a YYYY-MM-DD calendar day',
        [{ code: 'invalid', field: 'date' }],
      );
    if (Math.abs(daysBetween(today, date)) > REACH_DAYS)
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation_failed',
        `The day must be within ${REACH_DAYS} days of today`,
        [{ code: 'out_of_range', field: 'date' }],
      );
    const dayStart = atLocal(date, 0);
    const dayEnd = atLocal(addDays(date, 1), 0);
    const onDay = { startsAt: { gte: dayStart, lt: dayEnd } };
    const lifts = await featureOn(this.prisma, card.garageId, 'lift_schedule');
    const row = (
      booking: BookedRow,
      job: JobRow,
      segment: BookingSegment | undefined,
      carryOver: boolean,
    ): MeDayRowDto => {
      const booked = bookedOf(booking, actor.language);
      return {
        bookingId: booking.id,
        car: {
          brand: booked.car.brand,
          model: booked.car.model,
          plate: job.car.plate,
        },
        carryOver,
        driverFirstName: firstName(job.driver.name),
        inWorkSince: iso(job.inWorkSince),
        jobId: job.id,
        jobs: booked.jobs,
        ...(lifts && segment?.lift != null && { lift: segment.lift }),
        lock: lockOf(job),
        start: (segment?.startsAt ?? booking.startsAt).toISOString(),
        status: job.status,
        stepsDone: job.steps.filter((step) => step.doneAt).length,
        stepsTotal: job.steps.length,
        workedSeconds: job.workedSeconds,
      };
    };

    const bookings = await this.prisma.booking.findMany({
      include: {
        ...bookedInclude,
        job: { include: JOB_ROW },
        segments: { orderBy: { startsAt: 'asc' }, take: 1, where: onDay },
      },
      where: {
        job: { isNot: null },
        mechanicId: card.id,
        segments: { some: onDay },
        status: { in: [...BOOKED] },
      },
    });
    const rows = bookings
      .flatMap((booking) =>
        booking.job
          ? [row(booking, booking.job, booking.segments[0], false)]
          : [],
      )
      .sort(byStartThenBooking);

    // Work begun on an earlier day and not over before today leads today.
    if (date === today) {
      const carried = await this.prisma.job.findMany({
        include: {
          ...JOB_ROW,
          booking: {
            include: {
              ...bookedInclude,
              segments: { orderBy: { startsAt: 'asc' } },
            },
          },
        },
        where: {
          booking: {
            segments: { none: onDay },
            status: { in: [...BOOKED] },
          },
          mechanicId: card.id,
          OR: [
            { status: { in: ['in_work', 'paused'] } },
            { finishedAt: { gte: dayStart, lt: dayEnd }, status: 'done' },
          ],
        },
      });
      const lead = carried
        .map(({ booking, ...job }) => {
          const before = booking.segments.filter((s) => s.startsAt < dayStart);
          return row(booking, job, before.at(-1) ?? booking.segments[0], true);
        })
        .sort(byStartThenBooking);
      rows.unshift(...lead);
    }

    return {
      date,
      inWork: rows.filter((r) => r.status === 'in_work').length,
      jobs: rows.length,
      rows,
    };
  }

  // Only a mechanic with a live card at a garage that works as a team has a
  // day; everyone else is told there is none.
  private async card(actor: Actor) {
    if (actor.role !== 'mechanic' || !actor.garageId) throw notFound();
    const card = await this.prisma.mechanic.findFirst({
      select: { garageId: true, id: true },
      where: {
        accountId: actor.accountId,
        garageId: actor.garageId,
        removedAt: null,
      },
    });
    if (
      !card ||
      !(await featureOn(this.prisma, card.garageId, 'team_mechanics'))
    )
      throw notFound();
    return card;
  }
}
