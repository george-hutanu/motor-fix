import type {
  ConfirmBookingDto,
  ConfirmOptionsDto,
  GarageBookingDto,
} from '@motor-fix/contracts';
import { todayInBucharest } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_PORT,
  type AuditPort,
  recordedRole,
} from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, assertGarage, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import type {
  Booking,
  Garage,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { invalidTransition } from '../../transitions';
import {
  ScheduleService,
  type Segment,
} from '../../workshop/schedule/schedule.service';
import { bookingMechanicInclude, garageBookingOf } from '../reads';
import { moveBooking, moveQuote, moveRecipient } from '../transitions';

type Tx = Prisma.TransactionClient;

const DEADLOCK_RUNS = 3;

const invalidField = (field: 'mechanicId' | 'lift', message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code: 'invalid', field },
  ]);

const conflict = (code: string, message: string) =>
  refusal(HttpStatus.CONFLICT, code, message);

const mechanicUnavailable = (en: boolean) =>
  conflict(
    'mechanic_unavailable',
    en ? 'The mechanic is not available' : 'Mecanicul nu e disponibil',
  );

// The overlap the database refused although the read before it found none:
// a confirm of another booking committed in between.
function slotTaken(error: unknown) {
  if (!(error instanceof Error)) return false;
  const said = `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
  return (
    said.includes('booking_segment_mechanic_excl') ||
    said.includes('booking_segment_lift_excl')
  );
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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly schedule: ScheduleService,
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
    // Whether any job the quote includes is done on a lift.
    const onLift = await this.prisma.quoteJob.count({
      where: {
        included: true,
        quote: { booking: { id: bookingId } },
        requestJob: { jobType: { needsLift: true } },
      },
    });
    return {
      liftCount: switches.lifts ? garage.liftCount : 0,
      mechanicRequired: switches.team,
      mechanics: mechanics.map(({ id, name }) => ({ id, name })),
      needsLift: onLift > 0,
    };
  }

  async confirm(
    actor: Actor,
    bookingId: string,
    dto: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    const en = actor.language === 'en';
    try {
      return await this.storeRetried(actor, bookingId, dto);
    } catch (error) {
      if (slotTaken(error)) {
        throw conflict(
          'slot_taken',
          en ? 'The slot was just taken' : 'Locul tocmai a fost ocupat',
        );
      }
      throw error;
    }
  }

  // Two confirms racing for one lift or mechanic can deadlock on the
  // exclusion constraints. Postgres aborts one; it runs again and then reads
  // the other's confirm, so the loser hears 409, not 500.
  private async storeRetried(
    actor: Actor,
    bookingId: string,
    dto: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    for (let run = 1; ; run++) {
      try {
        return await this.prisma.$transaction((tx) =>
          this.store(tx, actor, bookingId, dto),
        );
      } catch (error) {
        const deadlocked = (error as { code?: unknown }).code === 'P2034';
        if (!deadlocked || run === DEADLOCK_RUNS) throw error;
      }
    }
  }

  // Anyone outside the booking's garage learns nothing of it; a mechanic of
  // the garage is told no.
  private async garageOf(client: Tx, actor: Actor, bookingId: string) {
    const booking = await client.booking.findUnique({
      select: { garageId: true },
      where: { id: bookingId },
    });
    // A booking of another garage, or none, is not found, for a mechanic too.
    const garageId = booking?.garageId ?? '';
    assertGarage(actor, garageId);
    if (actor.role === 'mechanic') {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        actor.language === 'en'
          ? 'Only the owner or the front desk confirms bookings'
          : 'Doar proprietarul sau recepția confirmă programările',
      );
    }
    requireCapability(actor, 'garage.requests');
    return garageId;
  }

  private async switches(client: Tx, garageId: string): Promise<Switches> {
    const rows = await client.garageFeature.findMany({
      where: { garageId, key: { in: ['team_mechanics', 'lift_schedule'] } },
    });
    const on = (key: string) =>
      rows.find((row) => row.key === key)?.enabled ?? true;
    return { lifts: on('lift_schedule'), team: on('team_mechanics') };
  }

  // The mechanics a booking can be given: every card of the garage's team.
  private offered(client: Tx, garageId: string) {
    return client.mechanic.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      where: { garageId, removedAt: null },
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
    const en = actor.language === 'en';
    const mechanic = await this.mechanicOf(tx, garageId, en, dto.mechanicId);
    if (dto.lift !== undefined && dto.lift > booking.garage.liftCount) {
      throw invalidField(
        'lift',
        `lift must be from 1 to ${booking.garage.liftCount}`,
      );
    }
    const segments = await this.schedule.assertPlaceable(tx, {
      durationMinutes: booking.durationMinutes,
      garageId,
      language: en ? 'en' : 'ro',
      lift: dto.lift ?? null,
      mechanicId: mechanic?.id ?? null,
      startsAt: booking.startsAt,
    });
    const worker =
      mechanic ?? (await this.ownerMechanic(tx, actor, booking.garage));
    await this.confirmBooking(tx, actor, booking, dto, segments, now);
    await this.openJob(tx, actor, booking, worker.id);
    await this.closeRest(tx, actor, booking);
    const read = await tx.booking.findUniqueOrThrow({
      include: bookingMechanicInclude(todayInBucharest()),
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

  private async mechanicOf(
    tx: Tx,
    garageId: string,
    en: boolean,
    mechanicId?: string,
  ) {
    if (mechanicId === undefined) return null;
    const mechanic = await tx.mechanic.findFirst({
      where: { garageId, id: mechanicId, removedAt: null },
    });
    if (!mechanic) throw mechanicUnavailable(en);
    return mechanic;
  }

  // A garage without a team gives every job to its owner, through the
  // owner's own mechanic row, made at the first confirm.
  private async ownerMechanic(tx: Tx, actor: Actor, garage: Garage) {
    const member = await tx.garageMember.findFirstOrThrow({
      include: { account: true },
      where: { garageId: garage.id, role: 'owner' },
    });
    const ownRow = () =>
      tx.mechanic.findUnique({ where: { accountId: member.accountId } });
    let own = await ownRow();
    if (!own) {
      // Two first confirms of the garage's bookings make the row once: the
      // second waits here for the first and then reads its row.
      await tx.$queryRaw`
        SELECT id FROM garage WHERE id = ${garage.id}::uuid FOR NO KEY UPDATE`;
      own = await ownRow();
    }
    if (own) {
      if (own.garageId !== garage.id) {
        throw mechanicUnavailable(actor.language === 'en');
      }
      return own;
    }
    const created = await tx.mechanic.create({
      data: {
        accountId: member.accountId,
        canAnswerQuotes: true,
        canMoveBookings: true,
        canRecordFinalPrice: true,
        garageId: garage.id,
        isOwner: true,
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
    segments: readonly Segment[],
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
    await tx.bookingSegment.createMany({
      data: segments.map((segment) => ({
        ...segment,
        bookingId: booking.id,
        garageId: booking.garageId,
      })),
    });
    // Where the booking was put, as one entry: its segments follow from it.
    await this.audit.record(tx, {
      ...entry,
      field: 'placement',
      newValue: {
        durationMinutes: booking.durationMinutes,
        lift: dto.lift ?? null,
        mechanicId: dto.mechanicId ?? null,
        startsAt: booking.startsAt.toISOString(),
      },
    });
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
