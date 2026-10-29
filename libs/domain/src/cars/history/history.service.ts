import type {
  CarRepairListDto,
  SoldCarDto,
  SoldCarListDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import {
  fromPreviousOwner,
  type OwnershipRow,
  REPAIR_ORDER,
  repairWhere,
} from './history';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

const day = (at: Date) => at.toISOString().slice(0, 10);
const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such car');

// The repair history an ownership row may read.
@Injectable()
export class CarHistoryService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // The owner's repairs of a car not removed.
  async repairs(actor: Actor, carId: string): Promise<CarRepairListDto> {
    const row = await this.prisma.carOwnership.findFirst({
      where: {
        accountId: actor.accountId,
        car: { ownerId: actor.accountId, removedAt: null },
        carId,
        toDate: null,
      },
    });
    if (!row) throw notFound();
    return this.read(row);
  }

  // Every car the caller sold, newest sale first, removed or not.
  async sold(actor: Actor): Promise<SoldCarListDto> {
    const rows = await this.prisma.carOwnership.findMany({
      include: {
        car: {
          select: {
            brand: { select: { name: true } },
            model: true,
            year: true,
          },
        },
      },
      orderBy: [{ toDate: 'desc' }, { closedAt: 'desc' }],
      where: { access: 'former_owner_read_only', accountId: actor.accountId },
    });
    // A car sold twice by the same person is listed once per sale.
    const items: SoldCarDto[] = rows.map((row) => ({
      brandName: row.car.brand.name,
      id: row.carId,
      model: row.car.model,
      saleDate: day(row.toDate as Date),
      year: row.car.year,
    }));
    return { items };
  }

  // A sold car's repairs, up to the caller's newest sale of it.
  async soldRepairs(actor: Actor, carId: string): Promise<CarRepairListDto> {
    const row = await this.prisma.carOwnership.findFirst({
      orderBy: [{ toDate: 'desc' }, { closedAt: 'desc' }],
      where: {
        access: 'former_owner_read_only',
        accountId: actor.accountId,
        carId,
      },
    });
    if (!row) throw notFound();
    return this.read(row);
  }

  private async read(row: OwnershipRow): Promise<CarRepairListDto> {
    const repairs = await this.prisma.repair.findMany({
      orderBy: REPAIR_ORDER,
      select: {
        createdAt: true,
        doneOn: true,
        garageName: true,
        id: true,
        source: true,
        what: true,
      },
      where: repairWhere(row),
    });
    return {
      items: repairs.map(({ createdAt, doneOn, ...repair }) => ({
        ...repair,
        doneOn: day(doneOn),
        fromPreviousOwner: fromPreviousOwner({ createdAt }, row),
      })),
    };
  }
}
