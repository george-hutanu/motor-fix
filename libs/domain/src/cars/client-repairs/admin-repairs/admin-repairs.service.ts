import type { AdminRepairDto, AdminRepairListDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ADMIN_LIST_SELECT, toAdminItem, toListItem } from './admin-repairs';
import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import type { PrismaClient } from '../../../generated/prisma/client';
import { REPAIR_ORDER } from '../../history/history';
import {
  ADMIN_SCOPE,
  CLIENT_REPAIR_SELECT,
  LIST_LIMIT,
} from '../client-repairs';

// The MotorFix admin's read of a driver's logged repairs.
@Injectable()
export class AdminRepairsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  // The logged repairs on the cars the account owns now, newest first.
  async list(accountId: string): Promise<AdminRepairListDto> {
    const account = await this.prisma.account.findFirst({
      select: { id: true },
      where: { id: accountId, status: { not: 'deleted' } },
    });
    if (!account) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such account');
    }
    const rows = await this.prisma.repair.findMany({
      orderBy: REPAIR_ORDER,
      select: ADMIN_LIST_SELECT,
      take: LIST_LIMIT + 1,
      where: {
        ...ADMIN_SCOPE.where,
        car: { ownerships: { some: { accountId, toDate: null } } },
      },
    });
    return {
      items: rows.slice(0, LIST_LIMIT).map(toListItem),
      truncated: rows.length > LIST_LIMIT,
    };
  }

  // The repair's content, and the open recorded with it: both or neither.
  open(actor: Actor, id: string): Promise<AdminRepairDto> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.repair.findFirst({
        select: CLIENT_REPAIR_SELECT,
        where: { ...ADMIN_SCOPE.where, id },
      });
      if (!row) {
        throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such repair');
      }
      await this.audit.record(tx, {
        action: 'open',
        actorId: actor.accountId,
        actorRole: actor.role,
        carId: row.carId,
        ...(row.sharedWithGarage && row.garageId && { garageId: row.garageId }),
        subjectId: id,
        subjectType: 'repair',
      });
      return toAdminItem(row);
    });
  }
}
