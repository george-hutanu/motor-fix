import type {
  AdminRepairDto,
  AdminRepairListItemDto,
} from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { refusal } from '../../../auth/http-refusal';
import type { Prisma } from '../../../generated/prisma/client';
import { CORRECTED_BY } from '../../history/history';
import { type ClientRepairRow, carOf, stored } from '../client-repairs';

// A malformed id names nothing, so it answers as an unknown one.
export function idOr404(id: string, noun: 'account' | 'repair'): string {
  if (!isUUID(id)) {
    throw refusal(HttpStatus.NOT_FOUND, 'not_found', `No such ${noun}`);
  }
  return id;
}

// What the list reads of a repair: the day and the car, nothing more.
export const ADMIN_LIST_SELECT = {
  car: {
    select: { brand: { select: { name: true } }, model: true, year: true },
  },
  doneOn: true,
  id: true,
} satisfies Prisma.RepairSelect;

type ListRow = {
  car: { brand: { name: string }; model: string; year: number };
  doneOn: Date;
  id: string;
};

export const toListItem = (row: ListRow): AdminRepairListItemDto => ({
  car: carOf(row.car),
  doneOn: row.doneOn.toISOString().slice(0, 10),
  id: row.id,
});

// The repair as stored, never the driver: the admin reads the account apart.
export const toAdminItem = (row: ClientRepairRow): AdminRepairDto => ({
  car: carOf(row.car),
  correctedBy: row.updatedByRole ? CORRECTED_BY[row.updatedByRole] : null,
  garageName: row.garageName,
  id: row.id,
  version: row.updatedAt.toISOString(),
  ...stored(row),
});
