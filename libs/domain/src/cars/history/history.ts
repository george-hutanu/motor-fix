import type { Prisma } from '../../generated/prisma/client';

// What an ownership row needs to decide which repairs it may read.
export type OwnershipRow = {
  carId: string;
  closedAt: Date | null;
  openedAt: Date;
  toDate: Date | null;
  transferId: string | null;
};

// Who last corrected a repair, as the driver is told: a driver's own edit
// is none.
export const CORRECTED_BY = {
  admin: 'admin',
  driver: null,
  owner: 'garage',
} as const;

// Newest first: the day done, then the creation time.
export const REPAIR_ORDER = [
  { doneOn: 'desc' },
  { createdAt: 'desc' },
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
