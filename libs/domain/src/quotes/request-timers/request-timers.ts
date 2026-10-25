import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { addLocalDays } from '../../bucharest';
import { noEvents, outbox } from '../../events/event.port';
import { loadGarageAccess } from '../../events/garage-access';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications/notifications.service';
import { ObjectTimers } from '../../scheduler/timers';
import type { TransitionActor } from '../../transitions';
import {
  type RequestTimerStep,
  recordRequestTimer,
} from '../quotes/quotes.metrics';
import { REQUEST_REMINDER_DAYS } from '../quotes-config';
import { shortName } from '../reads';
import { moveQuote, moveRecipient, moveRequest } from '../transitions';

export const REQUEST_TIMERS_QUEUE = 'request-timers';
export const REQUEST_TIMERS_JOBS = Symbol('REQUEST_TIMERS_JOBS');
export const REQUEST_TIMERS_URL = Symbol('REQUEST_TIMERS_URL');

const EXPIRY = 'request-expiry';
const QUOTE_EXPIRY = 'quote-expiry';
const reminder = (day: number) => `request-reminder-${day}`;
// The column that records each reminder day was sent, so it goes once.
const REMINDED: Record<number, string> = {
  2: 'reminded_day2_at',
  5: 'reminded_day5_at',
};

// A failed job is tried 5 more times, 1, 2, 4, 8 and 16 minutes later; the
// sweep runs a timer that was lost for good.
const REQUEST_TIMERS_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const REQUEST_TIMERS_CONSUMER = {
  jobs: REQUEST_TIMERS_RUN,
  kinds: [
    'request.created',
    'quote.sent',
    'quote.accepted',
    'request.cancelled',
    'quote.withdrawn',
    'quote.declined_by_driver',
    'request.expired',
    'quote.expired',
    'quote.closed',
  ] as readonly EventKind[],
  queue: REQUEST_TIMERS_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface RequestTimerEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  subjectId?: string;
}

const SYSTEM: TransitionActor = { accountId: null, role: 'system' };

type Tx = Prisma.TransactionClient;

interface Expiring {
  id: string;
  driverId: string;
}

interface ExpiringQuote {
  id: string;
  driverId: string;
  garageId: string;
  requestId: string;
  requestStatus: string;
}

interface Reminding {
  id: string;
  garageId: string;
}

interface Closed {
  garageIds: string[];
  closed: boolean;
}

