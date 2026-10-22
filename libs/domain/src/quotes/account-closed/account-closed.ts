import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { noEvents, outbox } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { NOTIFICATIONS_PRISMA } from '../../notifications/notifications.service';
import type { TransitionActor } from '../../transitions';
import { moveJob } from '../../workshop/transitions';
import { recordAccountClosedCleanup } from '../quotes/quotes.metrics';
import {
  moveBooking,
  moveQuote,
  moveRecipient,
  moveRequest,
} from '../transitions';

export const ACCOUNT_CLOSED_QUEUE = 'account-closed';

// A failed job is tried twice more, 1 and 2 minutes later; each try finds
// only what the one before left open.
const ACCOUNT_CLOSED_RUN: JobsOptions = {
  attempts: 3,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

const KINDS: readonly EventKind[] = ['account.deleted', 'account.suspended'];

export const ACCOUNT_CLOSED_CONSUMER = {
  jobs: ACCOUNT_CLOSED_RUN,
  kinds: KINDS,
  queue: ACCOUNT_CLOSED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface AccountClosedEvent {
  id: string;
  kind: string;
  payload: { accountId?: string } & Record<string, unknown>;
  subjectId?: string;
}

const SYSTEM: TransitionActor = { accountId: null, role: 'system' };
const OPEN = ['sent', 'quoted', 'booked'] as const;
const STARTED = ['in_work', 'paused', 'done'];
// Account ids are UUIDs; any other id names no account, so nothing is open.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Prisma.TransactionClient;

interface LiveBooking {
  id: string;
  garageId: string;
  mechanicId: string | null;
  quoteId: string;
  requestId: string;
  startsAt: Date;
  job: { id: string; status: string } | null;
}

// What one request's transaction did; `gone` is a request another delivery
// closed meanwhile, which nobody counts.
interface Outcome {
  request: 'closed' | 'skipped' | 'gone';
  booking?: 'cancelled' | 'skipped';
}

// When a driver's account is deleted or suspended, the driver's open
// requests close and their bookings that have not started are cancelled, by
// the system, so no garage keeps waiting for someone who will not come.
@Injectable()
export class AccountClosed {
  private readonly logger = new Logger('AccountClosed');
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async onEvent(job: Pick<Job<AccountClosedEvent>, 'data'>): Promise<void> {
    const { kind, payload, subjectId } = job.data;
    if (!KINDS.includes(kind as EventKind)) return;
    const accountId = payload.accountId ?? subjectId;
    if (!accountId) return;
    const open = UUID.test(accountId)
      ? await this.prisma.quoteRequest.findMany({
          orderBy: { id: 'asc' },
          select: { id: true },
          where: { driverId: accountId, status: { in: [...OPEN] } },
        })
      : [];
    const counts = { cancelled: 0, closed: 0, failed: 0, kept: 0, skipped: 0 };
    let failure: unknown;
    for (const { id } of open) {
      try {
        const outcome = await this.prisma.$transaction((tx) =>
          this.closeIn(tx, id),
        );
        this.count(outcome, counts);
      } catch (error) {
        failure ??= error;
        counts.failed += 1;
        recordAccountClosedCleanup('request', 'failed');
        this.logger.error(`request ${id} not closed: ${String(error)}`);
      }
    }
    this.logger.log(
      `account ${accountId} ${kind}: requests closed ${counts.closed}, skipped ${counts.skipped}, failed ${counts.failed}; bookings cancelled ${counts.cancelled}, skipped ${counts.kept}`,
    );
    if (failure) throw failure;
  }

  async closeIn(tx: Tx, requestId: string): Promise<Outcome> {
    const [request] = await tx.$queryRaw<
      { driverId: string; status: string }[]
    >`
      SELECT driver_id AS "driverId", status::text AS status
      FROM quote_request WHERE id = ${requestId}::uuid FOR UPDATE`;
    if (!request || !(OPEN as readonly string[]).includes(request.status)) {
      return { request: 'gone' };
    }
    const booking = await tx.booking.findFirst({
      include: { job: { select: { id: true, status: true } } },
      where: {
        requestId,
        status: { in: ['awaiting_confirmation', 'confirmed'] },
      },
    });
    if (booking && this.started(booking)) {
      return { booking: 'skipped', request: 'skipped' };
    }
    const silent = { audit: this.audit, events: noEvents };
    const driverAccountId = request.driverId;
    const recipients = await tx.requestRecipient.findMany({
      select: { garageId: true, id: true, status: true },
      where: { requestId, status: { in: ['waiting', 'quoted'] } },
    });
    const garageIds = recipients.map((r) => r.garageId);
    const requestEvent = {
      audience: { driverAccountId, garageIds, type: 'request' as const },
      kind: 'request.cancelled' as const,
    };
    for (const recipient of recipients.filter((r) => r.status === 'waiting')) {
      await moveRecipient(tx, silent, {
        actor: SYSTEM,
        event: requestEvent,
        id: recipient.id,
        to: 'closed',
      });
    }
    const waiting = await tx.quote.findMany({
      select: { id: true },
      where: { requestId, status: 'waiting' },
    });
    for (const quote of waiting) {
      await moveQuote(tx, silent, {
        actor: SYSTEM,
        event: requestEvent,
        id: quote.id,
        to: 'lost',
      });
    }
    if (booking) await this.cancel(tx, booking, driverAccountId);
    await moveRequest(tx, silent, {
      actor: SYSTEM,
      closedReason: 'account_closed',
      event: requestEvent,
      id: requestId,
      to: 'closed',
    });
    await outbox.record(tx, {
      ...requestEvent,
      payload: { garageIds, reason: 'account_closed', requestId },
      subjectId: requestId,
    });
    return {
      request: 'closed',
      ...(booking && { booking: 'cancelled' as const }),
    };
  }

  private started(booking: LiveBooking) {
    return (
      booking.startsAt <= this.now() ||
      (booking.job !== null && STARTED.includes(booking.job.status))
    );
  }

  // Cancels a booking that has not started, with its to-do job, and loses
  // the quote it was booked on.
  private async cancel(tx: Tx, booking: LiveBooking, driverAccountId: string) {
    const silent = { audit: this.audit, events: noEvents };
    const audience = {
      driverAccountId,
      garageId: booking.garageId,
      mechanicId: booking.mechanicId,
      type: 'booking' as const,
    };
    const event = { audience, kind: 'booking.cancelled' as const };
    if (booking.job?.status === 'to_do') {
      await moveJob(tx, silent, {
        actor: SYSTEM,
        event,
        id: booking.job.id,
        to: 'cancelled',
      });
    }
    await moveBooking(tx, silent, {
      actor: SYSTEM,
      cancellation: { reason: 'driver_account_closed', side: 'system' },
      event,
      id: booking.id,
      to: 'cancelled',
    });
    await moveQuote(tx, silent, {
      actor: SYSTEM,
      event,
      id: booking.quoteId,
      to: 'lost',
    });
    await outbox.record(tx, {
      ...event,
      payload: {
        bookingId: booking.id,
        garageId: booking.garageId,
        reason: 'driver_account_closed',
        requestId: booking.requestId,
      },
      subjectId: booking.id,
    });
  }

  private count(
    outcome: Outcome,
    counts: Record<'cancelled' | 'closed' | 'kept' | 'skipped', number>,
  ) {
    if (outcome.request === 'gone') return;
    counts[outcome.request] += 1;
    recordAccountClosedCleanup('request', outcome.request);
    if (!outcome.booking) return;
    counts[outcome.booking === 'cancelled' ? 'cancelled' : 'kept'] += 1;
    recordAccountClosedCleanup('booking', outcome.booking);
  }
}
