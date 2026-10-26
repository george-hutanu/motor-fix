import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import type { PrismaClient } from '../../generated/prisma/client';
import { countReviewReplyAnnounced } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const REVIEW_REPLIED_QUEUE = 'review-replied';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const REVIEW_REPLIED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
// An edit (review.reply_edited) tells nobody.
export const REVIEW_REPLIED_CONSUMER = {
  jobs: REVIEW_REPLIED_RUN,
  kinds: ['review.replied'] as readonly EventKind[],
  queue: REVIEW_REPLIED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface ReviewRepliedEvent {
  id: string;
  payload: {
    authorId: string;
    garageId: string;
    replyId: string;
    reviewId: string;
  };
}

// Tells a review's author that the garage replied to it. The service applies
// the author's mute, the no-device fallback and the never-SMS rule; the
// outbox event id keeps a retry or a second relay from building anything
// twice.
@Injectable()
export class ReviewRepliedFanOut {
  private readonly logger = new Logger('ReviewReplied');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<ReviewRepliedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const replyId = payload?.replyId;
    // A payload with no reply id can never succeed: retrying it changes
    // nothing, so it ends here as a reply that is gone.
    if (typeof replyId !== 'string' || !isUUID(replyId)) {
      countReviewReplyAnnounced('skipped');
      this.logger.warn(`event ${eventId} names no reply, nobody told`);
      return;
    }
    const reply = await this.prisma.reviewReply.findUnique({
      select: {
        garage: { select: { name: true } },
        review: {
          select: {
            driver: { select: { status: true } },
            driverId: true,
            id: true,
            status: true,
          },
        },
        status: true,
      },
      where: { id: replyId },
    });
    const review = reply?.review;
    // Reported, removed, its review gone or its author deleted before this
    // ran: the author would open a list without it.
    if (
      !reply ||
      !review ||
      reply.status !== 'published' ||
      review.status !== 'published' ||
      review.driver.status === 'deleted'
    ) {
      countReviewReplyAnnounced('skipped');
      this.logger.log(`reply ${replyId} gone, nobody told`);
      return;
    }
    const recipients = [review.driverId];
    const again = await this.notifications.announced(
      'REVIEW_REPLIED',
      eventId,
      recipients,
    );
    const queued = await this.notifications.notify({
      eventId,
      kind: 'REVIEW_REPLIED',
      params: {
        garage: reply.garage.name,
        link: `${this.config.webUrl}/app/driver/reviews`,
      },
      recipients,
      subjectId: review.id,
    });
    // Nothing queued: the author muted it, unless the event came again.
    if (queued > 0) countReviewReplyAnnounced('built');
    else if (!again) countReviewReplyAnnounced('muted');
    this.logger.log(`review ${review.id} reply announced to its author`);
  }
}
