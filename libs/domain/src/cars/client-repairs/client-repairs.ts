import {
  type ClientRepairDto,
  type CorrectClientRepairDto,
  DELETED_AUTHOR,
} from '@motor-fix/contracts';

import type { Prisma, RepairUpdater } from '../../generated/prisma/client';
import { shortName } from '../../quotes/reads';

// The four fields a correction may change, as the answer shows them.
export const CORRECTABLE = [
  'what',
  'doneOn',
  'odometerKm',
  'costBani',
] as const;
type Correctable = (typeof CORRECTABLE)[number];
export type Corrected = {
  what: string;
  doneOn: string;
  odometerKm: number | null;
  costBani: number | null;
};

// The sent fields that differ from what is stored.
export function changes(
  before: Corrected,
  dto: Partial<Pick<CorrectClientRepairDto, Correctable>>,
): Partial<Corrected> {
  const after: Partial<Corrected> = {};
  for (const field of CORRECTABLE) {
    const value = dto[field];
    if (value !== undefined && !Object.is(value, before[field])) {
      Object.assign(after, { [field]: value });
    }
  }
  return after;
}

// The repairs the garage's owner may read and correct: the logged ones a
// driver shared with his approved garage, not deleted.
export const ownerScope = (garageId: string) =>
  ({
    deletedAt: null,
    garage: { status: 'approved' },
    garageId,
    sharedWithGarage: true,
    source: 'logged',
  }) satisfies Prisma.RepairWhereInput;

// What a row is read with: the car and its open ownership's account.
export const CLIENT_REPAIR_SELECT = {
  car: {
    select: {
      brand: { select: { name: true } },
      model: true,
      ownerships: {
        select: {
          account: { select: { name: true, status: true } },
          accountId: true,
        },
        where: { toDate: null },
      },
      year: true,
    },
  },
  costBani: true,
  doneOn: true,
  id: true,
  odometerKm: true,
  updatedAt: true,
  updatedByRole: true,
  what: true,
} satisfies Prisma.RepairSelect;

export type ClientRepairRow = {
  car: {
    brand: { name: string };
    model: string;
    ownerships: {
      account: { name: string; status: string };
      accountId: string;
    }[];
    year: number;
  };
  costBani: number | null;
  doneOn: Date;
  id: string;
  odometerKm: number | null;
  updatedAt: Date;
  updatedByRole: RepairUpdater | null;
  what: string;
};

export const stored = (row: ClientRepairRow): Corrected => ({
  costBani: row.costBani,
  doneOn: row.doneOn.toISOString().slice(0, 10),
  odometerKm: row.odometerKm,
  what: row.what,
});

// The driver by first name and initial, never more; a car with no owner or a
// deleted one shows the deleted-account label.
export function toItem(row: ClientRepairRow): ClientRepairDto {
  const owner = row.car.ownerships[0]?.account;
  const live = owner && owner.status !== 'deleted' ? owner : null;
  const version = row.updatedAt.toISOString();
  return {
    car: {
      brandName: row.car.brand.name,
      model: row.car.model,
      year: row.car.year,
    },
    correctedAt: row.updatedByRole === 'owner' ? version : null,
    driver: { shortName: live ? shortName(live.name) : DELETED_AUTHOR },
    id: row.id,
    version,
    ...stored(row),
  };
}
