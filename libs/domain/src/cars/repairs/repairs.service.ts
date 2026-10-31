import type { RepairListDto, RepairsQueryDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { recordEditRefusal } from './repairs.metrics';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  REPAIR_ORDER,
  REPAIR_ROW_SELECT,
  repairWhere,
  toRow,
} from '../history/history';

const PAGE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The driver's repairs across every car he owns, and the refusals of the
// edits a later release brings.
@Injectable()
export class RepairsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(actor: Actor, query: RepairsQueryDto): Promise<RepairListDto> {
    const rows = await this.openRows(actor, query.carId);
    if (query.carId && rows.length === 0) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such car');
    }
    // No rows: an empty OR matches nothing.
    const where = { OR: rows.map(repairWhere) };
    if (query.cursor !== undefined) await this.checkCursor(where, query.cursor);
    const size = query.limit ?? PAGE;
    const repairs = await this.prisma.repair.findMany({
      orderBy: REPAIR_ORDER,
      select: REPAIR_ROW_SELECT,
      take: size + 1,
      where,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = repairs.slice(0, size);
    const rowOf = new Map(rows.map((row) => [row.carId, row]));
    const language = actor.language ?? 'ro';
    return {
      // Every repair matched one of these rows, so none is dropped.
      items: page.flatMap((repair) => {
        const row = rowOf.get(repair.car.id);
        return row ? [toRow(repair, row, language)] : [];
      }),
      nextCursor: repairs.length > size ? (page.at(-1)?.id ?? null) : null,
    };
  }

  // The cursor must be a row of this very list, or the skip would drop a
  // real repair instead of it.
  private async checkCursor(where: Prisma.RepairWhereInput, cursor: string) {
    const row =
      UUID.test(cursor) &&
      (await this.prisma.repair.findFirst({
        select: { id: true },
        where: { ...where, id: cursor },
      }));
    if (!row) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'invalid_cursor',
        'cursor is not a repair of this list',
      );
    }
  }

  // Neither an edit nor a delete is open to the driver yet: a MotorFix repair
  // belongs to the job, a logged one waits for the editing release.
  async refuse(actor: Actor, id: string): Promise<never> {
    const rows = await this.openRows(actor);
    const repair = await this.prisma.repair.findFirst({
      select: { source: true },
      where: { id, OR: rows.map(repairWhere) },
    });
    if (!repair) {
      throw refusal(
        HttpStatus.NOT_FOUND,
        'not_found',
        'Nu există această reparație',
      );
    }
    if (repair.source === 'motorfix') {
      recordEditRefusal('motorfix_repair');
      throw refusal(
        HttpStatus.CONFLICT,
        'motorfix_repair',
        'Reparația vine dintr-o lucrare MotorFix',
      );
    }
    recordEditRefusal('not_implemented');
    throw refusal(
      HttpStatus.NOT_IMPLEMENTED,
      'not_implemented',
      'Editarea reparațiilor adăugate vine cu o versiune următoare',
    );
  }

  // The caller's open ownership rows, one per car he owns and has not removed.
  private openRows(actor: Actor, carId?: string) {
    return this.prisma.carOwnership.findMany({
      where: {
        accountId: actor.accountId,
        car: { ownerId: actor.accountId, removedAt: null },
        toDate: null,
        ...(carId && { carId }),
      },
    });
  }
}
