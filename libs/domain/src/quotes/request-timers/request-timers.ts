import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { noEvents, outbox } from '../../events/event.port';
import { loadGarageAccess } from '../../events/garage-access';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications/notifications.service';
import { ObjectTimers } from '../../scheduler/timers';
import type { TransitionActor } from '../../transitions';
import { recordRequestTimer } from '../quotes/quotes.metrics';
import { shortName } from '../reads';
import { moveQuote, moveRecipient, moveRequest } from '../transitions';

export const REQUEST_TIMERS_QUEUE = 'request-timers';
export const REQUEST_TIMERS_JOBS = Symbol('REQUEST_TIMERS_JOBS');
export const REQUEST_TIMERS_URL = Symbol('REQUEST_TIMERS_URL');

const EXPIRY = 'request-expiry';
const QUOTE_EXPIRY = 'quote-expiry';

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
    'request.cancelled',
    'request.expired',
    'quote.sent',
    'quote.accepted',
    'quote.withdrawn',
    'quote.declined_by_driver',
    'quote.expired',
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

interface Closed {
  garageIds: string[];
  closed: boolean;
}

// A sent request's timers, its expiry at the end of the seventh day, and
// each waiting quote's expiry seven days after it was sent. Each
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
        await this.timers.clear(EXPIRY, requestId);
        return;
      case 'request.expired':
        return this.tellRequestExpired(id, requestId, {
          closed: payload['closed'] === true,
          garageIds: (payload['garageIds'] as string[] | undefined) ?? [],
        });
      case 'quote.sent':
        return this.setQuote(quoteId);
      case 'quote.accepted':
      case 'quote.withdrawn':
      case 'quote.declined_by_driver':
        await this.timers.clear(QUOTE_EXPIRY, quoteId);
        return;
      // The booking lapse expires quotes too; it tells of them itself.
      case 'quote.expired':
        if (payload['reason'] === 'time')
          await this.tellQuoteExpired(id, quoteId);
        return;
    }
  }

  private async setRequest(requestId: string): Promise<void> {
    const request = await this.prisma.quoteRequest.findUnique({
      select: { expiresAt: true, status: true },
      where: { id: requestId },
    });
    if (request?.status !== 'sent') return;
    await this.timers.set(EXPIRY, requestId, request.expiresAt, this.now());
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

  private async desk(garageId: string): Promise<string[]> {
    const { owners, receptionists } = await this.access(garageId);
    return [...new Set([...owners, ...receptionists])];
  }
}
