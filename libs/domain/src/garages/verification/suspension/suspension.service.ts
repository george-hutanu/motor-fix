import type {
  GarageRestoredDto,
  RestoreGarageDto,
  SuspensionCause,
} from '@motor-fix/contracts';
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
import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import {
  countGarageRestore,
  countGarageSuspension,
  countRecheck,
} from '../../../metrics/product-counters';
import { shortName } from '../../../quotes/reads';
import {
  checkedOnRule,
  invalid,
  type Language,
  type Locked,
  languageOf,
  recordOk,
} from '../recheck/recheck-ok';
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

const conflict = (code: string, message: string) =>
  refusal(HttpStatus.CONFLICT, code, message);

const RESTORE_SAID = {
  documents: {
    en: 'The yearly documents are not all valid',
    ro: 'Documentele anuale nu sunt toate valabile',
  },
  notExpected: {
    en: 'A re-check is recorded only for a garage suspended after a failed re-check',
    ro: 'O reverificare se înregistrează doar pentru un service suspendat după o reverificare eșuată',
  },
  noteRequired: {
    en: 'Write what the garage fixed',
    ro: 'Scrie ce a rezolvat service‑ul',
  },
  notSuspended: {
    en: 'The garage is not suspended',
    ro: 'Service‑ul nu este suspendat',
  },
  recheckMissing: {
    en: 'A valid RAR re-check is missing',
    ro: 'Lipsește o reverificare RAR valabilă',
  },
} satisfies Record<string, Record<Language, string>>;

// "Deja repus pe hartă de Ana P.": a short name already ends the sentence.
const alreadyRestored = (language: Language, name: string) => {
  const who = name.endsWith('.') ? name : `${name}.`;
  return language === 'en'
    ? `Already put back on the map by ${who}`
    : `Deja repus pe hartă de ${who}`;
};

// The proof a restore records in its history entry, and the garage's date
// of last check after it.
interface Evidence {
  recorded: Record<string, unknown>;
  lastCheckedOn: string | null;
}

