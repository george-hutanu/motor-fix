import {
  DOCUMENT_KINDS,
  type DocumentDecisionDto,
  type DocumentKind,
  type DocumentRefusalDto,
  type SuspensionCause,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { addMonths, localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { countDocumentCycle } from '../../../metrics/product-counters';
import {
  DocumentCycleService,
  dayOf,
} from '../document-cycle/document-cycle.service';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such document');
const notInReview = () =>
  refusal(
    HttpStatus.CONFLICT,
    'document_not_in_review',
    'The document no longer waits for an admin',
  );

interface Reviewed {
  id: string;
  kind: DocumentKind;
  garageId: string;
}

// An admin's decision on one yearly document. Each runs under the garage's
// cycle lock, as the worker's compliance step does, so a decision and a
// step on the same garage never interleave.
@Injectable()
export class DocumentReviewService {
  private readonly logger = new Logger('DocumentReview');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly cycles: DocumentCycleService,
  ) {}

  // The document becomes its kind's valid one; once both kinds hold one
  // accepted since the cycle was last reset, the cycle starts again a year
  // from today.
  async accept(actor: Actor, id: string): Promise<DocumentDecisionDto> {
    const answer = await this.decide(id, async (tx, document, now) => {
      await tx.legalDocument.updateMany({
        data: { replacedAt: now },
        where: {
          id: { not: document.id },
          kind: document.kind,
          replacedAt: null,
          status: 'valid',
          verificationFile: { garageId: document.garageId },
        },
      });
      await tx.legalDocument.update({
        data: { decidedAt: now, decidedBy: actor.accountId, status: 'valid' },
        where: { id: document.id },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId: document.garageId,
        kind: document.kind,
        newValue: 'valid',
        oldValue: 'in_review',
        subjectId: document.id,
        subjectType: 'legal_document',
      });
      const dueOn = await this.resetIfComplete(tx, actor, document, now);
      await this.events.record(tx, {
        audience: { garageId: document.garageId, type: 'verification' },
        kind: 'document.accepted',
        payload: {
          documentId: document.id,
          dueOn,
          garageId: document.garageId,
          kind: document.kind,
        },
        subjectId: document.id,
      });
      return 'valid' as const;
    });
    countDocumentCycle('accepted');
    this.log(actor, answer, 'accepted');
    return answer;
  }

  // The document is refused with its reason and note; the kind's valid
  // document and the cycle stay as they were.
  async refuse(
    actor: Actor,
    id: string,
    { note, reason }: DocumentRefusalDto,
  ): Promise<DocumentDecisionDto> {
    const answer = await this.decide(id, async (tx, document, now) => {
      await tx.legalDocument.update({
        data: {
          decidedAt: now,
          decidedBy: actor.accountId,
          refusalNote: note,
          refusalReason: reason,
          status: 'refused',
        },
        where: { id: document.id },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId: document.garageId,
        kind: document.kind,
        newValue: { note, reason, status: 'refused' },
        oldValue: 'in_review',
        subjectId: document.id,
        subjectType: 'legal_document',
      });
      await this.events.record(tx, {
        audience: { garageId: document.garageId, type: 'verification' },
        kind: 'document.refused',
        payload: {
          documentId: document.id,
          garageId: document.garageId,
          kind: document.kind,
          reason,
        },
        subjectId: document.id,
      });
      return 'refused' as const;
    });
    countDocumentCycle('refused');
    this.log(actor, answer, 'refused');
    return answer;
  }

  // Finds the document, locks its garage's cycle, checks it still waits,
  // applies the decision and answers with the cycle as it now stands.
  private async decide(
    id: string,
    apply: (
      tx: Prisma.TransactionClient,
      document: Reviewed,
      now: Date,
    ) => Promise<'valid' | 'refused'>,
  ): Promise<DocumentDecisionDto> {
    if (!isUUID(id)) throw notFound();
    const found = await this.prisma.legalDocument.findUnique({
      select: { kind: true, verificationFile: { select: { garageId: true } } },
      where: { id },
    });
    if (!found) throw notFound();
    const garageId = found.verificationFile.garageId;
    const document = { garageId, id, kind: found.kind as DocumentKind };
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM garage_document_cycle WHERE garage_id = ${garageId}::uuid FOR UPDATE`;
      const { status } = await tx.legalDocument.findUniqueOrThrow({
        select: { status: true },
        where: { id },
      });
      if (status !== 'in_review') throw notInReview();
      const now = new Date();
      const decided = await apply(tx, document, now);
      const [cycle, suspension] = await Promise.all([
        this.cycles.documentCycleOf(garageId, tx, localDay(now)),
        tx.garageSuspension.findFirst({
          orderBy: { fromTime: 'desc' },
          select: { cause: true },
          where: { garageId, untilTime: null },
        }),
      ]);
      return {
        cycle,
        document: {
          decidedAt: now.toISOString(),
          id,
          kind: document.kind,
          status: decided,
        },
        suspendedFor: (suspension?.cause as SuspensionCause) ?? null,
      };
    });
  }

  // With both kinds' current documents accepted since the last reset, the
  // cycle is due a year from today, its grace and marks cleared. Answers the
  // due date as it now stands.
  private async resetIfComplete(
    tx: Prisma.TransactionClient,
    actor: Actor,
    document: Reviewed,
    now: Date,
  ): Promise<string | null> {
    const cycle = await tx.documentCycle.findUnique({
      where: { garageId: document.garageId },
    });
    if (!cycle) return null;
    const accepted = await tx.legalDocument.findMany({
      distinct: ['kind'],
      select: { kind: true },
      where: {
        decidedAt: { gte: cycle.resetAt },
        replacedAt: null,
        status: 'valid',
        verificationFile: { garageId: document.garageId },
      },
    });
    const before = dayOf(cycle.dueOn);
    if (
      !DOCUMENT_KINDS.every((kind) => accepted.some((a) => a.kind === kind))
    ) {
      return before;
    }
    const dueOn = addMonths(localDay(now), 12);
    await tx.documentCycle.update({
      data: {
        dueOn: new Date(dueOn),
        graceUntil: null,
        reminded0At: null,
        reminded7At: null,
        reminded30At: null,
        resetAt: now,
        state: 'due',
      },
      where: { id: cycle.id },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'documents_due_on',
      garageId: document.garageId,
      newValue: dueOn,
      oldValue: before,
      subjectId: document.garageId,
      subjectType: 'garage',
    });
    return dueOn;
  }

  private log(
    actor: Actor,
    { document }: DocumentDecisionDto,
    outcome: 'accepted' | 'refused',
  ) {
    this.logger.log(
      `document ${document.id} (${document.kind}) ${outcome} by ${actor.role}`,
    );
  }
}
