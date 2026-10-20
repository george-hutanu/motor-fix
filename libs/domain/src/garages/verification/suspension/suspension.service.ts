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

interface Suspension {
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
        this.suspendIn(tx, actor, garageId, cause, reason),
      );
      this.committed(garageId, cause, actor.role);
      return suspension;
    } catch (error) {
      throw await this.refused(error, garageId, cause, actor.role);
    }
  }

  // What a failed transaction that ran suspendIn() throws: a refusal is
  // recorded apart and answered as its 409; any other error goes on as it is.
  async refused(
    error: unknown,
    garageId: string,
    cause: SuspensionCause,
    role: VerificationActor['role'],
  ): Promise<unknown> {
    if (!(error instanceof Refused)) return error;
    // The attempt is history even though nothing else changed; a history
    // write that fails is logged, and the caller still learns the refusal.
    await this.prisma
      .$transaction((tx) => this.audit.record(tx, error.attempt))
      .catch((auditError: unknown) =>
        this.logger.error(
          `refusal not audited garage=${garageId} code=${ALREADY}: ${String(auditError)}`,
        ),
      );
    this.logger.log(
      `refused garage=${garageId} cause=${cause} actor=${role} code=${ALREADY}`,
    );
    return error.refusal;
  }

  // A suspension that committed, counted and logged once: suspend()'s own,
  // or one a caller made with suspendIn() in its transaction.
  committed(
    garageId: string,
    cause: SuspensionCause,
    role: VerificationActor['role'],
  ) {
    countGarageSuspension(cause);
    this.logger.log(
      `suspended garage=${garageId} cause=${cause} actor=${role}`,
    );
  }

  // The garage's open suspension, if any: one with no end.
  async openSuspension(
    tx: Prisma.TransactionClient,
    garageId: string,
  ): Promise<{ cause: SuspensionCause } | null> {
    return tx.garageSuspension.findFirst({
      select: { cause: true },
      where: { garageId, untilTime: null },
    });
  }

  // The suspension inside the caller's transaction, which counts and logs
  // it once that commits.
  async suspendIn(
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
    // Its waiting quotes now read as withdrawn: each driver's comparison is
    // told, since garage.suspended never reaches a driver's channel.
    const waiting = await tx.quote.findMany({
      select: {
        id: true,
        request: { select: { driverId: true } },
        requestId: true,
      },
      where: { garageId, status: 'waiting' },
    });
    for (const quote of waiting) {
      await this.events.record(tx, {
        audience: {
          driverAccountId: quote.request.driverId,
          garageId,
          type: 'quote',
        },
        kind: 'quote.withdrawn',
        payload: {
          quoteId: quote.id,
          reason: 'suspended',
          requestId: quote.requestId,
        },
        subjectId: quote.id,
      });
    }
    return {
      cause: row.cause,
      fromTime: row.fromTime,
      garageId,
      id: row.id,
      reason: row.reason,
    };
  }
}