// A sent request's timers, its reminders on day 2 and day 5 and its expiry
// at the end of the seventh day, and each waiting quote's expiry seven days
// after it was sent. Each
// re-reads its object under a lock, so a late, early or repeated timer and
// the sweep do nothing once the state or the time no longer fits.
@Injectable()
export class RequestTimers {
  private readonly logger = new Logger('RequestTimers');
  private readonly access: ReturnType<typeof loadGarageAccess>;
  readonly timers: ObjectTimers;
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(REQUEST_TIMERS_JOBS) queue: Queue,
    @Inject(REQUEST_TIMERS_URL) private readonly webUrl: string,
  ) {
    this.access = loadGarageAccess(prisma);
    this.timers = new ObjectTimers(queue, [
      ...REQUEST_REMINDER_DAYS.map((day) => ({
        fire: (id: string, sweep: boolean) => this.remind(day, id, sweep),
        name: reminder(day),
        overdue: (now: Date) => this.overdueReminders(day, now),
      })),
      {
        fire: (id, sweep) => this.expireRequest(id, sweep),
        name: EXPIRY,
        overdue: (now) => this.overdueRequests(now),
      },
      {
        fire: (id, sweep) => this.expireQuote(id, sweep),
        name: QUOTE_EXPIRY,
        overdue: (now) => this.overdueQuotes(now),
      },
    ]);
  }

  async onEvent(job: Pick<Job<RequestTimerEvent>, 'data'>): Promise<void> {
    const { id, kind, payload } = job.data;
    const requestId = payload['requestId'] as string;
    const quoteId = payload['quoteId'] as string;
    switch (kind) {
      case 'request.created':
        return this.setRequest(requestId);
      case 'request.cancelled':
        await this.clearReminders(requestId);
        await this.timers.clear(EXPIRY, requestId);
        await this.clearQuotes(requestId);
        return;
      case 'request.expired':
        return this.tellRequestExpired(id, requestId, {
          closed: payload['closed'] === true,
          garageIds: (payload['garageIds'] as string[] | undefined) ?? [],
        });
      case 'quote.sent':
        return this.setQuote(quoteId);
      case 'quote.accepted':
        await this.clearReminders(requestId);
        await this.timers.clear(QUOTE_EXPIRY, quoteId);
        return;
      case 'quote.withdrawn':
      case 'quote.declined_by_driver':
        await this.timers.clear(QUOTE_EXPIRY, quoteId);
        return;
      // A confirmed booking closes the request's other quotes as lost.
      case 'quote.closed':
        for (const closed of (payload['quoteIds'] as string[] | undefined) ??
          [])
          await this.timers.clear(QUOTE_EXPIRY, closed);
        return;
      // The booking lapse expires quotes too; it tells of them itself.
      case 'quote.expired':
        await this.timers.clear(QUOTE_EXPIRY, quoteId);
        if (payload['reason'] === 'time')
          await this.tellQuoteExpired(id, quoteId);
        return;
    }
  }

  private async setRequest(requestId: string): Promise<void> {
    const request = await this.prisma.quoteRequest.findUnique({
      select: { createdAt: true, expiresAt: true, status: true },
      where: { id: requestId },
    });
    // A retried or late job may find the request quoted already.
    if (!request || !['sent', 'quoted'].includes(request.status)) return;
    const now = this.now();
    for (const day of REQUEST_REMINDER_DAYS) {
      const at = addLocalDays(request.createdAt, day);
      if (at > now && at < request.expiresAt)
        await this.timers.set(reminder(day), requestId, at, now);
    }
    await this.timers.set(EXPIRY, requestId, request.expiresAt, now);
  }

  private async clearReminders(requestId: string): Promise<void> {
    for (const day of REQUEST_REMINDER_DAYS)
      await this.timers.clear(reminder(day), requestId);
  }

  // A cancelled or account-closed request's quotes leave waiting with it.
  private async clearQuotes(requestId: string): Promise<void> {
    const quotes = await this.prisma.quote.findMany({
      select: { id: true },
      where: { requestId },
    });
    for (const quote of quotes) await this.timers.clear(QUOTE_EXPIRY, quote.id);
  }

  private async overdueReminders(day: number, now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM quote_request r
      WHERE r.status IN ('sent', 'quoted') AND r.expires_at > ${now}
        AND ((r.created_at AT TIME ZONE 'Europe/Bucharest')
          + make_interval(days => ${day}::int))
          AT TIME ZONE 'Europe/Bucharest' <= ${now}
        AND EXISTS (${this.unreminded(day)} AND rr.request_id = r.id)
      ORDER BY r.created_at, r.id`;
    return rows.map((row) => row.id);
  }

  // A garage still waiting, not suspended, and not yet reminded that day.
  private unreminded(day: number) {
    return Prisma.sql`
      SELECT rr.id, rr.garage_id AS "garageId" FROM request_recipient rr
      JOIN garage g ON g.id = rr.garage_id
      WHERE rr.status = 'waiting' AND g.status <> 'suspended'
        AND rr.${Prisma.raw(REMINDED[day] ?? '')} IS NULL`;
  }

  private async remind(day: number, id: string, sweep: boolean) {
    const now = this.now();
    const request = await this.prisma.quoteRequest.findUnique({
      select: {
        carBrand: true,
        carModel: true,
        createdAt: true,
        driver: { select: { name: true } },
        expiresAt: true,
        status: true,
      },
      where: { id },
    });
    const due =
      request &&
      this.webUrl &&
      ['sent', 'quoted'].includes(request.status) &&
      now >= addLocalDays(request.createdAt, day) &&
      now < request.expiresAt;
    if (!due) {
      this.logger.log(`request ${id} reminder ${day}: nothing to do`);
      return;
    }
    const waiting = await this.prisma.$queryRaw<Reminding[]>`
      ${this.unreminded(day)} AND rr.request_id = ${id}::uuid
      ORDER BY rr.id`;
    const params = {
      car: `${request.carBrand} ${request.carModel}`,
      driver: shortName(request.driver.name),
      link: `${this.webUrl}/app/garage/requests`,
    };
    for (const recipient of waiting) {
      const step = await this.remindGarage(day, id, recipient, params, now);
      if (step) recordRequestTimer(step, sweep);
    }
    this.logger.log(
      `request ${id} reminder ${day}${sweep ? ' (sweep)' : ''}: ${waiting.length} garages`,
    );
  }

  // The notice's event id is the garage's and the day's, so a repeated
  // timer, the sweep and a retry build it once; the day is marked after.
  private async remindGarage(
    day: number,
    requestId: string,
    recipient: Reminding,
    params: Record<string, string>,
    now: Date,
  ): Promise<RequestTimerStep | null> {
    const staff = await this.answering(recipient.garageId);
    const queued = staff.length
      ? await this.notifications.notify({
          eventId: `${reminder(day)}-${recipient.id}`,
          garageId: recipient.garageId,
          kind: 'REQUEST_REMINDER',
          params,
          recipients: staff,
          subjectId: requestId,
        })
      : 0;
    const column = Prisma.raw(REMINDED[day] ?? '');
    const marked = await this.prisma.$executeRaw`
      UPDATE request_recipient SET ${column} = ${now}
      WHERE id = ${recipient.id}::uuid AND ${column} IS NULL`;
    if (marked === 0 || staff.length === 0) return null;
    return queued > 0 ? 'reminder_sent' : 'reminder_muted';
  }

  private async setQuote(quoteId: string): Promise<void> {
    const quote = await this.prisma.quote.findUnique({
      select: { expiresAt: true, status: true },
      where: { id: quoteId },
    });
    if (quote?.status !== 'waiting') return;
    await this.timers.set(QUOTE_EXPIRY, quoteId, quote.expiresAt, this.now());
  }

  private async overdueRequests(now: Date): Promise<string[]> {
    const rows = await this.prisma.quoteRequest.findMany({
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      where: { expiresAt: { lte: now }, status: { in: ['sent', 'quoted'] } },
    });
    return rows.map((row) => row.id);
  }

  private async expireRequest(id: string, sweep: boolean): Promise<void> {
    const closed = await this.prisma.$transaction(async (tx) => {
      const [request] = await tx.$queryRaw<Expiring[]>`
        SELECT id, driver_id AS "driverId"
        FROM quote_request
        WHERE id = ${id}::uuid AND status IN ('sent', 'quoted')
          AND expires_at <= ${this.now()}
        FOR UPDATE`;
      return request ? this.closeExpired(tx, request) : null;
    });
    if (closed) this.count(closed, sweep);
    this.logger.log(
      `request ${id} expiry${sweep ? ' (sweep)' : ''}: ${this.outcome(closed)}`,
    );
  }

  // A booking awaiting confirmation holds its request's other quotes: its
  // lapse expires the ones past their time.
  private async overdueQuotes(now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT q.id FROM quote q
      WHERE q.status = 'waiting' AND q.expires_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM booking b
          WHERE b.request_id = q.request_id
            AND b.status = 'awaiting_confirmation')
      ORDER BY q.expires_at, q.id`;
    return rows.map((row) => row.id);
  }

  // The request row is locked with the quote, so two of its quotes expiring
  // at once agree on which was the last one waiting.
  private async expireQuote(id: string, sweep: boolean): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [quote] = await tx.$queryRaw<ExpiringQuote[]>`
        SELECT q.id, q.garage_id AS "garageId", q.request_id AS "requestId",
          r.driver_id AS "driverId", r.status::text AS "requestStatus"
        FROM quote q JOIN quote_request r ON r.id = q.request_id
        WHERE q.id = ${id}::uuid AND q.status = 'waiting'
          AND q.expires_at <= ${this.now()}
        FOR UPDATE OF q, r`;
      if (!quote) return null;
      const held = await tx.booking.count({
        where: {
          requestId: quote.requestId,
          status: 'awaiting_confirmation',
        },
      });
      if (held > 0) return 'held' as const;
      await this.expireOne(tx, quote);
      const left = await tx.quote.count({
        where: { requestId: quote.requestId, status: 'waiting' },
      });
      return quote.requestStatus === 'quoted' && left === 0
        ? this.closeExpired(tx, {
            driverId: quote.driverId,
            id: quote.requestId,
          })
        : undefined;
    });
    if (outcome === 'held') recordRequestTimer('quote_held', sweep);
    else if (outcome !== null) {
      recordRequestTimer('quote_expired', sweep);
      if (outcome) this.count(outcome, sweep);
    }
    this.logger.log(
      `quote ${id} expiry${sweep ? ' (sweep)' : ''}: ${
        outcome === null
          ? 'nothing to do'
          : outcome === 'held'
            ? 'held by a booking'
            : 'expired'
      }`,
    );
  }

  private async expireOne(tx: Tx, quote: ExpiringQuote): Promise<void> {
    await moveQuote(
      tx,
      { audit: this.audit, events: outbox },
      {
        actor: SYSTEM,
        event: {
          audience: {
            driverAccountId: quote.driverId,
            garageId: quote.garageId,
            type: 'quote',
          },
          kind: 'quote.expired',
          payload: {
            quoteId: quote.id,
            reason: 'time',
            requestId: quote.requestId,
          },
        },
        id: quote.id,
        to: 'expired',
      },
    );
    await this.audit.record(tx, {
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'expired_reason',
      garageId: quote.garageId,
      newValue: 'time',
      oldValue: null,
      subjectId: quote.id,
      subjectType: 'quote',
    });
  }

  // Every garage still waiting expires; the request closes when no quote is
  // left waiting. One request.expired tells both sides, and only when
  // something changed.
  private async closeExpired(tx: Tx, request: Expiring): Promise<Closed> {
    const silent = { audit: this.audit, events: noEvents };
    const waiting = await tx.requestRecipient.findMany({
      orderBy: { id: 'asc' },
      select: { garageId: true, id: true },
      where: { requestId: request.id, status: 'waiting' },
    });
    const garageIds = waiting.map((r) => r.garageId);
    const event = {
      audience: {
        driverAccountId: request.driverId,
        garageIds,
        type: 'request' as const,
      },
      kind: 'request.expired' as const,
    };
    for (const recipient of waiting) {
      await moveRecipient(tx, silent, {
        actor: SYSTEM,
        event,
        id: recipient.id,
        to: 'expired',
      });
    }
    const open = await tx.quote.count({
      where: { requestId: request.id, status: 'waiting' },
    });
    const closed = open === 0;
    if (closed) {
      await moveRequest(tx, silent, {
        actor: SYSTEM,
        closedReason: 'expired',
        event,
        id: request.id,
        to: 'closed',
      });
    }
    if (closed || garageIds.length > 0) {
      await outbox.record(tx, {
        ...event,
        payload: { closed, garageIds, requestId: request.id },
        subjectId: request.id,
      });
    }
    return { closed, garageIds };
  }

  private count({ closed, garageIds }: Closed, sweep: boolean) {
    for (const _garage of garageIds)
      recordRequestTimer('recipient_expired', sweep);
    if (closed) recordRequestTimer('request_closed', sweep);
  }

  private outcome(closed: Closed | null): string {
    if (!closed) return 'nothing to do';
    const garages = `${closed.garageIds.length} garages expired`;
    return closed.closed ? `${garages}, request closed` : garages;
  }

  // The garages that never answered learn the request went; the driver,
  // when it closed, is sent to ask other garages.
  private async tellRequestExpired(
    eventId: string,
    requestId: string,
    { closed, garageIds }: Closed,
  ): Promise<void> {
    const request = await this.prisma.quoteRequest.findUnique({
      select: {
        carBrand: true,
        carModel: true,
        driver: { select: { name: true } },
        driverId: true,
      },
      where: { id: requestId },
    });
    if (!request || !this.webUrl) return;
    const car = `${request.carBrand} ${request.carModel}`;
    let queued = 0;
    let told = 0;
    for (const garageId of garageIds) {
      const staff = await this.desk(garageId);
      told += staff.length;
      queued += staff.length
        ? await this.notifications.notify({
            eventId,
            garageId,
            kind: 'REQUEST_EXPIRED',
            params: {
              car,
              driver: shortName(request.driver.name),
              link: `${this.webUrl}/app/garage/requests`,
              side: 'garage',
            },
            recipients: staff,
            subjectId: requestId,
          })
        : 0;
    }
    if (closed) {
      told += 1;
      queued += await this.notifications.notify({
        eventId,
        kind: 'REQUEST_EXPIRED',
        params: {
          car,
          link: `${this.webUrl}/app/driver/requests/${requestId}`,
          side: 'driver',
        },
        recipients: [request.driverId],
        subjectId: requestId,
      });
    }
    this.logger.log(
      `request ${requestId} expiry told to ${told} people, ${queued} queued`,
    );
  }

  private async tellQuoteExpired(
    eventId: string,
    quoteId: string,
  ): Promise<void> {
    const quote = await this.prisma.quote.findUnique({
      select: {
        garage: { select: { name: true } },
        garageId: true,
        request: {
          select: {
            carBrand: true,
            carModel: true,
            driver: { select: { name: true } },
            driverId: true,
            id: true,
          },
        },
      },
      where: { id: quoteId },
    });
    if (!quote || !this.webUrl) return;
    const { request } = quote;
    const car = `${request.carBrand} ${request.carModel}`;
    const staff = await this.desk(quote.garageId);
    let queued = await this.notifications.notify({
      eventId,
      kind: 'QUOTE_EXPIRED',
      params: {
        car,
        garage: quote.garage.name,
        link: `${this.webUrl}/app/driver/requests/${request.id}`,
        side: 'driver',
      },
      recipients: [request.driverId],
      subjectId: quoteId,
    });
    if (staff.length) {
      queued += await this.notifications.notify({
        eventId,
        garageId: quote.garageId,
        kind: 'QUOTE_EXPIRED',
        params: {
          car,
          driver: shortName(request.driver.name),
          link: `${this.webUrl}/app/garage/requests`,
          side: 'garage',
        },
        recipients: staff,
        subjectId: quoteId,
      });
    }
    this.logger.log(
      `quote ${quoteId} expiry told to ${staff.length + 1} people, ${queued} queued`,
    );
  }

  private async answering(garageId: string): Promise<string[]> {
    const { mechanics, owners, receptionists } = await this.access(garageId);
    const answering = [...mechanics]
      .filter(([, permissions]) => permissions.canAnswerQuotes)
      .map(([accountId]) => accountId);
    return [...new Set([...owners, ...receptionists, ...answering])];
  }

  private async desk(garageId: string): Promise<string[]> {
    const { owners, receptionists } = await this.access(garageId);
    return [...new Set([...owners, ...receptionists])];
  }
}
