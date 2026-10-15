import type { AcceptQuoteDto, BookingDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import {
  type Garage,
  Prisma,
  type PrismaClient,
  type Quote,
} from '../../generated/prisma/client';
import { invalidTransition, uniqueConflict } from '../../transitions';
import {
  type QuoteAcceptOutcome,
  recordQuoteAccept,
} from '../quotes/quotes.metrics';
import { BOOKING_CONFIRM_LAPSE_HOURS } from '../quotes-config';
import { bookingOf } from '../reads';
import { moveQuote, moveRequest } from '../transitions';

type Tx = Prisma.TransactionClient;

export interface Accepted {
  // False when the key answered a booking made before.
  created: boolean;
  booking: BookingDto;
}

const HOUR = 3_600_000;
const HELD = ['awaiting_confirmation', 'confirmed'] as const;

const bookingPending = () =>
  refusal(
    HttpStatus.CONFLICT,
    'booking_pending',
    'Ai deja o programare în așteptare',
  );

const slotPassed = () =>
  refusal(HttpStatus.CONFLICT, 'slot_passed', 'Ora propusă a trecut');

const quoteIs = (currentStatus: string) =>
  invalidTransition({ currentStatus, entity: 'quote', to: 'accepted' });

// The refusals in the order the driver is told them: the quote's own state,
// a booking the request already holds, the request, then the quote's time
// and its garage.
function judge(
  quote: Quote & { garage: Garage },
  requestStatus: string,
  held: boolean,
  now: Date,
) {
  if (quote.status !== 'waiting') throw quoteIs(quote.status);
  if (held) throw bookingPending();
  if (requestStatus !== 'quoted') {
    throw invalidTransition({
      currentStatus: requestStatus,
      entity: 'quote_request',
      to: 'booked',
    });
  }
  if (quote.expiresAt <= now) throw quoteIs('expired');
  if (quote.slot <= now) throw slotPassed();
  if (quote.garage.status === 'suspended') throw quoteIs('withdrawn');
}

const OUTCOMES = new Set([
  'booking_pending',
  'slot_passed',
  'invalid_transition',
]);

function outcomeOf(error: unknown): QuoteAcceptOutcome | null {
  if (!(error instanceof HttpException)) return null;
  const { code } = error.getResponse() as { code?: string };
  if (code && OUTCOMES.has(code)) return code as QuoteAcceptOutcome;
  const status = error.getStatus();
  return status >= 400 && status < 500 ? 'refused' : null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// The driver takes one garage's quote: a booking waits for the garage's
// confirmation. The booking, both moves, their entries and the one event
// are written together or not at all.
@Injectable()
export class AcceptService {
  private readonly logger = new Logger('QuoteAccept');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async accept(
    actor: Actor,
    quoteId: string,
    key: string,
    dto: AcceptQuoteDto,
  ): Promise<Accepted> {
    try {
      const accepted = await this.persist(actor, quoteId, key, dto);
      const outcome = accepted.created ? 'accepted' : 'replayed';
      recordQuoteAccept(outcome);
      this.logger.log(
        `quote ${quoteId} booking ${accepted.booking.id}: ${outcome}`,
      );
      return accepted;
    } catch (error) {
      const outcome = outcomeOf(error);
      if (outcome) {
        recordQuoteAccept(outcome);
        this.logger.warn(`quote ${quoteId} booking -: ${outcome}`);
      }
      throw error;
    }
  }

  private async persist(
    actor: Actor,
    quoteId: string,
    key: string,
    dto: AcceptQuoteDto,
  ): Promise<Accepted> {
    requireCapability(actor, 'driver.requests');
    try {
      return await this.prisma.$transaction((tx) =>
        this.store(tx, actor, quoteId, key, dto),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The same key on another request at once: the other call's booking
      // is the answer.
      const booking = await this.replayOf(this.prisma, actor.accountId, key);
      if (!booking) throw error;
      return { booking, created: false };
    }
  }

  private async replayOf(client: Tx, driverId: string, key: string) {
    const booking = await client.booking.findUnique({
      include: { garage: true },
      where: { driverId_idempotencyKey: { driverId, idempotencyKey: key } },
    });
    return booking ? bookingOf(booking) : null;
  }

  private async store(
    tx: Tx,
    actor: Actor,
    quoteId: string,
    key: string,
    dto: AcceptQuoteDto,
  ): Promise<Accepted> {
    const replay = await this.replayOf(tx, actor.accountId, key);
    if (replay) return { booking: replay, created: false };
    const owned = await tx.quote.findUnique({
      select: { request: { select: { driverId: true } }, requestId: true },
      where: { id: quoteId },
    });
    if (owned?.request.driverId !== actor.accountId) {
      throw new NotFoundException();
    }
    const { requestId } = owned;
    // Every acceptance of the request waits here for the one before it, and
    // is judged on what that one left.
    const [request] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM quote_request
      WHERE id = ${requestId}::uuid FOR UPDATE`;
    const raced = await this.replayOf(tx, actor.accountId, key);
    if (raced) return { booking: raced, created: false };
    const quote = await tx.quote.findUniqueOrThrow({
      include: { garage: true },
      where: { id: quoteId },
    });
    const held = await tx.booking.count({
      where: { requestId, status: { in: [...HELD] } },
    });
    const now = new Date();
    judge(quote, request.status, held > 0, now);
    const historyShared = dto.historyShared ?? false;
    const booking = await this.book(tx, actor, quote, key, historyShared, now);
    await this.move(tx, actor, quote, booking.id, historyShared, now);
    return { booking: bookingOf(booking), created: true };
  }

  // The booking first, so the event can name it; the garage has a day to
  // confirm, or until the slot when that comes sooner.
  private async book(
    tx: Tx,
    actor: Actor,
    quote: Quote & { garage: Garage },
    key: string,
    historyShared: boolean,
    now: Date,
  ) {
    const lapse = now.getTime() + BOOKING_CONFIRM_LAPSE_HOURS * HOUR;
    const booking = await tx.booking
      .create({
        data: {
          confirmBy: new Date(Math.min(lapse, quote.slot.getTime())),
          driverId: actor.accountId,
          durationMinutes: quote.durationMinutes,
          garageId: quote.garageId,
          historyShared,
          idempotencyKey: key,
          quoteId: quote.id,
          requestId: quote.requestId,
          startsAt: quote.slot,
        },
        include: { garage: true },
      })
      .catch((error: unknown) => uniqueConflict(error, 'booking'));
    const entry = {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId: quote.garageId,
      subjectId: booking.id,
      subjectType: 'booking',
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    };
    await this.audit.record(tx, {
      ...entry,
      action: 'create',
      field: 'stage',
      newValue: booking.status,
      oldValue: null,
    });
    await this.audit.record(tx, {
      ...entry,
      action: 'update',
      field: 'history_shared',
      newValue: historyShared,
      oldValue: null,
    });
    return booking;
  }

  // The quote's move carries the one event both sides hear; the request's
  // move is filed without one of its own.
  private async move(
    tx: Tx,
    actor: Actor,
    quote: Quote,
    bookingId: string,
    historyShared: boolean,
    now: Date,
  ) {
    const by = {
      accountId: actor.accountId,
      role: actor.role,
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    };
    const audience = {
      driverAccountId: actor.accountId,
      garageId: quote.garageId,
      type: 'quote' as const,
    };
    const payload = {
      bookingId,
      historyShared,
      quoteId: quote.id,
      requestId: quote.requestId,
    };
    await moveQuote(
      tx,
      { audit: this.audit, events: this.events },
      {
        actor: by,
        at: now,
        event: { audience, kind: 'quote.accepted', payload },
        id: quote.id,
        to: 'accepted',
      },
    );
    await moveRequest(
      tx,
      { audit: this.audit, events: noEvents },
      {
        actor: by,
        event: { audience, kind: 'quote.accepted' },
        id: quote.requestId,
        to: 'booked',
      },
    );
  }
}
