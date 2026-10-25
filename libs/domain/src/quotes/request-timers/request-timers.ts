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
import { moveRecipient, moveRequest } from '../transitions';

export const REQUEST_TIMERS_QUEUE = 'request-timers';
export const REQUEST_TIMERS_JOBS = Symbol('REQUEST_TIMERS_JOBS');
export const REQUEST_TIMERS_URL = Symbol('REQUEST_TIMERS_URL');

const EXPIRY = 'request-expiry';

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
  ] as readonly EventKind[],
  queue: REQUEST_TIMERS_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface RequestTimerEvent {
  id: string;
  kind: string;
  payload: { requestId: string } & Record<string, unknown>;
  subjectId?: string;
}

const SYSTEM: TransitionActor = { accountId: null, role: 'system' };

type Tx = Prisma.TransactionClient;

interface Expiring {
  id: string;
  driverId: string;
}

interface Closed {
  garageIds: string[];
  closed: boolean;
}

// A sent request's timers: its expiry at the end of the seventh day. Each
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
    ]);
  }

  async onEvent(job: Pick<Job<RequestTimerEvent>, 'data'>): Promise<void> {
    const { id, kind, payload } = job.data;
    switch (kind) {
      case 'request.created':
        return this.setRequest(payload.requestId);
      case 'request.cancelled':
        await this.timers.clear(EXPIRY, payload.requestId);
        return;
      case 'request.expired':
        return this.tellRequestExpired(id, payload.requestId, {
          closed: payload['closed'] === true,
          garageIds: (payload['garageIds'] as string[] | undefined) ?? [],
        });
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

  private async desk(garageId: string): Promise<string[]> {
    const { owners, receptionists } = await this.access(garageId);
    return [...new Set([...owners, ...receptionists])];
  }
}
