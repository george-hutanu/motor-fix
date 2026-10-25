import { DELETED_AUTHOR, type EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import { loadGarageAccess } from '../../events/garage-access';
import type { PrismaClient } from '../../generated/prisma/client';
import { countReviewAnnounced } from '../../metrics/product-counters';
import { shortName } from '../../quotes/reads';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const REVIEW_POSTED_QUEUE = 'review-posted';

// The states a garage's staff see a review in.
const LISTED: readonly string[] = ['published', 'reported'];

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const REVIEW_POSTED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const REVIEW_POSTED_CONSUMER = {
  jobs: REVIEW_POSTED_RUN,
  kinds: ['review.posted'] as readonly EventKind[],
  queue: REVIEW_POSTED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface ReviewPostedEvent {
  id: string;
  payload: { reviewId: string };
}

// Tells a garage's owners that a driver reviewed the garage. The service
// applies each owner's mute for that garage, the garage's WhatsApp switch,
// the no-device fallback and the never-SMS rule; the outbox event id keeps a
// retry or a second relay from building anything twice.
@Injectable()
export class ReviewPostedFanOut {
  private readonly logger = new Logger('ReviewPosted');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<ReviewPostedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const reviewId = payload?.reviewId;
    // A payload with no review id can never succeed: retrying it changes
    // nothing, so it ends here as a review that is gone.
    if (typeof reviewId !== 'string' || !isUUID(reviewId)) {
      countReviewAnnounced('skipped');
      this.logger.warn(`event ${eventId} names no review, nobody told`);
      return;
    }
    const review = await this.prisma.review.findUnique({
      select: {
        driver: { select: { name: true, status: true } },
        garageId: true,
        job: {
          select: {
            booking: {
              select: {
                request: { select: { carBrand: true, carModel: true } },
              },
            },
          },
        },
        rating: true,
        source: true,
        status: true,
      },
      where: { id: reviewId },
    });
    // Deleted by its author or removed before this ran: the owner would open
    // a list without it.
    if (!review || !LISTED.includes(review.status)) {
      countReviewAnnounced('skipped');
      this.logger.log(`review ${reviewId} gone, nobody told`);
      return;
    }
    const { owners } = await this.access(review.garageId);
    if (owners.size === 0) {
      countReviewAnnounced('skipped');
      this.logger.log(`review ${reviewId} has no owner to tell`);
      return;
    }
    const request = review.job.booking.request;
    const params = {
      author:
        review.driver.status === 'deleted'
          ? DELETED_AUTHOR
          : shortName(review.driver.name),
      ...(review.source === 'job'
        ? { car: `${request.carBrand} ${request.carModel}` }
        : {}),
      link: `${this.config.webUrl}/app/garage/reviews`,
      rating: review.rating,
      source: review.source,
    };
    const recipients = [...owners];
    const again = await this.notifications.announced(
      'REVIEW_POSTED',
      eventId,
      recipients,
    );
    const queued = await this.notifications.notify({
      eventId,
      garageId: review.garageId,
      kind: 'REVIEW_POSTED',
      params,
      recipients,
      subjectId: reviewId,
    });
    // Nothing queued: every owner muted it, unless the event came again.
    if (queued > 0) countReviewAnnounced('built');
    else if (!again) countReviewAnnounced('muted');
    this.logger.log(`review ${reviewId} announced to ${owners.size} owner(s)`);
  }
}
