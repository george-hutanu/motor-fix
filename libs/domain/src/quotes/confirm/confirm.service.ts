import type {
  ConfirmBookingDto,
  ConfirmOptionsDto,
  GarageBookingDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AUDIT_PORT,
  type AuditPort,
  recordedRole,
} from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import { slotInsideHours } from '../../garages/garage-hours';
import type {
  Booking,
  Garage,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { invalidTransition } from '../../transitions';
import {
  type BookingConfirmOutcome,
  recordBookingConfirm,
} from '../quotes/quotes.metrics';
import { bookingMechanicInclude, garageBookingOf } from '../reads';
import { moveBooking, moveQuote, moveRecipient } from '../transitions';

type Tx = Prisma.TransactionClient;

const MINUTE = 60_000;

const invalidField = (field: 'mechanicId' | 'lift', message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code: 'invalid', field },
  ]);

const conflict = (code: string, message: string) =>
  refusal(HttpStatus.CONFLICT, code, message);

const mechanicUnavailable = () =>
  conflict('mechanic_unavailable', 'Mecanicul nu e disponibil');

const mechanicBusy = (name: string, en: boolean) =>
  conflict(
    'mechanic_busy',
    en ? `${name} is busy at this time` : `${name} e ocupat la ora asta`,
  );

const liftBusy = (lift: number, en: boolean) =>
  conflict(
    'lift_busy',
    en
      ? `Lift ${lift} is busy at this time`
      : `Elevatorul ${lift} e ocupat la ora asta`,
  );

const OUTCOMES = new Set<string>([
  'mechanic_busy',
  'lift_busy',
  'outside_hours',
  'mechanic_unavailable',
  'invalid_transition',
]);

function outcomeOf(error: unknown): BookingConfirmOutcome | null {
  if (!(error instanceof HttpException)) return null;
  const { code } = error.getResponse() as { code?: string };
  if (code && OUTCOMES.has(code)) return code as BookingConfirmOutcome;
  const status = error.getStatus();
  return status >= 400 && status < 500 ? 'refused' : null;
}

