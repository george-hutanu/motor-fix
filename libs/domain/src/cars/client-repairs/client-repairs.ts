import {
  type ClientRepairDto,
  type CorrectClientRepairDto,
  DELETED_AUTHOR,
} from '@motor-fix/contracts';
import type { Capability } from '@motor-fix/contracts/capabilities';

import type { Actor } from '../../auth/policy';
import type { Prisma, RepairUpdater } from '../../generated/prisma/client';
import { shortName } from '../../quotes/reads';

// The most repairs one list answers; it says when more exist.
export const LIST_LIMIT = 200;

// The four fields a correction may change, as the answer shows them.
const CORRECTABLE = ['what', 'doneOn', 'odometerKm', 'costBani'] as const;
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
    if (value !== undefined && value !== before[field]) {
      Object.assign(after, { [field]: value });
    }
  }
  return after;
}

// Who a correction is recorded as: the garage's owner, or an admin.
export const writerOf = (actor: { role: string }): 'owner' | 'admin' =>
  actor.role === 'admin' ? 'admin' : 'owner';

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

// Who may correct a repair, and which repairs they reach.
export type RepairScope = {
  capability: Capability;
  where: Prisma.RepairWhereInput;
};

// A garage's owner reaches its shared repairs; an actor with no garage, none.
export const garageScope = (
  actor: Pick<Actor, 'garageId'>,
): RepairScope | null =>
  actor.garageId
    ? { capability: 'garage.client_repairs', where: ownerScope(actor.garageId) }
    : null;

// The MotorFix admin reaches every logged repair not deleted, shared or not.
export const ADMIN_SCOPE = {
  capability: 'admin.users',
  where: { deletedAt: null, source: 'logged' },
} satisfies RepairScope;

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
  carId: true,
  costBani: true,
  doneOn: true,
  garageId: true,
  garageName: true,
  id: true,
  odometerKm: true,
  sharedWithGarage: true,
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
  carId: string;
  costBani: number | null;
  doneOn: Date;
  garageId: string | null;
  garageName: string;
  id: string;
  odometerKm: number | null;
  sharedWithGarage: boolean;
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

// The driver by first name and initial, never more; a car with no owner, a
// deleted one or one with no name shows the deleted-account label.
export function toItem(row: ClientRepairRow): ClientRepairDto {
  const owner = row.car.ownerships[0]?.account;
  const name = owner && owner.status !== 'deleted' ? shortName(owner.name) : '';
  const version = row.updatedAt.toISOString();
  return {
    car: {
      brandName: row.car.brand.name,
      model: row.car.model,
      year: row.car.year,
    },
    correctedAt: row.updatedByRole === 'owner' ? version : null,
    driver: { shortName: name || DELETED_AUTHOR },
    id: row.id,
    version,
    ...stored(row),
  };
}
