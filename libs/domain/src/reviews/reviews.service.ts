import {
  DELETED_AUTHOR,
  type GarageReviewDto,
  type GarageReviewsPageDto,
  type GarageStaffReviewsPageDto,
  type JobReviewContextDto,
  MECHANIC_REVIEWS_PAGE,
  type MechanicReviewsPageDto,
  PAID_BANI_MAX,
  type PublishReviewDto,
  REVIEW_TEXT_MAX,
  type ReviewDto,
  type ReviewEligibilityDto,
  type ReviewStatus,
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
import { refusal } from '../auth/http-refusal';
import { type Actor, assertGarage, requireCapability } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import { taken } from '../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import { publicGarages } from '../garages/public-garages/public-garages';
import type {
  Job,
  Prisma,
  PrismaClient,
  Review,
} from '../generated/prisma/client';
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

// A deleted account's name is gone; its reviews stay under a stand-in.
const authorOf = (driver: { name: string; status: string }) =>
  driver.status === 'deleted'
    ? { shortName: DELETED_AUTHOR }
    : { shortName: shortName(driver.name) };

// What a page of a garage's reviews reads of each: the author, the car and
// the jobs the garage did, and the mechanic.
const PAGE_INCLUDE = {
  driver: { select: { name: true, status: true } },
  job: {
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
    },
  },
  mechanic: { select: { name: true } },
} satisfies Prisma.ReviewInclude;

type PageReview = Prisma.ReviewGetPayload<{ include: typeof PAGE_INCLUDE }>;

// A review as the garage's profile shows it: a profile review has no car or jobs.
const garageRowOf = (review: PageReview): GarageReviewDto => {
  const { booking } = review.job;
  const fromJob = review.source === 'job';
  return {
    author: authorOf(review.driver),
    car: fromJob ? snapshotOf(booking.request) : null,
    id: review.id,
    jobs: fromJob
      ? jobsOf(booking.quote.jobs.map((one) => one.requestJob))
      : [],
    postedAt: review.postedAt.toISOString(),
    rating: review.rating,
    source: review.source,
    text: review.text,
  };
};

// The garage's stored rating and count, as its profile shows them.
const figuresOf = (garage: {
  rating: Prisma.Decimal | null;
  reviewCount: number;
}) => ({
  rating: garage.rating === null ? null : Number(garage.rating),
  reviewCount: garage.reviewCount,
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

  // A mechanic's published reviews at every garage, newest first. A mechanic
  // off the profile or whose account was deleted is as unknown as no
  // mechanic at all.
  async mechanicReviews(
    mechanicId: string,
    page = 1,
  ): Promise<MechanicReviewsPageDto> {
    const mechanic = await this.prisma.mechanic.findFirst({
      select: { id: true },
      where: {
        id: mechanicId,
        OR: [{ accountId: null }, { account: { status: { not: 'deleted' } } }],
        onProfile: true,
      },
    });
    if (!mechanic) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such mechanic');
    }
    const where = { mechanicId, status: 'published' as const };
    const total = await this.prisma.review.count({ where });
    const skip = (page - 1) * MECHANIC_REVIEWS_PAGE;
    // A page past the last reads nothing, however large its number.
    const reviews =
      skip < total
        ? await this.prisma.review.findMany({
            include: {
              driver: { select: { name: true, status: true } },
              garage: true,
            },
            orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
            skip,
            take: MECHANIC_REVIEWS_PAGE,
            where,
          })
        : [];
    return {
      items: reviews.map((review) => ({
        author: authorOf(review.driver),
        garage: garageRef(review.garage),
        id: review.id,
        postedAt: review.postedAt.toISOString(),
        rating: review.rating,
        text: review.text,
      })),
      page,
      pageSize: MECHANIC_REVIEWS_PAGE,
      total,
    };
  }

  // A garage's published reviews, 20 a page, with its stored rating and count
  // and how many published reviews gave each score; the scores sum to total.
  async garageReviews(
    garageId: string,
    page = 1,
  ): Promise<GarageReviewsPageDto> {
    const garage = await this.prisma.garage.findFirst({
      select: { rating: true, reviewCount: true },
      where: { id: garageId, ...publicGarages() },
    });
    if (!garage) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
    }
    const { breakdown, reviews, total } = await this.reviewPage(
      garageId,
      page,
      ['published'],
    );
    return {
      breakdown,
      items: reviews.map(garageRowOf),
      page,
      pageSize: MECHANIC_REVIEWS_PAGE,
      ...figuresOf(garage),
      total,
    };
  }

  // The garage's own reviews as its staff read them: the published and the
  // reported ones, newest first, each with where it stands and the mechanic;
  // the figures are the profile's. Only the owner may reply or report.
  async staffReviews(
    actor: Actor,
    garageId: string,
    page = 1,
  ): Promise<GarageStaffReviewsPageDto> {
    assertGarage(actor, garageId);
    requireCapability(actor, 'garage.reviews');
    const garage = await this.prisma.garage.findUnique({
      select: { rating: true, reviewCount: true, slug: true },
      where: { id: garageId },
    });
    if (!garage) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
    }
    const { breakdown, reviews, total } = await this.reviewPage(
      garageId,
      page,
      ['published', 'reported'],
    );
    const owner = actor.role === 'garage';
    return {
      breakdown,
      items: reviews.map((review) => ({
        ...garageRowOf(review),
        canReply: owner,
        canReport: owner,
        mechanic:
          review.source === 'job' && review.mechanic
            ? { shortName: shortName(review.mechanic.name) }
            : null,
        status: review.status,
      })),
      page,
      pageSize: MECHANIC_REVIEWS_PAGE,
      ...figuresOf(garage),
      slug: garage.slug,
      total,
    };
  }

  // One page of a garage's reviews in the given states, newest first, with how
  // many published reviews gave each score and how many reviews the states
  // hold in all.
  private async reviewPage<S extends ReviewStatus>(
    garageId: string,
    page: number,
    statuses: readonly S[],
  ) {
    const scores = await this.prisma.review.groupBy({
      _count: { _all: true },
      by: ['rating', 'status'],
      where: { garageId, status: { in: [...statuses] } },
    });
    const scored = (rating: number) =>
      scores.find((one) => one.rating === rating && one.status === 'published')
        ?._count._all ?? 0;
    const breakdown = {
      five: scored(5),
      four: scored(4),
      one: scored(1),
      three: scored(3),
      two: scored(2),
    };
    const total = scores.reduce((sum, one) => sum + one._count._all, 0);
    const skip = (page - 1) * MECHANIC_REVIEWS_PAGE;
    // A page past the last reads nothing, however large its number.
    const reviews =
      skip < total
        ? await this.prisma.review.findMany({
            include: PAGE_INCLUDE,
            orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
            skip,
            take: MECHANIC_REVIEWS_PAGE,
            where: { garageId, status: { in: [...statuses] } },
          })
        : [];
    // The filter above holds every row to the states asked for.
    return {
      breakdown,
      reviews: reviews as (PageReview & { status: S })[],
      total,
    };
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
            // The job's mechanic as it stands at posting; a finished job's
            // mechanic no longer changes.
            mechanicId: job.mechanicId,
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
            mechanicId: job.mechanicId,
            type: 'review',
          },
          kind: 'review.posted',
          payload: {
            driverId: job.driverId,
            garageId: job.garageId,
            jobId: job.id,
            mechanicId: job.mechanicId,
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
