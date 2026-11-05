import {
  type CarSnapshotDto,
  type GarageRefDto,
  MY_REVIEWS_EDIT_DAYS,
  MY_REVIEWS_PAGE,
  MY_REVIEWS_WAITING_DAYS,
  type MyReviewRowDto,
  type MyReviewsPageDto,
  type RequestJobDto,
} from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import {
  Prisma,
  type PrismaClient,
  type ReviewReplyStatus,
  type ReviewStatus,
} from '../../generated/prisma/client';
import {
  firstLine,
  garageRef,
  iso,
  jobsOf,
  snapshotOf,
} from '../../quotes/reads';
import { LIVE } from '../eligibility/eligibility';

const DAY_MS = 24 * 60 * 60_000;

// One of the caller's done jobs as the list reads it, before it is a row.
export interface MyReviewSource {
  jobId: string;
  handedOverAt: Date | null;
  garage: GarageRefDto;
  jobs: RequestJobDto[];
  car: CarSnapshotDto;
  review: {
    id: string;
    status: ReviewStatus;
    rating: number;
    text: string | null;
    postedAt: Date;
    editedAt: Date | null;
    reply: {
      text: string;
      postedAt: Date;
      editedAt: Date | null;
      status: ReviewReplyStatus;
    } | null;
  } | null;
  replyReportedByMe: boolean;
}

type Written = NonNullable<MyReviewSource['review']>;

// The garage's reply as the author sees it; a removed one is gone.
function replyOf(
  reply: Written['reply'],
  reportedByMe: boolean,
): MyReviewRowDto['reply'] {
  if (!reply || reply.status === 'removed') return null;
  return {
    editedAt: iso(reply.editedAt),
    postedAt: reply.postedAt.toISOString(),
    reportedByMe,
    status: reply.status,
    text: reply.text,
  };
}

// What a written row adds: the review, its reply and the doors it opens.
function writtenOf(
  review: Written,
  reportedByMe: boolean,
  now: Date,
): Omit<
  MyReviewRowDto,
  'car' | 'date' | 'garage' | 'handedOverAt' | 'jobId' | 'jobs'
> {
  const reply = replyOf(review.reply, reportedByMe);
  const editUntil = now.getTime() - MY_REVIEWS_EDIT_DAYS * DAY_MS;
  return {
    canAppeal: review.status === 'removed',
    canEdit:
      review.status === 'published' && review.postedAt.getTime() >= editUntil,
    canReportReply: reply?.status === 'published' && !reportedByMe,
    canWrite: false,
    editedAt: iso(review.editedAt),
    firstLine: firstLine(review.text),
    postedAt: review.postedAt.toISOString(),
    rating: review.rating,
    reply,
    reviewId: review.id,
    state: review.status as MyReviewRowDto['state'],
  };
}

const WAITING = {
  canAppeal: false,
  canEdit: false,
  canReportReply: false,
  canWrite: true,
  editedAt: null,
  firstLine: null,
  postedAt: null,
  rating: null,
  reply: null,
  reviewId: null,
  state: 'waiting',
} as const;

export function rowOf(source: MyReviewSource, now: Date): MyReviewRowDto {
  const { review } = source;
  return {
    car: source.car,
    date: (source.handedOverAt ?? review?.postedAt ?? now).toISOString(),
    garage: source.garage,
    handedOverAt: iso(source.handedOverAt),
    jobId: source.jobId,
    jobs: source.jobs,
    ...(review ? writtenOf(review, source.replyReportedByMe, now) : WAITING),
  };
}

const JOB_INCLUDE = {
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
  garage: true,
  reviews: {
    include: { reply: true },
    where: { source: 'job', status: { in: [...LIVE] } },
  },
} satisfies Prisma.JobInclude;

// The caller's reviews and the done jobs still waiting for one.
@Injectable()
export class MyReviewsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async read(actor: Actor, page = 1): Promise<MyReviewsPageDto> {
    const now = new Date();
    const rows = this.rows(actor.accountId, now);
    const [counts] = await this.prisma.$queryRaw<
      { written: number; waiting: number }[]
    >`
      SELECT count(*) FILTER (WHERE r.id IS NOT NULL)::int AS written,
             count(*) FILTER (WHERE r.id IS NULL)::int AS waiting
      ${rows}`;
    const total = counts.written + counts.waiting;
    // A page past the last reads nothing, so a huge page never reaches OFFSET.
    const skip = (page - 1) * MY_REVIEWS_PAGE;
    const ids =
      skip < total
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT j.id
            ${rows}
            ORDER BY (r.id IS NULL) DESC,
                     COALESCE(j.handed_over_at, r.posted_at) DESC,
                     j.id ASC
            LIMIT ${MY_REVIEWS_PAGE}
            OFFSET ${skip}`
        : [];
    const items = await this.hydrate(
      actor.accountId,
      ids.map((one) => one.id),
      now,
    );
    return {
      items,
      page,
      pageSize: MY_REVIEWS_PAGE,
      total,
      waiting: counts.waiting,
      written: counts.written,
    };
  }

  // The caller's done jobs with a live review, or handed over within the
  // window with none; a review deleted by its author is no review.
  private rows(accountId: string, now: Date) {
    const since = new Date(now.getTime() - MY_REVIEWS_WAITING_DAYS * DAY_MS);
    return Prisma.sql`
      FROM job j
      LEFT JOIN review r
             ON r.job_id = j.id
            AND r.source = 'job'
            AND r.status::text IN (${Prisma.join([...LIVE])})
      WHERE j.driver_id = ${accountId}::uuid
        AND j.status = 'done'
        AND (r.id IS NOT NULL
             OR (j.handed_over_at IS NOT NULL AND j.handed_over_at >= ${since}))`;
  }

  private async hydrate(accountId: string, ids: string[], now: Date) {
    if (!ids.length) return [];
    const [jobs, reported] = await Promise.all([
      this.prisma.job.findMany({
        include: JOB_INCLUDE,
        where: { id: { in: ids } },
      }),
      this.prisma.reviewReport.findMany({
        select: { reviewId: true },
        where: {
          reporterId: accountId,
          review: { jobId: { in: ids } },
          status: 'pending',
          target: 'reply',
        },
      }),
    ]);
    const mine = new Set(reported.map((one) => one.reviewId));
    const byId = new Map(jobs.map((job) => [job.id, job]));
    // A job deleted between the two reads drops out of the page.
    return ids.flatMap((id) => {
      const job = byId.get(id);
      if (!job) return [];
      const [review = null] = job.reviews;
      return rowOf(
        {
          car: snapshotOf(job.booking.request),
          garage: garageRef(job.garage),
          handedOverAt: job.handedOverAt,
          jobId: job.id,
          jobs: jobsOf(job.booking.quote.jobs.map((one) => one.requestJob)),
          replyReportedByMe: review ? mine.has(review.id) : false,
          review,
        },
        now,
      );
    });
  }
}
