import type {
  JobDto,
  JobListDto,
  JobListQueryDto,
  JobSummaryDto,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { atLocal, localDay } from '../../bucharest';
import type {
  Account,
  Booking,
  Car,
  Job,
  JobStep,
  JobType,
  Mechanic,
  Prisma,
  PrismaClient,
  QuoteRequest,
  RequestJob,
} from '../../generated/prisma/client';
import {
  assertCursor,
  iso,
  jobsOf,
  PAGE_TAKE,
  page,
  plateOf,
  shortName,
  snapshotOf,
} from '../../quotes/reads';

const SUMMARY = {
  booking: {
    include: {
      request: {
        include: {
          jobs: {
            include: { jobType: true },
            orderBy: { position: 'asc' as const },
          },
        },
      },
    },
  },
  car: { select: { plate: true } },
  driver: { select: { name: true } },
  mechanic: { select: { name: true } },
  steps: { select: { doneAt: true } },
};

// The day's work in the order it was booked; the id breaks a tie.
const BY_START = [
  { booking: { startsAt: 'asc' as const } },
  { id: 'asc' as const },
];

type SummaryRow = Job & {
  booking: Booking & {
    request: QuoteRequest & { jobs: (RequestJob & { jobType: JobType })[] };
  };
  car: Pick<Car, 'plate'>;
  driver: Pick<Account, 'name'>;
  mechanic: Pick<Mechanic, 'name'> | null;
  steps: Pick<JobStep, 'doneAt'>[];
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
    jobs: jobsOf(row.booking.request.jobs),
    mechanicId: row.mechanicId,
    mechanicName: row.mechanic?.name ?? null,
    pausedAt: iso(row.pausedAt),
    startedAt: iso(row.startedAt),
    startsAt: row.booking.startsAt.toISOString(),
    status: row.status,
    stepsDone: row.steps.filter((step) => step.doneAt).length,
    stepsTotal: row.steps.length,
  };
}

// The garage's jobs: all of them for the owner and the desk, a mechanic's
// own for a mechanic.
@Injectable()
export class GarageJobsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // From the start of a Bucharest day (today unless named), with every job
  // still in work or paused however long ago it was booked.
  async list(actor: Actor, query: JobListQueryDto = {}): Promise<JobListDto> {
    const day = atLocal(query.from ?? localDay(new Date()), 0);
    const where: Prisma.JobWhereInput = {
      ...this.scope(actor),
      OR: [
        { booking: { startsAt: { gte: day } } },
        { status: { in: ['in_work', 'paused'] } },
      ],
    };
    const from = await assertCursor(query.cursor, (id) =>
      this.prisma.job.findFirst({ where: { ...where, id } }),
    );
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        include: SUMMARY,
        orderBy: BY_START,
        take: PAGE_TAKE,
        where,
        ...from,
      }),
      this.prisma.job.count({ where }),
    ]);
    return page(rows, total, summaryOf);
  }

  // A mechanic of the garage reads only their own job: another one is
  // refused, not hidden, since the garage's list already names it.
  async get(actor: Actor, id: string): Promise<JobDto> {
    requireCapability(actor, 'garage.own_jobs');
    if (!actor.garageId) throw new NotFoundException();
    const row = await this.prisma.job.findFirst({
      include: {
        ...SUMMARY,
        mechanic: { select: { accountId: true, name: true } },
        stages: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
        steps: { orderBy: { position: 'asc' } },
      },
      where: { garageId: actor.garageId, id },
    });
    if (!row) throw new NotFoundException();
    if (
      actor.role === 'mechanic' &&
      row.mechanic?.accountId !== actor.accountId
    ) {
      throw refusal(HttpStatus.FORBIDDEN, 'forbidden', 'Not your job');
    }
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
        doneBy: step.doneById,
        id: step.id,
        label: step.label,
        position: step.position,
      })),
    };
  }

  private scope(actor: Actor): Prisma.JobWhereInput {
    requireCapability(actor, 'garage.own_jobs');
    const garageId = actor.garageId;
    if (!garageId) throw new NotFoundException();
    return actor.role === 'mechanic'
      ? { garageId, mechanic: { accountId: actor.accountId } }
      : { garageId };
  }
}
