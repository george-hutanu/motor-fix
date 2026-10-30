import type { CarRepairDto, RepairReviewDto } from '@motor-fix/contracts';

import { daysBetween } from '../../bucharest';
import type { Prisma, ReviewStatus } from '../../generated/prisma/client';

// What an ownership row needs to decide which repairs it may read.
export type OwnershipRow = {
  carId: string;
  closedAt: Date | null;
  openedAt: Date;
  toDate: Date | null;
  transferId: string | null;
};

// Newest first: the day done, then the creation time; the id breaks a tie,
// so a page boundary never skips or repeats a row.
export const REPAIR_ORDER = [
  { doneOn: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.RepairOrderByWithRelationInput[];

// The one visibility rule: every MotorFix repair, a logged one
// created during the ownership or ticked on the transfer that opened it,
// never a deleted one; a closed row reads nothing done after its sale date
// or recorded after its closing instant, whatever the source.
export function repairWhere(row: OwnershipRow): Prisma.RepairWhereInput {
  const { closedAt, toDate } = row;
  return {
    carId: row.carId,
    deletedAt: null,
    OR: [
      { source: 'motorfix' },
      {
        createdAt: { gte: row.openedAt, ...(closedAt && { lt: closedAt }) },
        source: 'logged',
      },
      ...(row.transferId
        ? [{ transfers: { some: { transferId: row.transferId } } }]
        : []),
    ],
    ...(closedAt &&
      toDate && {
        AND: [{ doneOn: { lte: toDate } }, { createdAt: { lt: closedAt } }],
      }),
  };
}

// A repair recorded before the row opened came with the car.
export const fromPreviousOwner = (
  repair: { createdAt: Date },
  row: Pick<OwnershipRow, 'openedAt'>,
) => repair.createdAt < row.openedAt;

// The account's open row for the car: its owner's.
export const openRow = (
  tx: Prisma.TransactionClient,
  carId: string,
  accountId: string,
) =>
  tx.carOwnership.findFirst({
    where: { accountId, carId, toDate: null },
  });

// The car's current owner, unless the account is deleted.
export function liveOwner(car: {
  ownerships: { accountId: string; account: { status: string } }[];
}): string | null {
  const open = car.ownerships[0];
  return open && open.account.status !== 'deleted' ? open.accountId : null;
}

type QuotedJob = {
  requestJob: { position: number; jobType: { nameEn: string; nameRo: string } };
};

// The quoted jobs the garage did, by the order the driver asked them.
export const jobNames = (jobs: QuotedJob[], language: 'ro' | 'en') =>
  jobs
    .toSorted((a, b) => a.requestJob.position - b.requestJob.position)
    .map(({ requestJob: { jobType } }) =>
      language === 'en' ? jobType.nameEn : jobType.nameRo,
    )
    .join(', ');

// How long after the repair the driver may still write a review.
const REVIEW_DAYS = 60;

// A removed review is neither shown nor written again; one its author
// deleted leaves the window open as if none had been written.
export function reviewState(
  review: { rating: number; status: ReviewStatus } | null,
  doneOn: Date,
  today: string,
): RepairReviewDto {
  if (review?.status === 'published' || review?.status === 'reported') {
    return { rating: review.rating, state: 'rated' };
  }
  if (review?.status === 'removed') return { state: 'none' };
  return daysBetween(day(doneOn), today) <= REVIEW_DAYS
    ? { state: 'write' }
    : { state: 'none' };
}

export const REPAIR_ROW_SELECT = {
  car: {
    select: {
      brand: { select: { name: true } },
      id: true,
      model: true,
      year: true,
    },
  },
  costBani: true,
  createdAt: true,
  doneOn: true,
  garageId: true,
  garageName: true,
  id: true,
  job: {
    select: {
      booking: {
        select: {
          quote: {
            select: {
              jobs: {
                select: {
                  requestJob: {
                    select: {
                      jobType: { select: { nameEn: true, nameRo: true } },
                      position: true,
                    },
                  },
                },
                where: { included: true },
              },
            },
          },
        },
      },
      mechanic: { select: { name: true } },
      reviews: {
        orderBy: { postedAt: 'desc' },
        select: { rating: true, status: true },
        take: 1,
      },
    },
  },
  odometerKm: true,
  source: true,
  updatedByRole: true,
  what: true,
} satisfies Prisma.RepairSelect;

export type RepairRow = Prisma.RepairGetPayload<{
  select: typeof REPAIR_ROW_SELECT;
}>;

// Who last corrected a repair, as the driver is told: a driver's own edit
// is none.
const CORRECTED_BY = {
  admin: 'admin',
  driver: null,
  owner: 'garage',
} as const;

const day = (at: Date) => at.toISOString().slice(0, 10);

// The row a reader sees: a MotorFix repair names its jobs in the reader's
// language, falling back to the text stored at the handover.
export function toRow(
  { car, createdAt, doneOn, job, updatedByRole, ...repair }: RepairRow,
  row: Pick<OwnershipRow, 'openedAt'>,
  language: 'ro' | 'en',
  today: string,
): CarRepairDto {
  const motorfix = repair.source === 'motorfix';
  return {
    ...repair,
    car: {
      brandName: car.brand.name,
      id: car.id,
      model: car.model,
      year: car.year,
    },
    correctedBy: CORRECTED_BY[updatedByRole ?? 'driver'],
    doneOn: day(doneOn),
    fromPreviousOwner: fromPreviousOwner({ createdAt }, row),
    mechanicName: job?.mechanic?.name ?? null,
    review: motorfix
      ? reviewState(job?.reviews[0] ?? null, doneOn, today)
      : null,
    what:
      (motorfix && job && jobNames(job.booking.quote.jobs, language)) ||
      repair.what,
  };
}