// What the restore wrote, read back once it committed.
interface Lifted {
  answer: GarageRestoredDto;
  inlineRecheck: boolean;
}

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

  // Puts a suspended garage back on the map once its cause's evidence holds:
  // a valid re-check for a failed one, valid yearly documents for overdue
  // ones, the admin's note for the rest. One transaction behind the row lock.
  async restore(
    actor: Actor,
    garageId: string,
    body: RestoreGarageDto,
  ): Promise<GarageRestoredDto> {
    requireCapability(actor, 'admin.garages');
    if (!isUUID(garageId)) throw notFound();
    const lifted = await this.prisma.$transaction((tx) =>
      this.restoreIn(tx, actor, garageId, body),
    );
    const { cause } = lifted.answer;
    countGarageRestore(cause);
    if (lifted.inlineRecheck) countRecheck('ok');
    this.logger.log(
      `restored garage=${garageId} cause=${cause} actor=${actor.role} inlineRecheck=${lifted.inlineRecheck}`,
    );
    return lifted.answer;
  }

  private async restoreIn(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    body: RestoreGarageDto,
  ): Promise<Lifted> {
    const [garage] = await tx.$queryRaw<Locked[]>`
      SELECT status::text AS status,
        (SELECT language::text FROM account WHERE id = ${actor.accountId}::uuid) AS language,
        to_char(last_checked_on, 'YYYY-MM-DD') AS "lastCheckedOn",
        rar_activities AS activities
      FROM garage WHERE id = ${garageId}::uuid
      FOR UPDATE`;
    if (!garage) throw notFound();
    const language = languageOf(garage.language);
    const latest = await tx.garageSuspension.findFirst({
      orderBy: [{ fromTime: 'desc' }, { createdAt: 'desc' }],
      where: { garageId },
    });
    if (garage.status === 'approved' && latest?.liftedBy) {
      const lifter = await tx.account.findUnique({
        select: { name: true },
        where: { id: latest.liftedBy },
      });
      throw conflict(
        'garage_already_restored',
        alreadyRestored(language, shortName(lifter?.name ?? '')),
      );
    }
    if (garage.status !== 'suspended' || !latest || latest.untilTime) {
      throw conflict(
        'garage_not_suspended',
        RESTORE_SAID.notSuspended[language],
      );
    }

    const note = body.note?.trim() || null;
    const evidence = await this.evidence(
      tx,
      actor,
      garageId,
      garage,
      latest,
      body,
      language,
    );
    const untilTime = new Date();
    await tx.garageSuspension.update({
      data: { liftedBy: actor.accountId, liftNote: note, untilTime },
      where: { id: latest.id },
    });
    await tx.garage.update({
      data: { status: 'approved' },
      where: { id: garageId },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'status',
      garageId,
      kind: 'garage_restored',
      newValue: {
        cause: latest.cause,
        evidence: evidence.recorded,
        note,
        status: 'approved',
      },
      oldValue: 'suspended',
      subjectId: garageId,
      subjectType: 'garage',
      ...(note !== null && { text: note }),
    });
    await this.events.record(tx, {
      audience: { garageId, published: true, type: 'verification' },
      kind: 'garage.restored',
      payload: { cause: latest.cause, garageId },
      subjectId: garageId,
    });
    const lifter = await tx.account.findUnique({
      select: { name: true },
      where: { id: actor.accountId },
    });
    return {
      answer: {
        cause: latest.cause,
        fromTime: latest.fromTime.toISOString(),
        garageId,
        id: latest.id,
        lastCheckedOn: evidence.lastCheckedOn,
        liftedBy: { name: shortName(lifter?.name ?? '') },
        note,
        untilTime: untilTime.toISOString(),
      },
      inlineRecheck: body.recheck !== undefined,
    };
  }

  // The proof the open suspension's cause asks for, refused when missing;
  // an inline re-check is recorded here, inside the restore's transaction.
  private async evidence(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    garage: Locked,
    open: { cause: SuspensionCause; fromTime: Date },
    body: RestoreGarageDto,
    language: Language,
  ): Promise<Evidence> {
    if (body.recheck && open.cause !== 'recheck_failed') {
      throw invalid(
        'recheck_not_expected',
        'recheck',
        RESTORE_SAID.notExpected[language],
      );
    }
    switch (open.cause) {
      case 'recheck_failed':
        return this.recheckEvidence(
          tx,
          actor,
          garageId,
          garage,
          open,
          body,
          language,
        );
      case 'documents_overdue': {
        const cycle = await tx.documentCycle.findUnique({
          select: { state: true },
          where: { garageId },
        });
        if (cycle?.state !== 'due') {
          throw conflict(
            'documents_not_valid',
            RESTORE_SAID.documents[language],
          );
        }
        return {
          lastCheckedOn: garage.lastCheckedOn,
          recorded: { documents: 'due' },
        };
      }
      default:
        if (!body.note?.trim()) {
          throw new HttpException(
            {
              code: 'validation_failed',
              field: 'note',
              message: RESTORE_SAID.noteRequired[language],
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          lastCheckedOn: garage.lastCheckedOn,
          recorded: { note: true },
        };
    }
  }

  // A failed re-check is lifted by a valid one: sent with the restore, or
  // already recorded since the suspension began.
  private async recheckEvidence(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    garage: Locked,
    open: { fromTime: Date },
    body: RestoreGarageDto,
    language: Language,
  ): Promise<Evidence> {
    if (body.recheck) {
      const today = localDay(new Date());
      checkedOnRule(
        body.recheck.checkedOn,
        garage.lastCheckedOn,
        today,
        language,
      );
      const recorded = await recordOk(
        tx,
        { audit: this.audit, events: this.events },
        actor,
        garageId,
        garage,
        body.recheck,
        language,
      );
      return {
        lastCheckedOn: recorded.lastCheckedOn,
        recorded: { checkedOn: recorded.checkedOn, recheckId: recorded.id },
      };
    }
    const since = await tx.recheck.findFirst({
      orderBy: { recordedAt: 'desc' },
      select: { id: true },
      where: {
        garageId,
        recordedAt: { gte: open.fromTime },
        result: 'ok',
      },
    });
    if (!since) {
      throw conflict('recheck_missing', RESTORE_SAID.recheckMissing[language]);
    }
    return {
      lastCheckedOn: garage.lastCheckedOn,
      recorded: { recheckId: since.id },
    };
  }
}
