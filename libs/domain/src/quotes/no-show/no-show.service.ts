import type { GarageBookingDto } from '@motor-fix/contracts';
import { todayInBucharest } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { noShowUndoOpen } from './no-show.window';
import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, assertGarage, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { invalidTransition, type TransitionActor } from '../../transitions';
import { ScheduleService } from '../../workshop/schedule/schedule.service';
import { moveJob } from '../../workshop/transitions';
import { recordNoShow } from '../quotes/quotes.metrics';
import { bookingMechanicInclude, garageBookingOf } from '../reads';
import { moveBooking, moveRequest } from '../transitions';

type Tx = Prisma.TransactionClient;
type Action = 'recorded' | 'withdrawn';

interface Locked {
  durationMinutes: number;
  driverId: string;
  garageId: string;
  garageName: string;
  lift: number | null;
  mechanicId: string | null;
  noShowAt: Date | null;
  requestId: string;
  startsAt: Date;
  status: string;
}

const NOT_YOURS = {
  recorded: {
    en: 'You cannot record a no-show for another mechanic’s booking',
    ro: 'Nu poți înregistra neprezentarea pentru programarea altui mecanic',
  },
  withdrawn: {
    en: 'You cannot withdraw a no-show for another mechanic’s booking',
    ro: 'Nu poți retrage neprezentarea pentru programarea altui mecanic',
  },
};

