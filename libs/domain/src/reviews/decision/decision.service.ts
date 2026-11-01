import type {
  ReviewDecisionDto,
  ReviewDecisionResultDto,
  ReviewRemovalReason,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { refusalOf } from './decision';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { notFound, refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { shortName } from '../../quotes/reads';
import { recordReviewDecided } from '../reviews.metrics';

const MESSAGES = {
  already_decided: {
    en: (by: string) => `This report was already decided by ${by}.`,
    ro: (by: string) => `Raportul a fost deja decis de ${by}.`,
  },
  already_decided_unnamed: {
    en: 'This report was already decided.',
    ro: 'Raportul a fost deja decis.',
  },
  no_pending_report: {
    en: 'This review has no report waiting for a decision.',
    ro: 'Recenzia nu are niciun raport care așteaptă o decizie.',
  },
};

// An admin decides a review's one pending report by removing: the
// review (with the garage's reply) or, for a report of the reply, the reply
// alone. Everything is written in one transaction with its audit entries and
// its review.decided event, or nothing is.
@Injectable()
export class ReviewDecisionsService {
  private readonly logger = new Logger('ReviewDecisions');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async decide(
    actor: Actor,
    reviewId: string,
    dto: ReviewDecisionDto,
  ): Promise<ReviewDecisionResultDto> {
    const now = new Date();
    try {
      const result = await this.prisma.$transaction((tx) =>
        this.write(tx, { actor, now, reason: dto.reason, reviewId }),
      );
      recordReviewDecided('removed', result.target, dto.reason);
      this.logger.log(
        `review ${reviewId} report ${result.reportId} decided: ${result.target} removed for ${dto.reason}`,
      );
      return {
        decidedAt: now.toISOString(),
        decision: 'removed',
        reviewId,
        ...result,
      };
    } catch (error) {
      if (!(error instanceof Moved)) throw error;
      throw await this.refused(actor, reviewId);
    }
  }

  private async write(tx: Tx, decision: Decision) {
    const { actor, now, reason, reviewId } = decision;
    // The guard against two admins at once: only one moves the pending
    // report; the other finds none and is told why after.
    const [report] = await tx.reviewReport.updateManyAndReturn({
      data: {
        decidedAt: now,
        decidedById: actor.accountId,
        decision: 'removed',
        status: 'decided',
      },
      where: { reviewId, status: 'pending' },
    });
    if (!report) throw new Moved();
    const review = await tx.review.findUniqueOrThrow({
      include: { job: { select: { carId: true } }, reply: true },
      where: { id: reviewId },
    });
    const scope = {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId: review.garageId,
      ...(review.source === 'job' && {
        carId: review.job.carId,
        jobId: review.jobId,
      }),
    };
    if (report.target === 'review') {
      await this.removeReview(tx, decision, review, scope);
    }
    const reply =
      review.reply?.status === 'removed' ? null : (review.reply ?? null);
    if (reply) {
      await this.removeReply(tx, decision, reply, report.target, scope);
    }
    await this.audit.record(tx, {
      ...scope,
      action: 'update',
      field: 'status',
      newValue: { decision: 'removed', reason, status: 'decided' },
      oldValue: 'pending',
      subjectId: report.id,
      subjectType: 'review_report',
    });
    const replyId = reply?.id ?? null;
    await this.events.record(tx, {
      audience: {
        authorAccountId: review.driverId,
        garageId: review.garageId,
        mechanicId: review.mechanicId,
        type: 'review',
      },
      kind: 'review.decided',
      payload: {
        decision: 'removed',
        driverId: review.driverId,
        garageId: review.garageId,
        mechanicId: review.mechanicId,
        reason,
        replyId,
        reportId: report.id,
        reviewId: review.id,
        target: report.target,
      },
      subjectId: review.id,
    });
    return { replyId, reportId: report.id, target: report.target };
  }

  // The review leaves the profile and the figures; its text and rating stay.
  private async removeReview(
    tx: Tx,
    { actor, now, reason }: Decision,
    review: { id: string; status: string; text: string | null },
    scope: Scope,
  ) {
    await tx.review.update({
      data: {
        removalReason: reason,
        removedAt: now,
        removedById: actor.accountId,
        status: 'removed',
      },
      where: { id: review.id },
    });
    await this.audit.record(tx, {
      ...scope,
      action: 'update',
      field: 'status',
      newValue: { reason, status: 'removed', text: review.text },
      oldValue: review.status,
      subjectId: review.id,
      subjectType: 'review',
    });
  }

  // The reply goes with its review, or alone when it was the one reported.
  private async removeReply(
    tx: Tx,
    { now, reason }: Decision,
    reply: { id: string; status: string; text: string },
    target: 'review' | 'reply',
    scope: Scope,
  ) {
    const cause = target === 'review' ? 'review_removed' : 'report_upheld';
    await tx.reviewReply.update({
      data: { removedAt: now, removedCause: cause, status: 'removed' },
      where: { id: reply.id },
    });
    await this.audit.record(tx, {
      ...scope,
      action: 'update',
      field: 'status',
      newValue:
        target === 'review'
          ? { cause, status: 'removed' }
          : { reason, status: 'removed', text: reply.text },
      oldValue: reply.status,
      subjectId: reply.id,
      subjectType: 'review_reply',
    });
  }

  // Why nothing was decided, read after the guarded write moved nothing.
  private async refused(actor: Actor, reviewId: string) {
    const review = await this.prisma.review.findUnique({
      select: {
        reports: {
          select: {
            createdAt: true,
            decidedBy: { select: { name: true } },
            id: true,
            status: true,
          },
        },
      },
      where: { id: reviewId },
    });
    const refused = refusalOf(review?.reports ?? null);
    if (refused.code === 'not_found') return notFound();
    recordReviewDecided(refused.code);
    const language = actor.language === 'en' ? 'en' : 'ro';
    if (refused.code === 'no_pending_report') {
      return refusal(
        HttpStatus.CONFLICT,
        refused.code,
        MESSAGES.no_pending_report[language],
      );
    }
    const name = refused.report.decidedBy?.name;
    const decidedBy = name ? shortName(name) : undefined;
    return new HttpException(
      {
        code: refused.code,
        message: decidedBy
          ? MESSAGES.already_decided[language](decidedBy)
          : MESSAGES.already_decided_unnamed[language],
        ...(decidedBy && { decidedBy }),
      },
      HttpStatus.CONFLICT,
    );
  }
}

type Tx = Prisma.TransactionClient;

interface Decision {
  actor: Actor;
  now: Date;
  reason: ReviewRemovalReason;
  reviewId: string;
}

type Scope = {
  actorId: string;
  actorRole: Actor['role'];
  garageId: string;
  carId?: string;
  jobId?: string;
};

class Moved extends Error {}
