import { DELETED_AUTHOR, type EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';

import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  countReviewReportAlert,
  countReviewReportReminder,
} from '../../metrics/product-counters';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications/notifications.service';
import { shortName } from '../../quotes/reads';
import { ObjectTimers } from '../../scheduler/timers';

export const MODERATION_TIMERS_QUEUE = 'moderation-timers';
export const MODERATION_TIMERS_JOBS = Symbol('MODERATION_TIMERS_JOBS');
export const MODERATION_TIMERS_URL = Symbol('MODERATION_TIMERS_URL');

const KIND = 'ADMIN_REVIEW_REPORTED';
const REMINDER = 'report-reminder';
// The notification's event id; the job id is `report-reminder-{id}`, as
// BullMQ refuses ':'.
const reminderEvent = (reportId: string) => `${REMINDER}:${reportId}`;

// A failed job is tried 5 more times, 1, 2, 4, 8 and 16 minutes later; the
// sweep sends a reminder whose timer was lost for good.
const MODERATION_TIMERS_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const MODERATION_TIMERS_CONSUMER = {
  jobs: MODERATION_TIMERS_RUN,
  kinds: [
    'review.reported',
    'review.decided',
    'review.deleted',
  ] as readonly EventKind[],
  queue: MODERATION_TIMERS_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface ModerationEvent {
  id: string;
  kind: string;
  payload: { reportId?: string; reviewId?: string } & Record<string, unknown>;
  subjectId?: string;
}

const REPORT_SELECT = {
  dueAt: true,
  id: true,
  reason: true,
  review: {
    select: {
      driver: { select: { name: true, status: true } },
      garage: { select: { name: true } },
      rating: true,
    },
  },
  source: true,
  status: true,
  target: true,
} satisfies Prisma.ReviewReportSelect;

type Report = Prisma.ReviewReportGetPayload<{ select: typeof REPORT_SELECT }>;

// The admins' side of a review report: told when it is made, reminded when
// it has waited 48 hours, and the report closed when its author deletes the
// review. Each step re-reads the report, so a late or repeated job does
// nothing once it is decided or closed. Log lines name ids and steps only.
@Injectable()
export class ModerationTimers {
  private readonly logger = new Logger('ModerationTimers');
  readonly timers: ObjectTimers;
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(MODERATION_TIMERS_JOBS) queue: Queue,
    @Inject(MODERATION_TIMERS_URL) private readonly webUrl: string,
  ) {
    this.timers = new ObjectTimers(queue, [
      {
        fire: (id) => this.remind(id),
        name: REMINDER,
        overdue: (now) => this.overdue(now),
      },
    ]);
  }

  async onEvent(job: Pick<Job<ModerationEvent>, 'data'>): Promise<void> {
    const { id, kind, payload } = job.data;
    if (kind === 'review.reported') return this.reported(id, payload);
    if (kind === 'review.decided') return this.decided(payload);
    if (kind === 'review.deleted') return this.deleted(id, payload);
  }

  private async reported(eventId: string, payload: ModerationEvent['payload']) {
    const report = payload.reportId
      ? await this.prisma.reviewReport.findUnique({
          select: REPORT_SELECT,
          where: { id: payload.reportId },
        })
      : null;
    if (report?.status !== 'pending') {
      countReviewReportAlert('skipped');
      this.logger.log(`report ${payload.reportId} not pending, nobody told`);
      return;
    }
    await this.tell(report, eventId);
    await this.timers.set(REMINDER, report.id, report.dueAt, this.now());
  }

  // Every active admin, in their language; the event id keeps a redelivered
  // event from building anything twice.
  private async tell(report: Report, eventId: string) {
    const admins = await this.admins();
    if (!this.webUrl || admins.length === 0) {
      countReviewReportAlert('skipped');
      this.logger.warn(
        `report ${report.id}: ${this.webUrl ? 'no active admin' : 'PUBLIC_WEB_URL missing'}, nobody told`,
      );
      return;
    }
    const again = await this.notifications.announced(KIND, eventId, admins);
    const queued = await this.notifications.notify({
      eventId,
      kind: KIND,
      params: this.params(report, variantOf(report)),
      recipients: admins,
      subjectId: report.id,
    });
    if (queued > 0) countReviewReportAlert('built');
    else if (!again) countReviewReportAlert('muted');
    this.logger.log(`report ${report.id} told to ${admins.length} admin(s)`);
  }

  private async remind(reportId: string): Promise<void> {
    const report = await this.prisma.reviewReport.findUnique({
      select: REPORT_SELECT,
      where: { id: reportId },
    });
    const admins = await this.admins();
    if (report?.status !== 'pending' || !this.webUrl || !admins.length) {
      countReviewReportReminder('skipped');
      this.logger.log(`report ${reportId} reminder skipped`);
      return;
    }
    const eventId = reminderEvent(report.id);
    if (await this.notifications.announced(KIND, eventId, admins)) return;
    await this.notifications.notify({
      eventId,
      kind: KIND,
      params: this.params(report, 'reminder'),
      recipients: admins,
      subjectId: report.id,
    });
    countReviewReportReminder('sent');
    this.logger.log(`report ${report.id} reminder sent`);
  }

  private async decided(payload: ModerationEvent['payload']) {
    for (const id of await this.reportIds(payload)) {
      await this.timers.clear(REMINDER, id);
    }
  }

  // The author deleted the review: its pending reports close at the
  // event's time, with no decision. A second delivery finds none pending.
  private async deleted(eventId: string, payload: ModerationEvent['payload']) {
    const reviewId = payload.reviewId;
    if (typeof reviewId !== 'string') return;
    const pending = await this.prisma.reviewReport.findMany({
      select: { id: true },
      where: { reviewId, status: 'pending' },
    });
    if (pending.length) {
      const closed = await this.prisma.reviewReport.updateMany({
        data: { decidedAt: await this.eventTime(eventId), status: 'closed' },
        where: { id: { in: pending.map((r) => r.id) }, status: 'pending' },
      });
      this.logger.log(`review ${reviewId}: ${closed.count} report(s) closed`);
    }
    for (const { id } of pending) await this.timers.clear(REMINDER, id);
  }

  // Pending reports past their due time whose reminder no admin holds: what
  // a lost timer missed.
  private async overdue(now: Date): Promise<string[]> {
    const due = await this.prisma.reviewReport.findMany({
      select: { id: true },
      where: { dueAt: { lte: now }, status: 'pending' },
    });
    if (!due.length) return [];
    const held = await this.prisma.notification.findMany({
      distinct: ['eventId'],
      select: { eventId: true },
      where: {
        channel: 'in_app',
        eventId: { in: due.map((r) => reminderEvent(r.id)) },
        kind: KIND,
      },
    });
    const sent = new Set(held.map((n) => n.eventId));
    return due.map((r) => r.id).filter((id) => !sent.has(reminderEvent(id)));
  }

  private async reportIds(payload: ModerationEvent['payload']) {
    if (typeof payload.reportId === 'string') return [payload.reportId];
    if (typeof payload.reviewId !== 'string') return [];
    const reports = await this.prisma.reviewReport.findMany({
      select: { id: true },
      where: { reviewId: payload.reviewId },
    });
    return reports.map((r) => r.id);
  }

  private async eventTime(eventId: string): Promise<Date> {
    const event = /^\d+$/.test(eventId)
      ? await this.prisma.outboxEvent.findUnique({
          select: { createdAt: true },
          where: { id: BigInt(eventId) },
        })
      : null;
    return event?.createdAt ?? this.now();
  }

  private async admins(): Promise<string[]> {
    const admins = await this.prisma.account.findMany({
      select: { id: true },
      where: { roles: { some: { role: 'admin' } }, status: 'active' },
    });
    return admins.map((a) => a.id);
  }

  private params(report: Report, variant: string | undefined) {
    const { driver, garage, rating } = report.review;
    return {
      author:
        driver.status === 'deleted' ? DELETED_AUTHOR : shortName(driver.name),
      garage: garage.name,
      link: `${this.webUrl}/app/admin/reviews`,
      reason: report.reason,
      score: rating,
      ...(variant && { variant }),
    };
  }
}

const variantOf = (report: Pick<Report, 'source' | 'target'>) => {
  if (report.target === 'reply') return 'reply';
  return report.source === 'automatic' ? 'automatic' : undefined;
};
