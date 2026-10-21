import type {
  ActiveRequestAnswerDto,
  ActiveRequestDto,
} from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import {
  byClosest,
  etaOf,
  isOpen,
  jobOf,
  LIVE_BOOKINGS,
  liveBooking,
  mechanicOf,
  rangeOf,
  stageOf,
  stepsOf,
} from './active-request.rules';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { garageRef, iso, jobsOf } from '../../quotes/reads';

const OPEN_STATUSES: Prisma.QuoteRequestWhereInput['status'] = {
  in: ['sent', 'quoted', 'booked', 'in_work', 'done'],
};

const include = {
  bookings: {
    include: {
      garage: true,
      job: {
        include: { mechanic: true, steps: { orderBy: { position: 'asc' } } },
      },
      mechanic: true,
      quote: { select: { fromBani: true, toBani: true } },
    },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    where: { status: { in: [...LIVE_BOOKINGS] } },
  },
  jobs: { include: { jobType: true }, orderBy: { position: 'asc' } },
  quotes: {
    select: { fromBani: true, sentAt: true, status: true, toBani: true },
  },
} satisfies Prisma.QuoteRequestInclude;

// The driver's open request closest to the workshop, read in a fixed number of
// statements whatever the number of open requests.
@Injectable()
export class ActiveRequestService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async get(actor: Actor): Promise<ActiveRequestAnswerDto> {
    requireCapability(actor, 'driver.requests');
    const rows = await this.prisma.quoteRequest.findMany({
      include,
      where: { driverId: actor.accountId, status: OPEN_STATUSES },
    });
    const open = rows.filter(isOpen).sort(byClosest);
    const [row] = open;
    if (!row) return { openCount: 0, request: null };

    const booking = liveBooking(row);
    const job = jobOf(booking);
    const teamOn = booking ? await this.teamOn(booking.garageId) : true;
    const request: ActiveRequestDto = {
      booking: booking
        ? {
            confirmBy: booking.confirmBy.toISOString(),
            garage: garageRef(booking.garage),
            startsAt: booking.startsAt.toISOString(),
            status: booking.status as 'awaiting_confirmation',
          }
        : null,
      car: { brand: row.carBrand, model: row.carModel, year: row.carYear },
      description: row.description,
      id: row.id,
      job:
        booking && job
          ? {
              etaAt: iso(etaOf(job, booking.durationMinutes)),
              finalPriceBani: job.finalPriceBani,
              startedAt: iso(job.startedAt),
              status: job.status as 'to_do',
              steps: stepsOf(job.steps, job.status),
            }
          : null,
      jobs: jobsOf(row.jobs),
      mechanicName: mechanicOf(booking, teamOn),
      range: rangeOf(row),
      stage: stageOf(row),
    };
    return { openCount: open.length, request };
  }

  // Mechanics are named unless the garage turned its team off.
  private async teamOn(garageId: string): Promise<boolean> {
    const rows = await this.prisma.garageFeature.findMany({
      where: { garageId, key: 'team_mechanics' },
    });
    return rows[0]?.enabled ?? true;
  }
}
