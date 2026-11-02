import {
  DELETED_AUTHOR,
  type EventKind,
  REVIEW_REPORT_REASONS,
} from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import { loadGarageAccess } from '../../events/garage-access';
import type { PrismaClient } from '../../generated/prisma/client';
import { countReviewDecisionAnnounced } from '../../metrics/product-counters';
import { shortName } from '../../quotes/reads';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const REVIEW_DECIDED_QUEUE = 'review-decided';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const REVIEW_DECIDED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const REVIEW_DECIDED_CONSUMER = {
  jobs: REVIEW_DECIDED_RUN,
  kinds: ['review.decided'] as readonly EventKind[],
  queue: REVIEW_DECIDED_QUEUE,
};

// What makes a payload unusable, or null when it names a review and a rule.
const unusablePayload = (
  payload: ReviewDecidedEvent['payload'] | undefined,
) => {
  const reviewId = payload?.reviewId;
  if (typeof reviewId !== 'string' || !isUUID(reviewId)) return 'no review';
  if (!(REVIEW_REPORT_REASONS as readonly unknown[]).includes(payload?.reason))
    return 'no known rule';
  return null;
};

// A job as the relay queues it: `id` is the outbox event's.
export interface ReviewDecidedEvent {
  id: string;
  payload: {
    decision?: string;
    garageId?: string;
    reason?: string;
    reviewId?: string;
    target?: string;
  };
}

// Tells both sides that an admin removed a reported review or reply: its
// author and the garage's active owners, each in their own language, naming
// the rule and never who reported it. The service applies each recipient's
// mute, the no-device fallback and the never-SMS rule; the outbox event id
// keeps a retry or a second relay from building anything twice.
@Injectable()
export class ReviewDecidedFanOut {
  private readonly logger = new Logger('ReviewDecided');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<ReviewDecidedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const reviewId = payload?.reviewId;
    // A payload with no review id, or a rule the templates cannot name, can
    // never succeed: retrying changes nothing, so it ends here as skipped.
    const unusable = unusablePayload(payload);
    if (unusable || typeof reviewId !== 'string') {
      countReviewDecisionAnnounced('skipped');
      this.logger.warn(`event ${eventId} names ${unusable}, nobody told`);
      return;
    }
    const review = await this.prisma.review.findUnique({
      select: {
        driver: { select: { name: true, status: true } },
        driverId: true,
        garage: { select: { name: true } },
        garageId: true,
      },
      where: { id: reviewId },
    });
    if (!review) {
      countReviewDecisionAnnounced('skipped');
      this.logger.log(`review ${reviewId} gone, nobody told`);
      return;
    }
    const target = payload.target === 'reply' ? 'reply' : 'review';
    const params = {
      author:
        review.driver.status === 'deleted'
          ? DELETED_AUTHOR
          : shortName(review.driver.name),
      garage: review.garage.name,
      rule: payload.reason,
    };
    const web = this.config.webUrl;
    // A deleted author is told nothing; a garage with no owner neither.
    const author = review.driver.status === 'deleted' ? [] : [review.driverId];
    const { owners } = await this.access(review.garageId);
    const sides = [
      {
        link: `${web}/app/driver/reviews`,
        recipients: author,
        variant: `${target}_author`,
      },
      {
        garageId: review.garageId,
        link: `${web}/app/garage/reviews`,
        recipients: [...owners],
        variant: `${target}_owner`,
      },
    ].filter((side) => side.recipients.length > 0);
    if (sides.length === 0) {
      countReviewDecisionAnnounced('skipped');
      this.logger.log(`review ${reviewId} decision has nobody to tell`);
      return;
    }
    let queued = 0;
    let again = false;
    for (const { link, recipients, variant, ...side } of sides) {
      again ||= await this.notifications.announced(
        'REVIEW_DECIDED',
        eventId,
        recipients,
      );
      queued += await this.notifications.notify({
        eventId,
        kind: 'REVIEW_DECIDED',
        params: { ...params, link, variant },
        recipients,
        subjectId: reviewId,
        ...side,
      });
    }
    // Nothing queued: everyone muted it, unless the event came again.
    if (queued > 0) countReviewDecisionAnnounced('built');
    else if (!again) countReviewDecisionAnnounced('muted');
    const told = sides.reduce((n, side) => n + side.recipients.length, 0);
    this.logger.log(`review ${reviewId} decision announced to ${told}`);
  }
}