// The garage records that the driver did not come to a confirmed booking
// whose time has come, and may take it back until midnight in Bucharest.
// The booking, its job and its request move together, the driver's history
// names the garage, and the driver hears it once.
@Injectable()
export class NoShowService {
  private readonly logger = new Logger('NoShow');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly schedule: ScheduleService,
  ) {}

  record(actor: Actor, bookingId: string): Promise<GarageBookingDto> {
    return this.run(actor, bookingId, 'recorded');
  }

  withdraw(actor: Actor, bookingId: string): Promise<GarageBookingDto> {
    return this.run(actor, bookingId, 'withdrawn');
  }

  private async run(
    actor: Actor,
    bookingId: string,
    action: Action,
  ): Promise<GarageBookingDto> {
    let booking: Locked;
    try {
      booking = await this.prisma.$transaction(async (tx) => {
        return this.store(tx, actor, bookingId, action);
      });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        recordNoShow(action, 'refused');
        const code = (error.getResponse() as { code?: string }).code;
        this.logger.warn(
          `booking ${bookingId}: no-show ${action} refused (${code})`,
        );
      }
      throw error;
    }
    recordNoShow(action, 'done');
    this.logger.log(
      `booking ${bookingId} (request ${booking.requestId}, garage ${booking.garageId}): no-show ${action} by the ${actor.role}`,
    );
    const read = await this.prisma.booking.findUniqueOrThrow({
      include: bookingMechanicInclude(todayInBucharest()),
      where: { id: bookingId },
    });
    return garageBookingOf(read);
  }

  private async store(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    action: Action,
  ): Promise<Locked> {
    const locked = await this.lock(tx, actor, bookingId, action);
    if (action === 'recorded') {
      await this.storeRecord(tx, actor, bookingId, locked);
    } else {
      await this.storeWithdrawal(tx, actor, bookingId, locked);
    }
    return locked;
  }

  // Locks the booking, then lets in its garage's owner and front desk and
  // the booking's own mechanic; another mechanic of the garage is told no,
  // anyone else learns nothing.
  private async lock(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    action: Action,
  ): Promise<Locked> {
    const [booking] = await tx.$queryRaw<Omit<Locked, 'garageName'>[]>`
      SELECT b.driver_id AS "driverId", b.duration_minutes AS "durationMinutes",
        b.garage_id AS "garageId", b.lift,
        b.mechanic_id AS "mechanicId", b.no_show_at AS "noShowAt",
        b.request_id AS "requestId", b.starts_at AS "startsAt",
        b.status::text AS status
      FROM booking b WHERE b.id = ${bookingId}::uuid FOR UPDATE`;
    if (!booking) throw new NotFoundException();
    assertGarage(actor, booking.garageId);
    if (actor.role === 'mechanic') {
      const card = await tx.mechanic.findFirst({
        select: { id: true, removedAt: true },
        where: { accountId: actor.accountId, garageId: booking.garageId },
      });
      if (!card || card.removedAt) throw new NotFoundException();
      if (card.id !== booking.mechanicId) {
        throw refusal(
          HttpStatus.FORBIDDEN,
          'forbidden',
          NOT_YOURS[action][actor.language ?? 'ro'],
        );
      }
    } else {
      requireCapability(actor, 'garage.requests');
    }
    const garage = await tx.garage.findUniqueOrThrow({
      select: { name: true },
      where: { id: booking.garageId },
    });
    return { ...booking, garageName: garage.name };
  }

  private by(actor: Actor): TransitionActor {
    return {
      accountId: actor.accountId,
      role: actor.role,
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    };
  }

  private event(booking: Locked, kind: `booking.no_show_${Action}`) {
    return {
      audience: {
        driverAccountId: booking.driverId,
        garageId: booking.garageId,
        mechanicId: booking.mechanicId,
        type: 'booking' as const,
      },
      kind,
    };
  }

  // A no-show needs a confirmed booking whose time has come and whose job,
  // if one was opened, has not started.
  private async storeRecord(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    booking: Locked,
  ) {
    const job = await tx.job.findUnique({
      select: { id: true, status: true },
      where: { bookingId },
    });
    if (
      booking.status !== 'confirmed' ||
      booking.startsAt > new Date() ||
      (job && job.status !== 'to_do')
    ) {
      throw invalidTransition({
        currentStatus: booking.status,
        entity: 'booking',
        to: 'no_show',
      });
    }
    const by = this.by(actor);
    const silent = { audit: this.audit, events: noEvents };
    const event = this.event(booking, 'booking.no_show_recorded');
    if (job) {
      await moveJob(tx, silent, {
        actor: by,
        event,
        id: job.id,
        to: 'cancelled',
      });
    }
    await moveBooking(tx, silent, {
      actor: by,
      event,
      id: bookingId,
      to: 'no_show',
    });
    await moveRequest(tx, silent, {
      actor: by,
      closedReason: 'no_show',
      event,
      id: booking.requestId,
      to: 'closed',
    });
    await this.audit.record(
      tx,
      this.told(actor, bookingId, booking, 'recorded'),
    );
    await this.events.record(tx, {
      ...event,
      payload: {
        bookingId,
        garageId: booking.garageId,
        recordedBy: actor.accountId,
        requestId: booking.requestId,
      },
      subjectId: bookingId,
    });
  }

  // A withdrawal needs the no-show recorded today in Bucharest, the request
  // closed by it, and the booking's place still free; the place is written
  // back as the confirmation put it.
  private async storeWithdrawal(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    booking: Locked,
  ) {
    const request = await tx.quoteRequest.findUniqueOrThrow({
      select: { closedReason: true, status: true },
      where: { id: booking.requestId },
    });
    if (
      booking.status !== 'no_show' ||
      !booking.noShowAt ||
      !noShowUndoOpen(booking.noShowAt, new Date())
    ) {
      throw invalidTransition({
        currentStatus: booking.status,
        entity: 'booking',
        to: 'confirmed',
      });
    }
    if (request.closedReason !== 'no_show') {
      throw invalidTransition({
        currentStatus: request.status,
        entity: 'quote_request',
        to: 'booked',
      });
    }
    const segments = await this.schedule.assertPlaceable(tx, {
      durationMinutes: booking.durationMinutes,
      garageId: booking.garageId,
      language: actor.language === 'en' ? 'en' : 'ro',
      lift: booking.lift,
      mechanicId: booking.mechanicId,
      startsAt: booking.startsAt,
    });
    const by = this.by(actor);
    const silent = { audit: this.audit, events: noEvents };
    const event = this.event(booking, 'booking.no_show_withdrawn');
    await moveBooking(tx, silent, {
      actor: by,
      event,
      id: bookingId,
      to: 'confirmed',
    });
    await tx.bookingSegment.createMany({
      data: segments.map((segment) => ({
        ...segment,
        bookingId,
        garageId: booking.garageId,
      })),
    });
    const job = await tx.job.findUnique({
      select: { id: true, status: true },
      where: { bookingId },
    });
    if (job?.status === 'cancelled') {
      await moveJob(tx, silent, { actor: by, event, id: job.id, to: 'to_do' });
    }
    await moveRequest(tx, silent, {
      actor: by,
      event,
      id: booking.requestId,
      to: 'booked',
    });
    await this.audit.record(
      tx,
      this.told(actor, bookingId, booking, 'withdrawn'),
    );
    await this.events.record(tx, {
      ...event,
      payload: {
        bookingId,
        garageId: booking.garageId,
        requestId: booking.requestId,
        withdrawnBy: actor.accountId,
      },
      subjectId: bookingId,
    });
  }

  // The driver's history names the garage, never the person at it.
  private told(
    actor: Actor,
    bookingId: string,
    booking: Locked,
    action: Action,
  ): AuditEntry {
    return {
      action: 'update',
      actorId: actor.accountId,
      actorLabel: booking.garageName,
      actorRole: actor.role,
      field: 'no_show',
      garageId: booking.garageId,
      newValue: action,
      oldValue: null,
      subjectId: bookingId,
      subjectType: 'booking',
    };
  }
}
