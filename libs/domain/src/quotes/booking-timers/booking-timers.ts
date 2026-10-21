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
import { ObjectTimers, type TimerKind } from '../../scheduler/timers';
import type { TransitionActor } from '../../transitions';
import {
  type BookingLapseRequest,
  recordBookingLapse,
} from '../quotes/quotes.metrics';
import { BOOKING_CONFIRM_REMINDER_HOURS } from '../quotes-config';
import { shortName } from '../reads';
import { moveBooking, moveQuote, moveRequest } from '../transitions';

export const BOOKING_TIMERS_QUEUE = 'booking-timers';
export const BOOKING_TIMERS_JOBS = Symbol('BOOKING_TIMERS_JOBS');
export const BOOKING_TIMERS_URL = Symbol('BOOKING_TIMERS_URL');

const HOUR = 3_600_000;
const LAPSE = 'booking-lapse';
const reminderKind = (hours: number) => `booking-confirm-reminder-${hours}h`;
const KINDS = [...BOOKING_CONFIRM_REMINDER_HOURS.map(reminderKind), LAPSE];

// A failed job is tried 5 more times, 1, 2, 4, 8 and 16 minutes later; the
// sweep lapses a booking whose timer was lost for good.
const BOOKING_TIMERS_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const BOOKING_TIMERS_CONSUMER = {
  jobs: BOOKING_TIMERS_RUN,
  kinds: ['quote.accepted', 'booking.confirmed'] as readonly EventKind[],
  queue: BOOKING_TIMERS_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface BookingTimerEvent {
  id: string;
  kind: string;
  payload: { bookingId: string } & Record<string, unknown>;
  subjectId?: string;
}

const SYSTEM: TransitionActor = { accountId: null, role: 'system' };

type Tx = Prisma.TransactionClient;

interface Lapsing {
  id: string;
  driverId: string;
  garageId: string;
  quoteId: string;
  requestId: string;
}

// An accepted booking's three timers: two reminders to the garage's owners
// and receptionists, then the lapse, which hands the request back to the
// driver. Each re-reads the booking, so a late or repeated timer does
// nothing once it is confirmed, cancelled or lapsed.
@Injectable()
export class BookingTimers {
  private readonly logger = new Logger('BookingTimers');
  private readonly access: ReturnType<typeof loadGarageAccess>;
  readonly timers: ObjectTimers;
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(BOOKING_TIMERS_JOBS) queue: Queue,
    @Inject(BOOKING_TIMERS_URL) private readonly webUrl: string,
  ) {
    this.access = loadGarageAccess(prisma);
    const kinds: TimerKind[] = BOOKING_CONFIRM_REMINDER_HOURS.map((hours) => ({
      fire: (id) => this.remind(id, hours),
      name: reminderKind(hours),
      // A lost reminder is not worth a late one.
      overdue: async () => [],
    }));
    kinds.push({
      fire: (id, sweep) => this.lapse(id, sweep),
      name: LAPSE,
      overdue: (now) => this.overdue(now),
    });
    this.timers = new ObjectTimers(queue, kinds);
  }

  async onEvent(job: Pick<Job<BookingTimerEvent>, 'data'>): Promise<void> {
    const { kind, payload } = job.data;
    if (kind === 'booking.confirmed') {
      for (const name of KINDS)
        await this.timers.clear(name, payload.bookingId);
      return;
    }
    const booking = await this.prisma.booking.findUnique({
      select: {
        confirmBy: true,
        quote: { select: { acceptedAt: true } },
        status: true,
      },
      where: { id: payload.bookingId },
    });
    if (booking?.status !== 'awaiting_confirmation') return;
    const now = this.now();
    await this.setReminders(
      payload.bookingId,
      booking.quote.acceptedAt ?? now,
      booking.confirmBy,
      now,
    );
    await this.timers.set(LAPSE, payload.bookingId, booking.confirmBy, now);
  }

  // The first reminder counts from the acceptance, the last back from the
  // lapse; one that would fire already or after the lapse is not set.
  private async setReminders(
    id: string,
    acceptedAt: Date,
    confirmBy: Date,
    now: Date,
  ): Promise<void> {
    for (const hours of BOOKING_CONFIRM_REMINDER_HOURS) {
      const at = new Date(
        hours === BOOKING_CONFIRM_REMINDER_HOURS[0]
          ? acceptedAt.getTime() + hours * HOUR
          : confirmBy.getTime() - hours * HOUR,
      );
      if (at > now && at < confirmBy) {
        await this.timers.set(reminderKind(hours), id, at, now);
      }
    }
  }

  private async remind(id: string, hours: number): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      select: {
        confirmBy: true,
        driver: { select: { name: true } },
        garageId: true,
        request: { select: { carBrand: true, carModel: true } },
        startsAt: true,
        status: true,
      },
      where: { id },
    });
    const now = this.now();
    if (
      !this.webUrl ||
      booking?.status !== 'awaiting_confirmation' ||
      booking.confirmBy <= now
    ) {
      return;
    }
    // The time really left: confirm-by may come before the first reminder's
    // nominal hours, and a timer may fire late.
    const left = Math.ceil(
      (booking.confirmBy.getTime() - now.getTime()) / HOUR,
    );
    const { owners, receptionists } = await this.access(booking.garageId);
    const staff = [...new Set([...owners, ...receptionists])];
    const queued = staff.length
      ? await this.notifications.notify({
          eventId: `${reminderKind(hours)}-${id}`,
          garageId: booking.garageId,
          kind: 'BOOKING_CONFIRM_REMINDER',
          params: {
            car: `${booking.request.carBrand} ${booking.request.carModel}`,
            driver: shortName(booking.driver.name),
            left,
            link: `${this.webUrl}/app/garage/requests`,
            slot: booking.startsAt.toISOString(),
            until: booking.confirmBy.toISOString(),
          },
          recipients: staff,
          subjectId: id,
        })
      : 0;
    this.logger.log(
      `booking ${id} ${hours} h reminder to ${staff.length} staff, ${queued} queued`,
    );
  }

  private async overdue(now: Date): Promise<string[]> {
    const rows = await this.prisma.booking.findMany({
      orderBy: [{ confirmBy: 'asc' }, { id: 'asc' }],
      select: { id: true },
      where: { confirmBy: { lte: now }, status: 'awaiting_confirmation' },
    });
    return rows.map((row) => row.id);
  }

  private async lapse(id: string, sweep: boolean): Promise<void> {
    const request = await this.prisma.$transaction((tx) =>
      this.lapseIn(tx, id),
    );
    if (request) recordBookingLapse(request, sweep);
    this.logger.log(
      `booking ${id} lapse${sweep ? ' (sweep)' : ''}: ${request ?? 'nothing to do'}`,
    );
  }

  private async lapseIn(
    tx: Tx,
    id: string,
  ): Promise<BookingLapseRequest | null> {
    const [booking] = await tx.$queryRaw<Lapsing[]>`
      SELECT id, driver_id AS "driverId", garage_id AS "garageId",
        quote_id AS "quoteId", request_id AS "requestId"
      FROM booking
      WHERE id = ${id}::uuid AND status = 'awaiting_confirmation'
        AND confirm_by <= ${this.now()}
      FOR UPDATE`;
    if (!booking) return null;
    const ports = { audit: this.audit, events: outbox };
    const silent = { audit: this.audit, events: noEvents };
    await moveBooking(tx, silent, {
      actor: SYSTEM,
      event: { audience: this.audience(booking), kind: 'booking.lapsed' },
      id,
      to: 'lapsed',
    });
    await this.expire(tx, ports, booking, booking, 'booking_lapsed');
    const held = await tx.quote.findMany({
      select: { garageId: true, id: true },
      where: {
        expiresAt: { lte: this.now() },
        requestId: booking.requestId,
        status: 'waiting',
      },
    });
    for (const quote of held) {
      await this.expire(
        tx,
        ports,
        booking,
        { garageId: quote.garageId, quoteId: quote.id },
        'held_past_validity',
      );
    }
    const left = await tx.quote.count({
      where: { requestId: booking.requestId, status: 'waiting' },
    });
    const next: BookingLapseRequest = left > 0 ? 'quoted' : 'closed';
    await moveRequest(tx, silent, {
      actor: SYSTEM,
      closedReason: 'booking_lapsed',
      event: { audience: this.audience(booking), kind: 'booking.lapsed' },
      id: booking.requestId,
      to: next,
    });
    await outbox.record(tx, {
      audience: this.audience(booking),
      kind: 'booking.lapsed',
      payload: {
        bookingId: id,
        quoteId: booking.quoteId,
        requestId: booking.requestId,
      },
      subjectId: id,
    });
    return next;
  }

  // A quote the lapse ends, with its reason on its own audit entry and its
  // event.
  private async expire(
    tx: Tx,
    ports: { audit: AuditPort; events: typeof outbox },
    booking: Lapsing,
    { garageId, quoteId }: { garageId: string; quoteId: string },
    reason: 'booking_lapsed' | 'held_past_validity',
  ): Promise<void> {
    await moveQuote(tx, ports, {
      actor: SYSTEM,
      event: {
        audience: {
          driverAccountId: booking.driverId,
          garageId,
          type: 'quote',
        },
        kind: 'quote.expired',
        payload: {
          bookingId: booking.id,
          quoteId,
          reason,
          requestId: booking.requestId,
        },
      },
      id: quoteId,
      to: 'expired',
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'expired_reason',
      garageId,
      newValue: reason,
      oldValue: null,
      subjectId: quoteId,
      subjectType: 'quote',
    });
  }

  private audience(booking: Lapsing) {
    return {
      driverAccountId: booking.driverId,
      garageId: booking.garageId,
      mechanicId: null,
      type: 'booking' as const,
    };
  }
}
