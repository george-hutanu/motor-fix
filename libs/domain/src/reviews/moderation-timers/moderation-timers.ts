import { DELETED_AUTHOR, type EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { outbox } from '../../events/event.port';
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

// An id the database can look up; anything else in a payload is ignored.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (value: unknown) =>
  typeof value === 'string' && UUID.test(value) ? value : null;
// An outbox row's id: a bigint; 18 digits always fit one.
const OUTBOX_ID = /^\d{1,18}$/;

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
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
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
    const reportId = uuidOf(payload.reportId);
    const report = reportId
      ? await this.prisma.reviewReport.findUnique({
          select: REPORT_SELECT,
          where: { id: reportId },
        })
      : null;
    if (report?.status !== 'pending') {
      countReviewReportAlert('skipped');
      this.logger.log(`report ${reportId} not pending, nobody told`);
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
      params: this.params(
        report,
        report.target === 'reply' ? 'reminder_reply' : 'reminder',
      ),
      recipients: admins,
      subjectId: report.id,
    });
    countReviewReportReminder('sent');
    this.logger.log(`report ${report.id} reminder sent`);
  }

  // A decision names the report it decided; one that names none clears
  // nothing.
  private async decided(payload: ModerationEvent['payload']) {
    const reportId = uuidOf(payload.reportId);
    if (reportId) await this.timers.clear(REMINDER, reportId);
  }

  // The author deleted the review: its pending reports close at the
  // event's time, with no decision, each with its audit entry and an event
  // for the admins' queue in the same transaction. A second delivery finds
  // none pending.
  private async deleted(eventId: string, payload: ModerationEvent['payload']) {
    const reviewId = uuidOf(payload.reviewId);
    if (!reviewId) return;
    const decidedAt = await this.eventTime(eventId);
    const closed = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.reviewReport.findMany({
        select: { id: true, review: { select: { garageId: true } } },
        where: { reviewId, status: 'pending' },
      });
      const done: string[] = [];
      for (const report of pending) {
        const moved = await tx.reviewReport.updateMany({
          data: { decidedAt, status: 'closed' },
          where: { id: report.id, status: 'pending' },
        });
        if (moved.count === 0) continue;
        await this.audit.record(tx, {
          action: 'update',
          actorId: null,
          actorRole: 'system',
          field: 'status',
          garageId: report.review.garageId,
          newValue: 'closed',
          oldValue: 'pending',
          subjectId: report.id,
          subjectType: 'review_report',
        });
        await outbox.record(tx, {
          audience: { adminOnly: true, type: 'platform' },
          kind: 'review.report_closed',
          payload: { reportId: report.id, reviewId },
          subjectId: report.id,
        });
        done.push(report.id);
      }
      return done;
    });
    if (closed.length) {
      this.logger.log(`review ${reviewId}: ${closed.length} report(s) closed`);
    }
    for (const id of closed) await this.timers.clear(REMINDER, id);
  }

  // Pending reports past their due time whose reminder no admin holds: what
  // a lost timer missed. None while nobody could be reminded, so the sweep
  // does not skip the same report again every round.
  private async overdue(now: Date): Promise<string[]> {
    if (!this.webUrl || (await this.admins()).length === 0) return [];
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

  private async eventTime(eventId: string): Promise<Date> {
    const event = OUTBOX_ID.test(eventId)
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
