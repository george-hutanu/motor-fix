import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';

import { outbox } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications/notifications.service';
import { ObjectTimers, type TimerKind } from '../../scheduler/timers';
import {
  type DeclineWindowOutcome,
  recordDeclineWindow,
} from '../quotes/quotes.metrics';
import { DECLINE_UNDO_MINUTES } from '../quotes-config';

export const DECLINE_WINDOW_QUEUE = 'quote-timers';
export const DECLINE_WINDOW_JOBS = Symbol('DECLINE_WINDOW_JOBS');
export const DECLINE_WINDOW_URL = Symbol('DECLINE_WINDOW_URL');
const KIND = 'decline-window';
const WINDOW_MS = DECLINE_UNDO_MINUTES * 60_000;

// A failed job is tried 5 more times, 1, 2, 4, 8 and 16 minutes later; the
// sweep runs a window whose timer was lost for good.
const DECLINE_WINDOW_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const DECLINE_WINDOW_CONSUMER = {
  jobs: DECLINE_WINDOW_RUN,
  kinds: ['request.declined'] as readonly EventKind[],
  queue: DECLINE_WINDOW_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface DeclinedEvent {
  id: string;
  payload: { recipientId: string; windowClosed?: boolean };
}

// The driver hears of a decline only once its undo window has passed: the
// decline's event sets a timer at declined_at plus the window, and the timer
// (or the sweep, for a lost one) tells the driver once, by the recipient's
// state at that moment. decline_told_at keeps it to once per decline.
@Injectable()
export class DeclineWindow implements TimerKind {
  readonly name = KIND;
  private readonly logger = new Logger('DeclineWindow');
  readonly timers: ObjectTimers;
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(DECLINE_WINDOW_JOBS) queue: Queue,
    @Inject(DECLINE_WINDOW_URL) private readonly webUrl: string,
  ) {
    this.timers = new ObjectTimers(queue, [this]);
  }

  async onDeclined(job: Pick<Job<DeclinedEvent>, 'data'>): Promise<void> {
    const { payload } = job.data;
    // The driver's own event, recorded when a window closes.
    if (payload.windowClosed) return;
    const recipient = await this.prisma.requestRecipient.findUnique({
      select: { declinedAt: true, status: true },
      where: { id: payload.recipientId },
    });
    if (recipient?.status !== 'declined' || !recipient.declinedAt) return;
    const at = new Date(recipient.declinedAt.getTime() + WINDOW_MS);
    await this.timers.set(KIND, payload.recipientId, at, this.now());
  }

  async overdue(now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM request_recipient
      WHERE status = 'declined' AND decline_told_at IS NULL
        AND declined_at <= ${new Date(now.getTime() - WINDOW_MS)}
      ORDER BY declined_at, id`;
    return rows.map((row) => row.id);
  }

  async fire(id: string, sweep: boolean): Promise<void> {
    const outcome = await this.close(id);
    if (outcome) recordDeclineWindow(outcome, sweep);
    this.logger.log(
      `decline window of recipient ${id}: ${outcome ?? 'not yet'}`,
    );
  }

  private async close(id: string): Promise<DeclineWindowOutcome | null> {
    const recipient = await this.prisma.requestRecipient.findUnique({
      include: {
        garage: { select: { name: true } },
        request: { select: { driverId: true, status: true } },
      },
      where: { id },
    });
    if (recipient?.status !== 'declined' || !recipient.declinedAt) {
      return 'skipped_undone';
    }
    if (recipient.declineToldAt) return 'already_told';
    const declinedAt = recipient.declinedAt;
    // A decline made again after an undo waits for its own window.
    if (declinedAt.getTime() + WINDOW_MS > this.now().getTime()) return null;
    if (!['sent', 'quoted'].includes(recipient.request.status)) {
      await this.stamp(id, declinedAt);
      return 'skipped_closed';
    }
    const { driverId } = recipient.request;
    const queued = await this.notifications.notify({
      // One message per decline, however often the window is closed.
      eventId: `decline-${id}-${declinedAt.getTime()}`,
      kind: 'REQUEST_DECLINED',
      params: {
        garage: recipient.garage.name,
        link: `${this.webUrl}/app/driver/requests/${recipient.requestId}`,
        reason: recipient.declineReason,
      },
      recipients: [driverId],
      subjectId: id,
    });
    const stamped = await this.stamp(id, declinedAt, {
      driverId,
      garageId: recipient.garageId,
      reason: recipient.declineReason,
      recipientId: id,
      requestId: recipient.requestId,
      windowClosed: true,
    });
    if (!stamped) return 'already_told';
    // Nothing queued: the driver muted every outside channel.
    return queued > 0 ? 'sent' : 'muted';
  }

  // Marks the decline told, under the row's lock, unless it moved since it
  // was read; with a payload, also records the driver's event. Answers
  // whether this call marked it.
  private stamp(
    id: string,
    declinedAt: Date,
    payload?: Record<string, unknown> & { driverId: string },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM request_recipient
        WHERE id = ${id}::uuid AND status = 'declined'
          AND declined_at = ${declinedAt} AND decline_told_at IS NULL
        FOR UPDATE`;
      if (!row) return false;
      await tx.requestRecipient.update({
        data: { declineToldAt: this.now() },
        where: { id },
      });
      if (payload) {
        await outbox.record(tx, {
          audience: { accountId: payload.driverId, type: 'account' },
          kind: 'request.declined',
          payload,
          subjectId: id,
        });
      }
      return true;
    });
  }
}
