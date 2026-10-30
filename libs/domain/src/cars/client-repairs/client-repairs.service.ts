import type {
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
  LIST_LIMIT,
  ownerScope,
  type RepairScope,
  stored,
  toItem,
  writerOf,
} from './client-repairs';
import {
  type CorrectionOutcome,
  recordCorrection,
} from './client-repairs.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { REPAIR_ORDER } from '../history/history';

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

  // A merge patch on the version the writer read, within the writer's scope.
  // The row is locked first, so of two saves on one version only one goes
  // through; the version is checked before the values, and a save that
  // changes nothing writes nothing. Answers the row as it now stands.
  async correct(
    actor: Actor,
    scope: RepairScope | null,
    id: string,
    dto: CorrectClientRepairDto,
  ): Promise<ClientRepairRow> {
    const by = writerOf(actor);
    try {
      if (!scope) throw notFound();
      requireCapability(actor, scope.capability);
      const answer = await this.prisma.$transaction(async (tx) => {
        const row = await this.locked(tx, id, scope.where);
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
        if (changed.length === 0) return { outcome: 'unchanged' as const, row };
        const saved = await tx.repair.update({
          data: {
            ...data(after),
            updatedAt: new Date(
              Math.max(Date.now(), row.updatedAt.getTime() + 1),
            ),
            updatedBy: actor.accountId,
            updatedByRole: by,
          },
          select: CLIENT_REPAIR_SELECT,
          where: { id },
        });
        // A garage the driver did not share the repair with is told nothing.
        const sharedGarageId = saved.sharedWithGarage ? saved.garageId : null;
        await this.audit.recordChanges(
          tx,
          {
            actorId: actor.accountId,
            actorRole: actor.role,
            carId: saved.carId,
            ...(sharedGarageId && { garageId: sharedGarageId }),
            subjectId: id,
            subjectType: 'repair',
          },
          { ...before },
          after,
        );
        const ownerId = liveOwner(saved);
        await this.events.record(tx, {
          audience: { ownerAccountId: ownerId, sharedGarageId, type: 'repair' },
          kind: 'repair.updated',
          payload: {
            by,
            carId: saved.carId,
            changed,
            garageId: saved.garageId,
            ownerId,
            repairId: id,
          },
          subjectId: id,
        });
        const writer = by === 'admin' ? 'admin' : `garage ${saved.garageId}`;
        this.logger.log(
          `repair ${id} corrected by ${writer}: ${changed.join(', ')}`,
        );
        return { outcome: 'corrected' as const, row: saved };
      });
      recordCorrection(by, answer.outcome);
      return answer.row;
    } catch (error) {
      // A 400 is read from the status codes; a failure is no outcome.
      const outcome = REFUSED[statusOf(error)];
      if (outcome) recordCorrection(by, outcome);
      throw error;
    }
  }

  // The repair in the writer's scope, locked until the transaction ends.
  private async locked(
    tx: Prisma.TransactionClient,
    id: string,
    where: Prisma.RepairWhereInput,
  ): Promise<ClientRepairRow> {
    await tx.$queryRaw`SELECT id FROM repair WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.repair.findFirst({
      select: CLIENT_REPAIR_SELECT,
      where: { ...where, id },
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
