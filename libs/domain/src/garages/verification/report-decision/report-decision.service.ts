import type { ReportDecisionDto, SuspensionCause } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import {
  countDecisionRefusal,
  countReportDecision,
  type ReportDecisionOutcome,
} from '../../../metrics/product-counters';
import { SuspensionService } from '../suspension/suspension.service';
import { VerificationService } from '../verification.service';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such verification file');

interface Decided {
  garageId: string;
  outcome: ReportDecisionOutcome;
  reports: number;
}

// An admin's verdict on the reports that reopened a garage's file: every
// open report closes with it and the file goes back to approved; a confirmed
// one also suspends the garage. One transaction, behind the file's
// conditional move, so a second decision is refused with the first's name.
@Injectable()
export class ReportDecisionService {
  private readonly logger = new Logger('GarageReports');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly verification: VerificationService,
    private readonly suspension: SuspensionService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async decide(
    actor: Actor,
    fileId: string,
    body: ReportDecisionDto,
  ): Promise<void> {
    requireCapability(actor, 'admin.garages');
    if (!isUUID(fileId)) throw notFound();
    const reason =
      body.decision === 'confirmed' ? (body.reason?.trim() ?? '') : '';
    if (body.decision === 'confirmed' && !reason) {
      countDecisionRefusal('reason_required');
      this.logger.log(`file ${fileId} refused: reason_required`);
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'reason_required',
        'A confirmed report needs the reason the garage will see',
        [{ code: 'required', field: 'reason' }],
      );
    }
    const note =
      body.decision === 'unfounded' ? body.note?.trim() || null : null;
    const done = await this.prisma.$transaction((tx) =>
      this.store(tx, actor, fileId, body.decision, { note, reason }),
    );
    countReportDecision(done.outcome);
    if (done.outcome === 'confirmed')
      this.suspension.committed(done.garageId, 'report_confirmed', actor.role);
    this.logger.log(
      `decided file=${fileId} decision=${body.decision} reports=${done.reports} actor=${actor.role}`,
    );
  }

  private async store(
    tx: Prisma.TransactionClient,
    actor: Actor,
    fileId: string,
    decision: ReportDecisionDto['decision'],
    { note, reason }: { note: string | null; reason: string },
  ): Promise<Decided> {
    // The file's move is the lock: a second decision waits here and is refused.
    const file = await this.verification.approveAfterReports(tx, actor, fileId);
    // Then the garage's row lock, which a new report takes before it joins
    // the file: one sent meanwhile is committed, and listed, before this read.
    const [garage] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM garage
      WHERE id = ${file.garageId}::uuid
      FOR UPDATE`;
    const reports = await tx.garageReport.findMany({
      select: { id: true, reporterId: true },
      where: { status: 'open', verificationFileId: fileId },
    });
    const already =
      decision === 'confirmed'
        ? await this.suspend(tx, actor, file.garageId, garage?.status, reason)
        : null;
    const reportIds = reports.map((r) => r.id);
    const reporterIds = [...new Set(reports.map((r) => r.reporterId))];
    await tx.garageReport.updateMany({
      data: {
        decidedAt: new Date(),
        decidedBy: actor.accountId,
        // The one note column holds the admins' note, or the reason given.
        decisionNote: decision === 'confirmed' ? reason : note,
        status: decision,
      },
      where: { id: { in: reportIds }, status: 'open' },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'reports',
      garageId: file.garageId,
      kind: 'report_decided',
      newValue: {
        decision,
        reportIds,
        ...(note && { note }),
        ...(decision === 'confirmed' && { reason }),
        ...(already && { alreadySuspended: true, cause: already.cause }),
      },
      oldValue: 'open',
      subjectId: fileId,
      subjectType: 'verification_file',
    });
    // Ids only: the note and the reason stay with the admins' own reads.
    await this.events.record(tx, {
      audience: { reporterIds, type: 'garage_report' },
      kind: 'garage_report.decided',
      payload: {
        decision,
        fileId,
        garageId: file.garageId,
        reporterIds,
        reportIds,
      },
      subjectId: fileId,
    });
    return {
      garageId: file.garageId,
      outcome: already ? 'confirmed_already_suspended' : decision,
      reports: reportIds.length,
    };
  }

  // The garage's suspension for the confirmed reports, unless one already
  // stands: then its cause, and nothing of the suspension is written again.
  // The garage's row is already locked, so a suspension racing this one is seen.
  private async suspend(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    status: string | undefined,
    reason: string,
  ): Promise<{ cause: SuspensionCause | null } | null> {
    const open = await this.suspension.openSuspension(tx, garageId);
    if (open) return open;
    if (status === 'suspended') return { cause: null };
    await this.suspension.suspendIn(
      tx,
      actor,
      garageId,
      'report_confirmed',
      reason,
    );
    return null;
  }
}
