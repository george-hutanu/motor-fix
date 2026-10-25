import type { ReportReviewDto, ReviewReportDto } from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { reportRefusalOf, textProblemOf } from './report';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, forbidden } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { taken } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { recordReviewReported } from '../reviews.metrics';

const DUE_HOURS = 48;

const MESSAGES = {
  already_kept: {
    en: 'Kept by an admin; it can be reported again only after the author edits it.',
    ro: 'Păstrată de un admin; poate fi raportată din nou doar după ce autorul o editează.',
  },
  already_reported: {
    en: 'This review is already reported.',
    ro: 'Recenzia e deja raportată.',
  },
  forbidden: {
    en: 'Only the owner can report a review.',
    ro: 'Doar proprietarul poate raporta o recenzie.',
  },
};

const STAFF: readonly Actor['role'][] = ['garage', 'receptionist', 'mechanic'];

// A garage's owner reports one of its reviews: the review leaves the profile
// and the figures until an admin decides.
@Injectable()
export class ReviewReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async report(
    actor: Actor,
    reviewId: string,
    dto: ReportReviewDto,
  ): Promise<ReviewReportDto> {
    const review = await this.refuse(actor, reviewId, dto);
    const text = dto.text?.trim() || null;
    const now = new Date();
    try {
      const report = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.review.updateMany({
          data: { status: 'reported' },
          where: { id: review.id, status: 'published' },
        });
        // Another report, or a decision, changed the review since the read.
        if (moved.count === 0) throw new Moved();
        const report = await tx.reviewReport.create({
          data: {
            createdAt: now,
            dueAt: new Date(now.getTime() + DUE_HOURS * 3_600_000),
            reason: dto.reason,
            reporterId: actor.accountId,
            reviewId: review.id,
            source: 'garage',
            text: dto.reason === 'other' ? text : null,
          },
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
        await this.audit.record(tx, {
          ...scope,
          action: 'create',
          newValue: {
            dueAt: report.dueAt,
            reason: report.reason,
            reviewId: report.reviewId,
            source: report.source,
            status: report.status,
            target: report.target,
            text: report.text,
          },
          subjectId: report.id,
          subjectType: 'review_report',
        });
        await this.audit.record(tx, {
          ...scope,
          action: 'update',
          field: 'status',
          newValue: 'reported',
          oldValue: 'published',
          subjectId: review.id,
          subjectType: 'review',
        });
        await this.events.record(tx, {
          audience: {
            authorAccountId: review.driverId,
            garageId: review.garageId,
            mechanicId: review.mechanicId,
            type: 'review',
          },
          kind: 'review.reported',
          payload: {
            driverId: review.driverId,
            garageId: review.garageId,
            jobId: review.jobId,
            mechanicId: review.mechanicId,
            reason: report.reason,
            reportId: report.id,
            reviewId: review.id,
            source: report.source,
            target: report.target,
          },
          subjectId: review.id,
        });
        return report;
      });
      recordReviewReported(dto.reason);
      return {
        dueAt: report.dueAt.toISOString(),
        id: report.id,
        reason: report.reason,
        review: { id: review.id, status: 'reported' },
        status: 'pending',
      };
    } catch (error) {
      // The loser of two reports at once reads the review as the winner left
      // it, and is refused for that.
      if (error instanceof Moved || taken(error)) {
        await this.refuse(actor, reviewId, dto);
      }
      throw error;
    }
  }

  // Throws the first reason the caller may not report the review, counted;
  // else answers the review.
  private async refuse(actor: Actor, reviewId: string, dto: ReportReviewDto) {
    const review =
      actor.garageId && STAFF.includes(actor.role)
        ? await this.prisma.review.findFirst({
            include: {
              job: { select: { carId: true } },
              reports: {
                orderBy: { decidedAt: 'desc' },
                take: 1,
                where: { status: 'decided' },
              },
            },
            where: {
              garageId: actor.garageId,
              id: reviewId,
              status: { in: ['published', 'reported'] },
            },
          })
        : null;
    if (!review) throw new NotFoundException();
    const language = actor.language === 'en' ? 'en' : 'ro';
    if (actor.role !== 'garage') {
      recordReviewReported('forbidden');
      throw forbidden(MESSAGES.forbidden[language]);
    }
    const refused = reportRefusalOf(review, review.reports[0] ?? null);
    if (refused) {
      recordReviewReported(refused);
      throw refusal(HttpStatus.CONFLICT, refused, MESSAGES[refused][language]);
    }
    const problem = textProblemOf(dto.reason, dto.text);
    if (problem) {
      recordReviewReported('validation_failed');
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation_failed',
        'The report’s text does not fit its reason',
        [{ code: problem, field: 'text' }],
      );
    }
    return review;
  }
}

class Moved extends Error {}