// The overlap the database refused although the read before it found none:
// a confirm of another booking committed in between.
function exclusionOf(error: unknown) {
  if (!(error instanceof Error)) return null;
  const said = `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
  if (said.includes('booking_mechanic_span_excl')) return 'mechanic' as const;
  if (said.includes('booking_lift_span_excl')) return 'lift' as const;
  return null;
}

interface Switches {
  team: boolean;
  lifts: boolean;
}

// The garage confirms a booking the driver accepted: the booking, its job,
// the request's other quotes and recipients and their events are written
// together or not at all.
@Injectable()
export class ConfirmService {
  private readonly logger = new Logger('Confirm');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async options(actor: Actor, bookingId: string): Promise<ConfirmOptionsDto> {
    const garageId = await this.garageOf(this.prisma, actor, bookingId);
    const garage = await this.prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    const switches = await this.switches(this.prisma, garageId);
    const mechanics = switches.team
      ? await this.offered(this.prisma, garageId)
      : [];
    return {
      liftCount: switches.lifts ? garage.liftCount : 0,
      mechanics: mechanics.map(({ id, name }) => ({ id, name })),
    };
  }

  async confirm(
    actor: Actor,
    bookingId: string,
    dto: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    try {
      const booking = await this.persist(actor, bookingId, dto);
      recordBookingConfirm('confirmed');
      this.logger.log(`booking ${bookingId}: confirmed`);
      return booking;
    } catch (error) {
      const outcome = outcomeOf(error);
      if (outcome) {
        recordBookingConfirm(outcome);
        this.logger.warn(`booking ${bookingId}: ${outcome}`);
      }
      throw error;
    }
  }

  private async persist(
    actor: Actor,
    bookingId: string,
    dto: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    const en = actor.language === 'en';
    try {
      return await this.prisma.$transaction((tx) =>
        this.store(tx, actor, bookingId, dto),
      );
    } catch (error) {
      const taken = exclusionOf(error);
      if (taken === 'lift' && dto.lift) throw liftBusy(dto.lift, en);
      if (taken === 'mechanic' && dto.mechanicId) {
        const mechanic = await this.prisma.mechanic.findUnique({
          where: { id: dto.mechanicId },
        });
        throw mechanicBusy(mechanic?.name ?? '', en);
      }
      throw error;
    }
  }

  // A mechanic is told no; anyone outside the booking's garage learns
  // nothing of it.
  private async garageOf(client: Tx, actor: Actor, bookingId: string) {
    if (actor.role === 'mechanic') {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Doar proprietarul sau recepția confirmă programările',
      );
    }
    requireCapability(actor, 'garage.requests');
    const booking = await client.booking.findUnique({
      select: { garageId: true },
      where: { id: bookingId },
    });
    if (!booking || booking.garageId !== actor.garageId) {
      throw new NotFoundException();
    }
    return booking.garageId;
  }

  private async switches(client: Tx, garageId: string): Promise<Switches> {
    const rows = await client.garageFeature.findMany({
      where: { garageId, key: { in: ['team_mechanics', 'lift_schedule'] } },
    });
    const on = (key: string) =>
      rows.find((row) => row.key === key)?.enabled ?? true;
    return { lifts: on('lift_schedule'), team: on('team_mechanics') };
  }

  // The mechanics a booking can be given: every mechanic row of the garage.
  private offered(client: Tx, garageId: string) {
    return client.mechanic.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      where: { garageId },
    });
  }

  private async store(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    dto: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    const garageId = await this.garageOf(tx, actor, bookingId);
    // Every confirm of the booking, and its lapse, waits here for the one
    // before it and is judged on what that one left.
    await tx.$queryRaw`
      SELECT id FROM booking WHERE id = ${bookingId}::uuid FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({
      include: { garage: true, request: true },
      where: { id: bookingId },
    });
    const now = new Date();
    if (booking.status !== 'awaiting_confirmation') {
      throw invalidTransition({
        currentStatus: booking.status,
        entity: 'booking',
        to: 'confirmed',
      });
    }
    if (booking.confirmBy <= now) {
      throw invalidTransition({
        currentStatus: 'lapsed',
        entity: 'booking',
        to: 'confirmed',
      });
    }
    const switches = await this.switches(tx, garageId);
    this.judgeFields(dto, switches);
    const mechanic = await this.mechanicOf(tx, garageId, dto.mechanicId);
    if (dto.lift !== undefined && dto.lift > booking.garage.liftCount) {
      throw invalidField(
        'lift',
        `lift must be from 1 to ${booking.garage.liftCount}`,
      );
    }
    const inside = await slotInsideHours(
      tx,
      booking.garage,
      booking.startsAt,
      booking.durationMinutes,
    );
    if (!inside) throw conflict('outside_hours', 'În afara programului');
    await this.judgeOverlaps(tx, actor, booking, mechanic, dto.lift);
    const worker =
      mechanic ?? (await this.ownerMechanic(tx, actor, booking.garage));
    await this.confirmBooking(tx, actor, booking, dto, now);
    await this.openJob(tx, actor, booking, worker.id);
    await this.closeRest(tx, actor, booking);
    const read = await tx.booking.findUniqueOrThrow({
      include: bookingMechanicInclude,
      where: { id: bookingId },
    });
    return garageBookingOf(read);
  }

  private judgeFields(dto: ConfirmBookingDto, switches: Switches) {
    if (switches.team && dto.mechanicId === undefined) {
      throw invalidField('mechanicId', 'mechanicId is required');
    }
    if (!switches.team && dto.mechanicId !== undefined) {
      throw invalidField(
        'mechanicId',
        'mechanicId is not taken: the garage works without a team',
      );
    }
    if (!switches.lifts && dto.lift !== undefined) {
      throw invalidField(
        'lift',
        'lift is not taken: the garage schedules without lifts',
      );
    }
  }

  private async mechanicOf(tx: Tx, garageId: string, mechanicId?: string) {
    if (mechanicId === undefined) return null;
    const mechanic = await tx.mechanic.findFirst({
      where: { garageId, id: mechanicId },
    });
    if (!mechanic) throw mechanicUnavailable();
    return mechanic;
  }

  // The read that names who or what is taken; the constraints still catch a
  // confirm that commits between this read and the write.
  private async judgeOverlaps(
    tx: Tx,
    actor: Actor,
    booking: Booking,
    mechanic: { id: string; name: string } | null,
    lift: number | undefined,
  ) {
    const en = actor.language === 'en';
    const overlaps = async (where: Prisma.BookingWhereInput) => {
      const rows = await tx.booking.findMany({
        select: { durationMinutes: true, startsAt: true },
        where: {
          ...where,
          id: { not: booking.id },
          startsAt: {
            lt: new Date(
              booking.startsAt.getTime() + booking.durationMinutes * MINUTE,
            ),
          },
          status: 'confirmed',
        },
      });
      return rows.some(
        (row) =>
          row.startsAt.getTime() + row.durationMinutes * MINUTE >
          booking.startsAt.getTime(),
      );
    };
    if (mechanic && (await overlaps({ mechanicId: mechanic.id }))) {
      throw mechanicBusy(mechanic.name, en);
    }
    if (
      lift !== undefined &&
      (await overlaps({ garageId: booking.garageId, lift }))
    ) {
      throw liftBusy(lift, en);
    }
  }

  // A garage without a team gives every job to its owner, through the
  // owner's own mechanic row, made at the first confirm.
  private async ownerMechanic(tx: Tx, actor: Actor, garage: Garage) {
    const member = await tx.garageMember.findFirstOrThrow({
      include: { account: true },
      where: { garageId: garage.id, role: 'owner' },
    });
    const own = await tx.mechanic.findUnique({
      where: { accountId: member.accountId },
    });
    if (own) {
      if (own.garageId !== garage.id) throw mechanicUnavailable();
      return own;
    }
    const created = await tx.mechanic.create({
      data: {
        accountId: member.accountId,
        canAnswerQuotes: true,
        canMoveBookings: true,
        canRecordFinalPrice: true,
        garageId: garage.id,
        name: member.account.name,
        onProfile: false,
      },
    });
    await this.audit.record(tx, {
      action: 'create',
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId: garage.id,
      newValue: { accountId: member.accountId, name: created.name },
      oldValue: null,
      subjectId: created.id,
      subjectType: 'mechanic',
    });
    return created;
  }

  private async confirmBooking(
    tx: Tx,
    actor: Actor,
    booking: Booking & { request: { driverId: string } },
    dto: ConfirmBookingDto,
    now: Date,
  ) {
    const by = { accountId: actor.accountId, role: actor.role };
    const entry = {
      action: 'update' as const,
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId: booking.garageId,
      oldValue: null,
      subjectId: booking.id,
      subjectType: 'booking',
    };
    if (dto.mechanicId !== undefined || dto.lift !== undefined) {
      await tx.booking.update({
        data: { lift: dto.lift, mechanicId: dto.mechanicId },
        where: { id: booking.id },
      });
    }
    if (dto.mechanicId !== undefined) {
      await this.audit.record(tx, {
        ...entry,
        field: 'mechanic_id',
        newValue: dto.mechanicId,
      });
    }
    if (dto.lift !== undefined) {
      await this.audit.record(tx, {
        ...entry,
        field: 'lift',
        newValue: dto.lift,
      });
    }
    const mechanicId = dto.mechanicId ?? null;
    await moveBooking(
      tx,
      { audit: this.audit, events: this.events },
      {
        actor: by,
        event: {
          audience: {
            driverAccountId: booking.driverId,
            garageId: booking.garageId,
            mechanicId,
            type: 'booking',
          },
          kind: 'booking.confirmed',
          payload: {
            bookingId: booking.id,
            confirmedAt: now.toISOString(),
            durationMinutes: booking.durationMinutes,
            lift: dto.lift ?? null,
            mechanicId,
            quoteId: booking.quoteId,
            requestId: booking.requestId,
            startsAt: booking.startsAt.toISOString(),
          },
        },
        id: booking.id,
        to: 'confirmed',
      },
    );
  }

  private async openJob(
    tx: Tx,
    actor: Actor,
    booking: Booking & { request: { carId: string } },
    mechanicId: string,
  ) {
    const job = await tx.job.create({
      data: {
        bookingId: booking.id,
        carId: booking.request.carId,
        driverId: booking.driverId,
        garageId: booking.garageId,
        mechanicId,
        stages: {
          create: {
            actorId: actor.accountId,
            actorRole: recordedRole(actor.role),
            fromStatus: null,
            toStatus: 'to_do',
          },
        },
      },
    });
    await this.audit.record(tx, {
      action: 'create',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'stage',
      garageId: booking.garageId,
      jobId: job.id,
      newValue: job.status,
      oldValue: null,
      subjectId: job.id,
      subjectType: 'job',
    });
  }

  // The request is taken: every other waiting quote has lost, every garage
  // still asked is no longer, and they all hear it once.
  private async closeRest(tx: Tx, actor: Actor, booking: Booking) {
    const by = { accountId: actor.accountId, role: actor.role };
    const ports = { audit: this.audit, events: noEvents };
    const audience = {
      driverAccountId: booking.driverId,
      garageId: booking.garageId,
      type: 'quote' as const,
    };
    const [quotes, recipients] = await Promise.all([
      tx.quote.findMany({
        orderBy: { id: 'asc' },
        where: { requestId: booking.requestId, status: 'waiting' },
      }),
      tx.requestRecipient.findMany({
        orderBy: { id: 'asc' },
        where: { requestId: booking.requestId, status: 'waiting' },
      }),
    ]);
    for (const quote of quotes) {
      await moveQuote(tx, ports, {
        actor: by,
        event: { audience, kind: 'quote.closed' },
        id: quote.id,
        to: 'lost',
      });
    }
    for (const recipient of recipients) {
      await moveRecipient(tx, ports, {
        actor: by,
        event: { audience, kind: 'quote.closed' },
        id: recipient.id,
        to: 'closed',
      });
    }
    const garageIds = [
      ...new Set([...quotes, ...recipients].map((row) => row.garageId)),
    ];
    if (garageIds.length === 0) return;
    await this.events.record(tx, {
      audience: {
        driverAccountId: booking.driverId,
        garageIds,
        type: 'request',
      },
      kind: 'quote.closed',
      payload: {
        quoteIds: quotes.map((quote) => quote.id),
        requestId: booking.requestId,
      },
      subjectId: booking.requestId,
    });
  }
}
