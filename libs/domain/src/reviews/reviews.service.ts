import {
  type JobReviewContextDto,
  PAID_BANI_MAX,
  type PublishReviewDto,
  REVIEW_TEXT_MAX,
  type ReviewDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { recordReviewPosted } from './reviews.metrics';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import { refusal, taken } from '../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { PrismaClient, Review } from '../generated/prisma/client';
import { garageRef, jobsOf, snapshotOf } from '../quotes/reads';

// The statuses that hold a job's one review; the migration's review_one_live
// index lists the same three.
const LIVE = ['published', 'reported', 'removed'] as const;

const reviewOf = (review: Review): ReviewDto => ({
  id: review.id,
  jobId: review.jobId,
  paidBani: review.paidBani,
  postedAt: review.postedAt.toISOString(),
  rating: review.rating,
  status: review.status,
  text: review.text,
});

const conflict = (
  code: string,
  message: string,
  extra?: { entity: string; currentStatus: string },
) => new HttpException({ code, message, ...extra }, HttpStatus.CONFLICT);

// A driver reviews their own finished job, once.
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async read(actor: Actor, jobId: string): Promise<JobReviewContextDto> {
    const job = await this.prisma.job.findFirst({
      include: {
        booking: {
          include: {
            quote: {
              include: {
                jobs: {
                  include: { requestJob: { include: { jobType: true } } },
                  orderBy: { requestJob: { position: 'asc' } },
                  where: { included: true },
                },
              },
            },
            request: true,
          },
        },
        driver: { select: { email: true, emailVerifiedAt: true } },
        garage: true,
      },
      where: { driverId: actor.accountId, id: jobId },
    });
    if (!job) throw new NotFoundException();
    const existing = await this.live(jobId);
    return {
      car: snapshotOf(job.booking.request),
      emailConfirmed: Boolean(job.driver.email && job.driver.emailVerifiedAt),
      existing: existing && reviewOf(existing),
      garage: garageRef(job.garage),
      job: { id: job.id, status: job.status },
      jobs: jobsOf(job.booking.quote.jobs.map((one) => one.requestJob)),
    };
  }

  async publish(actor: Actor, dto: PublishReviewDto): Promise<ReviewDto> {
    const en = actor.language === 'en';
    const job = await this.prisma.job.findFirst({
      include: { driver: { select: { email: true, emailVerifiedAt: true } } },
      where: { driverId: actor.accountId, id: dto.jobId },
    });
    if (!job) throw new NotFoundException();
    refuseJob(job, en);
    await this.refuseExisting(dto.jobId, en);
    judge(dto);
    try {
      const review = await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.create({
          data: {
            driverId: job.driverId,
            garageId: job.garageId,
            jobId: job.id,
            paidBani: dto.paidBani ?? null,
            rating: dto.rating,
            text: dto.text ?? null,
          },
        });
        await this.audit.record(tx, {
          action: 'create',
          actorId: actor.accountId,
          actorRole: 'driver',
          carId: job.carId,
          garageId: job.garageId,
          jobId: job.id,
          subjectId: review.id,
          subjectType: 'review',
        });
        await this.events.record(tx, {
          audience: {
            authorAccountId: job.driverId,
            garageId: job.garageId,
            mechanicId: null,
            type: 'review',
          },
          kind: 'review.posted',
          payload: {
            driverId: job.driverId,
            garageId: job.garageId,
            jobId: job.id,
            rating: review.rating,
            reviewId: review.id,
          },
          subjectId: review.id,
        });
        return review;
      });
      recordReviewPosted('published');
      return reviewOf(review);
    } catch (error) {
      // Another post for the job committed between the check and the insert.
      if (taken(error)) await this.refuseExisting(dto.jobId, en);
      throw error;
    }
  }

  private live(jobId: string) {
    return this.prisma.review.findFirst({
      where: { jobId, status: { in: [...LIVE] } },
    });
  }

  private async refuseExisting(jobId: string, en: boolean) {
    const existing = await this.live(jobId);
    if (!existing) return;
    recordReviewPosted('review_exists');
    throw conflict(
      'review_exists',
      en ? 'This job already has your review' : 'Lucrarea are deja recenzia ta',
      { currentStatus: existing.status, entity: 'review' },
    );
  }
}

type JobForReview = {
  status: string;
  driver: { email: string | null; emailVerifiedAt: Date | null };
};

// A job is reviewed once it is done, by an account whose e-mail is confirmed.
function refuseJob(job: JobForReview, en: boolean) {
  if (job.status !== 'done') {
    recordReviewPosted('job_not_done');
    throw conflict(
      'job_not_done',
      en
        ? 'A job is reviewed once it is done'
        : 'O lucrare se evaluează după ce e gata',
      { currentStatus: job.status, entity: 'job' },
    );
  }
  if (!job.driver.email || !job.driver.emailVerifiedAt) {
    recordReviewPosted('email_not_confirmed');
    throw conflict(
      'email_not_confirmed',
      en
        ? 'Confirm your e-mail address to publish a review'
        : 'Confirmă-ți adresa de e-mail ca să publici recenzia',
    );
  }
}

// The ranges the DTO leaves out, so the driver reads which field is wrong.
function judge(dto: PublishReviewDto) {
  const errors = [
    ...(dto.rating < 1 || dto.rating > 5
      ? [{ code: 'range', field: 'rating' }]
      : []),
    ...(dto.paidBani !== undefined &&
    (dto.paidBani < 1 || dto.paidBani > PAID_BANI_MAX)
      ? [{ code: 'range', field: 'paidBani' }]
      : []),
    ...(dto.text !== undefined && [...dto.text].length > REVIEW_TEXT_MAX
      ? [{ code: 'length', field: 'text' }]
      : []),
  ];
  if (errors.length) {
    throw refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'validation_failed',
      'The review has fields out of range',
      errors,
    );
  }
}
