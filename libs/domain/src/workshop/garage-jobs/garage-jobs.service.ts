import type { JobDto, JobListDto, JobSummaryDto } from '@motor-fix/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type {
  Account,
  Booking,
  Car,
  Job,
  Prisma,
  PrismaClient,
  QuoteRequest,
} from '../../generated/prisma/client';
import {
  assertCursor,
  iso,
  NEWEST_FIRST,
  PAGE_TAKE,
  page,
  plateOf,
  shortName,
  snapshotOf,
} from '../../quotes/reads';

const SUMMARY = {
  booking: { include: { request: true } },
  car: { select: { plate: true } },
  driver: { select: { name: true } },
};

type SummaryRow = Job & {
  booking: Booking & { request: QuoteRequest };
  car: Pick<Car, 'plate'>;
  driver: Pick<Account, 'name'>;
};

// Never the driver's phone. The plate is shown to everyone who can read the
// job: the desk sees every job, a mechanic only their own.
function summaryOf(row: SummaryRow): JobSummaryDto {
  return {
    bookingId: row.bookingId,
    car: {
      ...snapshotOf(row.booking.request),
      ...plateOf(row.car.plate, true),
    },
    createdAt: row.createdAt.toISOString(),
    driver: { shortName: shortName(row.driver.name) },
    etaAt: iso(row.etaAt),
    finishedAt: iso(row.finishedAt),
    handedOverAt: iso(row.handedOverAt),
    id: row.id,
    mechanicId: row.mechanicId,
    pausedAt: iso(row.pausedAt),
    startedAt: iso(row.startedAt),
    status: row.status,
  };
}

// The garage's jobs: all of them for the owner and the desk, a mechanic's
// own for a mechanic.
@Injectable()
export class GarageJobsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(actor: Actor, cursor?: string): Promise<JobListDto> {
    const where = this.scope(actor);
    const from = await assertCursor(cursor, (id) =>
      this.prisma.job.findFirst({ where: { ...where, id } }),
    );
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        include: SUMMARY,
        orderBy: NEWEST_FIRST,
        take: PAGE_TAKE,
        where,
        ...from,
      }),
      this.prisma.job.count({ where }),
    ]);
    return page(rows, total, summaryOf);
  }

  async get(actor: Actor, id: string): Promise<JobDto> {
    const row = await this.prisma.job.findFirst({
      include: {
        ...SUMMARY,
        stages: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
        steps: { orderBy: { position: 'asc' } },
      },
      where: { ...this.scope(actor), id },
    });
    if (!row) throw new NotFoundException();
    return {
      ...summaryOf(row),
      finalPriceBani: row.finalPriceBani,
      stages: row.stages.map((stage) => ({
        actorRole: stage.actorRole,
        at: stage.at.toISOString(),
        fromStatus: stage.fromStatus,
        id: stage.id,
        text: stage.text,
        toStatus: stage.toStatus,
      })),
      steps: row.steps.map((step) => ({
        customerLabel: step.customerLabel,
        doneAt: iso(step.doneAt),
        id: step.id,
        label: step.label,
        position: step.position,
      })),
    };
  }

  private scope(actor: Actor): Prisma.JobWhereInput {
    requireCapability(actor, 'garage.own_jobs');
    const garageId = actor.garageId as string;
    return actor.role === 'mechanic'
      ? { garageId, mechanic: { accountId: actor.accountId } }
      : { garageId };
  }
}
