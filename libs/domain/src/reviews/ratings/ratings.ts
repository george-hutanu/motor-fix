import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { outbox } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { NOTIFICATIONS_PRISMA } from '../../notifications/notifications.service';

export const REVIEW_RATINGS_QUEUE = 'review-ratings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A failed job is tried twice more, 1 and 2 minutes later; each try
// recomputes from the review rows alone.
const REVIEW_RATINGS_RUN: JobsOptions = {
  attempts: 3,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// The kinds that can move a rating; only review.posted is recorded today.
const KINDS: readonly EventKind[] = [
  'review.posted',
  'review.edited',
  'review.deleted',
  'review.reported',
  'review.decided',
  'review.appeal_decided',
];

export const REVIEW_RATINGS_CONSUMER = {
  jobs: REVIEW_RATINGS_RUN,
  kinds: KINDS,
  queue: REVIEW_RATINGS_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface ReviewRatingsEvent {
  id: string;
  kind: string;
  payload?: { reviewId?: unknown } & Record<string, unknown>;
  subjectId?: string;
}

type Outcome = 'written' | 'unchanged' | 'gone';

interface Figures {
  rating: string | null;
  count: number;
}

// The row's figures under the advisory lock, so a second run for the same
// row waits and then reads what the first wrote; null when the row is gone.
async function lock(tx: Prisma.TransactionClient, table: string, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('review_rating'), hashtext(${id}))`;
  return table === 'garage'
    ? tx.$queryRaw<(Figures & { garageId: string })[]>`
        SELECT rating::text AS rating, review_count AS count, id AS "garageId"
        FROM garage WHERE id = ${id}::uuid FOR UPDATE`
    : tx.$queryRaw<(Figures & { garageId: string })[]>`
        SELECT rating::text AS rating, review_count AS count,
          garage_id AS "garageId"
        FROM mechanic WHERE id = ${id}::uuid FOR UPDATE`;
}

// The published reviews' average to one decimal, half away from zero, and
// their count; a profile review names no mechanic and so counts for its
// garage only.
async function count(
  tx: Prisma.TransactionClient,
  table: 'garage' | 'mechanic',
  id: string,
): Promise<Figures> {
  const [figures] =
    table === 'garage'
      ? await tx.$queryRaw<Figures[]>`
          SELECT round(avg(rating), 1)::text AS rating, count(*)::int AS count
          FROM review WHERE garage_id = ${id}::uuid AND status = 'published'`
      : await tx.$queryRaw<Figures[]>`
          SELECT round(avg(rating), 1)::text AS rating, count(*)::int AS count
          FROM review WHERE mechanic_id = ${id}::uuid AND status = 'published'`;
  return figures;
}

// A garage's or a mechanic's rating and review count, written from the
// published reviews whenever a review event may have moved them.
@Injectable()
export class ReviewRatings {
  private readonly logger = new Logger('ReviewRatings');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async onEvent(job: Pick<Job<ReviewRatingsEvent>, 'data'>): Promise<void> {
    const { kind, payload, subjectId } = job.data;
    if (!KINDS.includes(kind as EventKind)) return;
    const reviewId = payload?.reviewId ?? subjectId;
    // An id that is not a UUID names no row either, and a retry cannot change
    // that.
    const review =
      typeof reviewId === 'string' && UUID.test(reviewId)
        ? await this.prisma.review.findUnique({
            select: { garageId: true, mechanicId: true },
            where: { id: reviewId },
          })
        : null;
    if (!review) {
      this.logger.warn(`${kind} ${reviewId}: review gone, nothing written`);
      return;
    }
    const garage = await this.write('garage', review.garageId);
    const mechanic = review.mechanicId
      ? await this.write('mechanic', review.mechanicId)
      : 'none';
    this.logger.log(
      `${kind} ${reviewId}: garage ${garage}, mechanic ${mechanic}`,
    );
  }

  // One row's transaction: its figures written only when they moved, with
  // one rating.updated.
  private write(table: 'garage' | 'mechanic', id: string): Promise<Outcome> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await lock(tx, table, id);
      if (!row) return 'gone';
      const next = await count(tx, table, id);
      if (next.rating === row.rating && next.count === row.count) {
        return 'unchanged';
      }
      if (table === 'garage') {
        await tx.$executeRaw`UPDATE garage SET rating = ${next.rating}::numeric,
          review_count = ${next.count} WHERE id = ${id}::uuid`;
      } else {
        await tx.$executeRaw`UPDATE mechanic SET rating = ${next.rating}::numeric,
          review_count = ${next.count} WHERE id = ${id}::uuid`;
      }
      const mechanicId = table === 'mechanic' ? id : null;
      await outbox.record(tx, {
        audience: { garageId: row.garageId, mechanicId, type: 'rating' },
        kind: 'rating.updated',
        payload: { garageId: row.garageId, mechanicId },
        subjectId: id,
      });
      return 'written';
    });
  }
}
