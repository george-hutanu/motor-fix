import type {
  CarRepairDto,
  RepairReviewDto,
  RepairReviewState,
  ReviewRefusal,
} from '@motor-fix/contracts';

import type { Actor } from '../../auth/policy';
import type { Prisma } from '../../generated/prisma/client';

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
    },
  },
  jobId: true,
  odometerKm: true,
  source: true,
  updatedByRole: true,
  what: true,
} satisfies Prisma.RepairSelect;

type RepairRow = Prisma.RepairGetPayload<{
  select: typeof REPAIR_ROW_SELECT;
}>;

// Who last corrected a repair, as the driver is told: a driver's own edit
// is none.
export const CORRECTED_BY = {
  admin: 'admin',
  driver: null,
  owner: 'garage',
} as const;

const day = (at: Date) => at.toISOString().slice(0, 10);

// The review state a MotorFix repair shows for the eligibility's reason.
// Nothing answers expired until the review window exists (ST-120).
const REVIEW_STATE: Record<ReviewRefusal | 'null', RepairReviewState> = {
  already_reviewed: 'written',
  email_not_confirmed: 'can_write',
  job_not_done: 'none',
  not_found: 'none',
  null: 'can_write',
  own_garage: 'none',
  review_removed: 'removed',
};

export const reviewStateOf = (reason: ReviewRefusal | null) =>
  REVIEW_STATE[reason ?? 'null'];

type Judge = {
  judge(
    actor: Actor,
    jobIds: string[],
  ): Promise<
    {
      jobId: string;
      reason: ReviewRefusal | null;
      review: { id: string; rating: number } | null;
    }[]
  >;
};

// The review of each MotorFix repair on a page, by job: one judgement for
// the whole page, none for a page with no MotorFix repair.
export async function reviewsOf(
  eligibility: Judge,
  actor: Actor,
  repairs: { jobId: string | null }[],
): Promise<Map<string, RepairReviewDto>> {
  const jobIds = [
    ...new Set(repairs.flatMap(({ jobId }) => (jobId ? [jobId] : []))),
  ];
  if (jobIds.length === 0) return new Map();
  const verdicts = await eligibility.judge(actor, jobIds);
  return new Map(
    verdicts.map(({ jobId, reason, review }) => {
      const state = reviewStateOf(reason);
      return [
        jobId,
        {
          jobId,
          rating: state === 'written' ? (review?.rating ?? null) : null,
          reviewId:
            state === 'written' || state === 'removed'
              ? (review?.id ?? null)
              : null,
          state,
        },
      ];
    }),
  );
}

// The row a reader sees: a MotorFix repair names its jobs in the reader's
// language, falling back to the text stored at the handover, and carries
// its review from `reviews`.
export function toRow(
  { car, createdAt, doneOn, job, jobId, updatedByRole, ...repair }: RepairRow,
  row: Pick<OwnershipRow, 'openedAt'>,
  language: 'ro' | 'en',
  reviews: Map<string, RepairReviewDto>,
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
    review: (motorfix && jobId && reviews.get(jobId)) || null,
    what:
      (motorfix && job && jobNames(job.booking.quote.jobs, language)) ||
      repair.what,
  };
}
