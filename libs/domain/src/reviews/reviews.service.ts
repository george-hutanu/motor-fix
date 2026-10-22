import {
  type JobReviewContextDto,
  PAID_BANI_MAX,
  type PublishReviewDto,
  REVIEW_TEXT_MAX,
  type ReviewDto,
  type ReviewEligibilityDto,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  LIVE,
  ReviewEligibility,
  refusalOf,
  type Verdict,
} from './eligibility/eligibility';
import { recordReviewPosted } from './reviews.metrics';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import { refusal, taken } from '../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { Job, PrismaClient, Review } from '../generated/prisma/client';
import { garageRef, jobsOf, shortName, snapshotOf } from '../quotes/reads';

const reviewOf = (review: Review): ReviewDto => ({
  id: review.id,
  jobId: review.jobId,
  paidBani: review.paidBani,
  postedAt: review.postedAt.toISOString(),
  rating: review.rating,
  status: review.status,
  text: review.text,
});

const dtoOf = ({ jobId, offer, reason }: Verdict): ReviewEligibilityDto => ({
  jobId,
  offer,
  reason,
});

// A driver reviews their own finished job, once.
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly eligible: ReviewEligibility,
  ) {}

  // Each id once, in the order first asked.
  async eligibility(
    actor: Actor,
    jobIds: string[],
  ): Promise<ReviewEligibilityDto[]> {
    const verdicts = await this.eligible.judge(actor, [...new Set(jobIds)]);
    return verdicts.map(dtoOf);
  }

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
        driver: { select: { email: true, emailVerifiedAt: true, name: true } },
        garage: true,
      },
      where: { driverId: actor.accountId, id: jobId },
    });
    if (!job) throw new NotFoundException();
    const [existing, [verdict]] = await Promise.all([
      this.live(jobId),
      this.eligible.judge(actor, [jobId]),
    ]);
    return {
      author: { shortName: shortName(job.driver.name) },
      car: snapshotOf(job.booking.request),
      eligibility: dtoOf(verdict),
      emailConfirmed: Boolean(job.driver.email && job.driver.emailVerifiedAt),
      existing: existing && reviewOf(existing),
      garage: garageRef(job.garage),
      hasEmail: Boolean(job.driver.email),
      job: { id: job.id, status: job.status },
      jobs: jobsOf(job.booking.quote.jobs.map((one) => one.requestJob)),
    };
  }

  async publish(actor: Actor, dto: PublishReviewDto): Promise<ReviewDto> {
    const job = await this.refuse(actor, dto.jobId);
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
      if (taken(error)) await this.refuse(actor, dto.jobId);
      throw error;
    }
  }

  // Throws the first reason the caller may not review the job, counted.
  private async refuse(actor: Actor, jobId: string) {
    const [verdict] = await this.eligible.judge(actor, [jobId]);
    const { job, reason } = verdict;
    // A verdict with no reason is always of a job found.
    if (reason === null) return job as Job;
    if (reason !== 'not_found') recordReviewPosted(reason);
    throw refusalOf({ ...verdict, reason }, actor.language);
  }

  private live(jobId: string) {
    return this.prisma.review.findFirst({
      where: { jobId, status: { in: [...LIVE] } },
    });
  }
}

// The ranges the DTO leaves out, so the driver reads which field is wrong.
function judge(dto: PublishReviewDto) {
  const errors = [
    ...(dto.rating < 1 || dto.rating > 5
      ? [{ code: 'range', field: 'rating' }]
      : []),
    ...(dto.paidBani != null &&
    (dto.paidBani < 1 || dto.paidBani > PAID_BANI_MAX)
      ? [{ code: 'range', field: 'paidBani' }]
      : []),
    ...(dto.text != null && [...dto.text].length > REVIEW_TEXT_MAX
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
