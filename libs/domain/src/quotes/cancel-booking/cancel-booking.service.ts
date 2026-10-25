import type { BookingDto, CancelBookingDto } from '@motor-fix/contracts';
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { TransitionActor } from '../../transitions';
import { moveJob } from '../../workshop/transitions';
import { recordCancellation } from '../quotes/quotes.metrics';
import { FREE_CANCEL_CUTOFF_HOURS } from '../quotes-config';
import { bookingOf } from '../reads';
import { cancelRefused } from '../refusals';
import { moveBooking, moveQuote, moveRequest } from '../transitions';

type Tx = Prisma.TransactionClient;

const HOUR = 3_600_000;
const LIVE = ['awaiting_confirmation', 'confirmed'];

interface Locked {
  driverId: string;
  garageId: string;
  mechanicId: string | null;
  quoteId: string;
  requestId: string;
  startsAt: Date;
  status: string;
  // The booking's job, if one was opened; only a to-do one gets this far.
  jobId?: string;
}

// The driver cancels a booking that has not started, with a reason and maybe
// a note. Inside the free-cancel cutoff it is marked late, never penalised.
// The booking, its to-do job, its quote and the request move together, and
// the garage hears it once.
@Injectable()
export class CancelBookingService {
  private readonly logger = new Logger('BookingCancel');
  now = () => new Date();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async cancel(
    actor: Actor,
    bookingId: string,
    body: CancelBookingDto,
  ): Promise<BookingDto> {
    requireCapability(actor, 'driver.requests');
    let late = false;
    try {
      late = await this.prisma.$transaction(async (tx) => {
        const locked = await this.lock(tx, actor, bookingId);
        const isLate = this.isLate(locked);
        await this.store(tx, actor, bookingId, locked, body, isLate);
        return isLate;
      });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        recordCancellation('booking', 'refused', false);
        this.logger.warn(`booking ${bookingId}: cancel refused`);
      }
      throw error;
    }
    recordCancellation('booking', 'cancelled', late);
    this.logger.log(
      `booking ${bookingId}: cancelled by the driver (${body.reason}${late ? ', late' : ''})`,
    );
    const booking = await this.prisma.booking.findUniqueOrThrow({
      include: { garage: true },
      where: { id: bookingId },
    });
    return bookingOf(booking);
  }

  // Locks the booking, then refuses one that is not the driver's, has
  // ended, has started or whose job is under way.
  private async lock(tx: Tx, actor: Actor, bookingId: string): Promise<Locked> {
    const [booking] = await tx.$queryRaw<Locked[]>`
      SELECT driver_id AS "driverId", garage_id AS "garageId",
        mechanic_id AS "mechanicId", quote_id AS "quoteId",
        request_id AS "requestId", starts_at AS "startsAt",
        status::text AS status
      FROM booking WHERE id = ${bookingId}::uuid FOR UPDATE`;
    if (booking?.driverId !== actor.accountId) {
      throw new NotFoundException();
    }
    const job = await tx.job.findUnique({
      select: { id: true, status: true },
      where: { bookingId },
    });
    if (
      !LIVE.includes(booking.status) ||
      booking.startsAt <= this.now() ||
      (job && job.status !== 'to_do')
    ) {
      throw cancelRefused(actor, 'booking', booking.status);
    }
    return { ...booking, jobId: job?.id };
  }

  private isLate(booking: Locked) {
    return (
      booking.startsAt.getTime() - this.now().getTime() <
      FREE_CANCEL_CUTOFF_HOURS * HOUR
    );
  }

  private async store(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    booking: Locked,
    body: CancelBookingDto,
    late: boolean,
  ) {
    const by: TransitionActor = {
      accountId: actor.accountId,
      role: actor.role,
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    };
    const silent = { audit: this.audit, events: noEvents };
    const event = {
      audience: {
        driverAccountId: actor.accountId,
        garageId: booking.garageId,
        mechanicId: booking.mechanicId,
        type: 'booking' as const,
      },
      kind: 'booking.cancelled' as const,
    };
    if (booking.jobId) {
      await moveJob(tx, silent, {
        actor: by,
        event,
        id: booking.jobId,
        to: 'cancelled',
      });
    }
    await moveBooking(tx, silent, {
      actor: by,
      cancellation: {
        late,
        note: body.note ?? undefined,
        reason: body.reason,
        side: 'driver',
      },
      event,
      id: bookingId,
      to: 'cancelled',
    });
    await moveQuote(tx, silent, {
      actor: by,
      event,
      id: booking.quoteId,
      to: 'lost',
    });
    // Another garage's quote still open sends the request back to choosing.
    const open = await tx.quote.count({
      where: {
        expiresAt: { gt: this.now() },
        requestId: booking.requestId,
        status: 'waiting',
      },
    });
    await moveRequest(
      tx,
      silent,
      open > 0
        ? { actor: by, event, id: booking.requestId, to: 'quoted' }
        : {
            actor: by,
            closedReason: 'booking_cancelled',
            event,
            id: booking.requestId,
            to: 'closed',
          },
    );
    await this.events.record(tx, {
      ...event,
      payload: {
        bookingId,
        garageId: booking.garageId,
        late,
        reason: body.reason,
        requestId: booking.requestId,
        side: 'driver',
      },
      subjectId: bookingId,
    });
  }
}
