import type {
  ClientRepairDto,
  ClientRepairListDto,
  CorrectClientRepairDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  CLIENT_REPAIR_SELECT,
  type ClientRepairRow,
  type Corrected,
  changes,
  ownerScope,
  stored,
  toItem,
} from './client-repairs';
import {
  type CorrectionOutcome,
  recordCorrection,
} from './client-repairs.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { REPAIR_ORDER } from '../history/history';

const LIST_LIMIT = 200;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such repair');

// The column each field is written to; the day is a date.
const data = (after: Partial<Corrected>) => ({
  ...after,
  ...(after.doneOn !== undefined && {
    doneOn: new Date(`${after.doneOn}T00:00:00Z`),
  }),
});

@Injectable()
export class ClientRepairsService {
  private readonly logger = new Logger('ClientRepairs');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // The shared logged repairs naming the owner's approved garage, newest
  // first; a garage not approved has none to read.
  async list(actor: Actor): Promise<ClientRepairListDto> {
    requireCapability(actor, 'garage.client_repairs');
    const garageId = await this.approvedGarage(actor);
    const rows = await this.prisma.repair.findMany({
      orderBy: REPAIR_ORDER,
      select: CLIENT_REPAIR_SELECT,
      take: LIST_LIMIT + 1,
      where: ownerScope(garageId),
    });
    return {
      items: rows.slice(0, LIST_LIMIT).map(toItem),
      truncated: rows.length > LIST_LIMIT,
    };
  }

  // A merge patch on the version the owner read. The row is locked first, so
  // of two saves on one version only one goes through; the version is
  // checked before the values, and a save that changes nothing writes nothing.
  async correct(
    actor: Actor,
    id: string,
    dto: CorrectClientRepairDto,
  ): Promise<ClientRepairDto> {
    requireCapability(actor, 'garage.client_repairs');
    try {
      const answer = await this.prisma.$transaction(async (tx) => {
        const row = await this.locked(tx, id, actor.garageId);
        if (row.updatedAt.getTime() !== new Date(dto.version).getTime()) {
          throw refusal(
            HttpStatus.CONFLICT,
            'stale_version',
            'The repair was changed since this version',
          );
        }
        const before = stored(row);
        const after = changes(before, dto);
        const changed = Object.keys(after);
        if (changed.length === 0)
          return { item: toItem(row), outcome: 'unchanged' as const };
        if (after.doneOn !== undefined && after.doneOn > localDay(new Date())) {
          throw refusal(
            HttpStatus.BAD_REQUEST,
            'validation_failed',
            'doneOn must not be after today',
            [{ code: 'after_today', field: 'doneOn' }],
          );
        }
        const saved = await tx.repair.update({
          data: {
            ...data(after),
            updatedAt: new Date(
              Math.max(Date.now(), row.updatedAt.getTime() + 1),
            ),
            updatedBy: actor.accountId,
            updatedByRole: 'owner',
          },
          select: { ...CLIENT_REPAIR_SELECT, carId: true, garageId: true },
          where: { id },
        });
        const garageId = saved.garageId as string;
        await this.audit.recordChanges(
          tx,
          {
            actorId: actor.accountId,
            actorRole: actor.role,
            carId: saved.carId,
            garageId,
            subjectId: id,
            subjectType: 'repair',
          },
          { ...before },
          after,
        );
        const ownerId = liveOwner(saved);
        await this.events.record(tx, {
          audience: {
            ownerAccountId: ownerId,
            sharedGarageId: garageId,
            type: 'repair',
          },
          kind: 'repair.updated',
          payload: {
            by: 'owner',
            carId: saved.carId,
            changed,
            garageId,
            ownerId,
            repairId: id,
          },
          subjectId: id,
        });
        this.logger.log(
          `repair ${id} corrected by garage ${garageId}: ${changed.join(', ')}`,
        );
        return { item: toItem(saved), outcome: 'corrected' as const };
      });
      recordCorrection('owner', answer.outcome);
      return answer.item;
    } catch (error) {
      // A 400 is read from the status codes; a failure is no outcome.
      const outcome = REFUSED[statusOf(error)];
      if (outcome) recordCorrection('owner', outcome);
      throw error;
    }
  }

  // The repair in the owner's scope, locked until the transaction ends.
  private async locked(
    tx: Prisma.TransactionClient,
    id: string,
    garageId: string | null,
  ): Promise<ClientRepairRow> {
    if (!garageId) throw notFound();
    await tx.$queryRaw`SELECT id FROM repair WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.repair.findFirst({
      select: CLIENT_REPAIR_SELECT,
      where: { id, ...ownerScope(garageId) },
    });
    if (!row) throw notFound();
    return row;
  }

  private async approvedGarage(actor: Actor): Promise<string> {
    const garage = actor.garageId
      ? await this.prisma.garage.findFirst({
          select: { id: true },
          where: { id: actor.garageId, status: 'approved' },
        })
      : null;
    if (!garage) throw notFound();
    return garage.id;
  }
}

// The car's current owner, unless the account is deleted.
function liveOwner(row: ClientRepairRow): string | null {
  const open = row.car.ownerships[0];
  return open && open.account.status !== 'deleted' ? open.accountId : null;
}

const REFUSED: Partial<Record<number, CorrectionOutcome>> = {
  [HttpStatus.CONFLICT]: 'stale',
  [HttpStatus.NOT_FOUND]: 'not_found',
};

const statusOf = (error: unknown) =>
  error instanceof HttpException ? error.getStatus() : 0;
