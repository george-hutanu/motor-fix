import type { SuspensionCause } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../../audit/audit.port';
import { requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { countGarageSuspension } from '../../../metrics/product-counters';
import type { VerificationActor } from '../verification.service';

export type { SuspensionCause };

export interface Suspension {
  id: string;
  garageId: string;
  cause: SuspensionCause;
  reason: string;
  fromTime: Date;
}

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

const ALREADY = 'garage_already_suspended';

// A failed transaction that still owes the history its refused attempt.
class Refused extends Error {
  constructor(
    readonly refusal: HttpException,
    readonly attempt: AuditEntry,
  ) {
    super(ALREADY);
  }
}

// Takes an approved garage off the map: the suspension, the status, its
// history entry and the event the public reads and the worker follow, in
// one transaction behind the garage's row lock.
@Injectable()
export class SuspensionService {
  private readonly logger = new Logger('GarageSuspension');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async suspend(
    actor: VerificationActor,
    garageId: string,
    cause: SuspensionCause,
    reason: string,
  ): Promise<Suspension> {
    if (actor.role !== 'system') requireCapability(actor, 'admin.garages');
    if (!isUUID(garageId)) throw notFound();
    try {
      const suspension = await this.prisma.$transaction((tx) =>
        this.store(tx, actor, garageId, cause, reason),
      );
      countGarageSuspension(cause);
      this.logger.log(
        `suspended garage=${garageId} cause=${cause} actor=${actor.role}`,
      );
      return suspension;
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      // The attempt is history even though nothing else changed.
      await this.prisma.$transaction((tx) =>
        this.audit.record(tx, error.attempt),
      );
      this.logger.log(
        `refused garage=${garageId} cause=${cause} actor=${actor.role} code=${ALREADY}`,
      );
      throw error.refusal;
    }
  }

  private async store(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    garageId: string,
    cause: SuspensionCause,
    reason: string,
  ): Promise<Suspension> {
    const [garage] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM garage
      WHERE id = ${garageId}::uuid
      FOR UPDATE`;
    if (!garage) throw notFound();
    const entry = {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'status',
      garageId,
      subjectId: garageId,
      subjectType: 'garage',
      text: `${cause}: ${reason}`,
    } as const;
    if (garage.status === 'suspended') {
      throw new Refused(
        refusal(HttpStatus.CONFLICT, ALREADY, 'Deja suspendat'),
        {
          ...entry,
          kind: 'garage_suspension_refused',
          newValue: 'suspended',
          oldValue: 'suspended',
        },
      );
    }
    if (garage.status !== 'approved') {
      throw refusal(
        HttpStatus.CONFLICT,
        'garage_not_approved',
        'Only an approved garage can be suspended',
      );
    }

    const row = await tx.garageSuspension.create({
      data: {
        cause,
        fromTime: new Date(),
        garageId,
        reason,
        suspendedBy: actor.accountId,
      },
    });
    await tx.garage.update({
      data: { status: 'suspended' },
      where: { id: garageId },
    });
    await this.audit.record(tx, {
      ...entry,
      kind: 'garage_suspended',
      newValue: 'suspended',
      oldValue: 'approved',
    });
    await this.events.record(tx, {
      audience: { garageId, published: true, type: 'verification' },
      kind: 'garage.suspended',
      payload: { cause, garageId },
      subjectId: garageId,
    });
    return {
      cause: row.cause,
      fromTime: row.fromTime,
      garageId,
      id: row.id,
      reason: row.reason,
    };
  }
}
