import {
  type GarageQuoteDto,
  leiToBani,
  type SendQuoteDto,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { addLocalDays } from '../../bucharest';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import {
  Prisma,
  type PrismaClient,
  type Quote,
  type QuoteJob,
} from '../../generated/prisma/client';
import { QUOTE_VALIDITY_DAYS } from '../quotes-config';
import { quoteOf } from '../reads';
import { moveRecipient, moveRequest } from '../transitions';

type Tx = Prisma.TransactionClient;

// The garage's row of the request, locked so two sends are judged one
// after the other.
interface Target {
  recipient_id: string;
  recipient_status: string;
  request_status: string;
  driver_id: string;
  car_brand: string;
  garage_status: string;
}

const ANSWERING = new Set(['garage', 'receptionist', 'mechanic']);

const invalid = (field: string, code: string, message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code, field },
  ]);

const alreadyAnswered = () =>
  refusal(
    HttpStatus.CONFLICT,
    'already_answered',
    'Altcineva a răspuns deja la această cerere',
  );

const notOpen = () =>
  refusal(
    HttpStatus.CONFLICT,
    'request_not_open',
    'Cererea nu mai este deschisă',
  );

// What the body must hold beyond its own field rules.
function assertBody(dto: SendQuoteDto) {
  if (dto.fromLei > dto.toLei) {
    throw invalid('fromLei', 'low_above_high', 'fromLei is above toLei');
  }
  if (new Date(dto.slot).getTime() <= Date.now()) {
    throw invalid('slot', 'past', 'slot must be later than now');
  }
}

// A quote waits only on an open request the garage has not answered yet.
function judge(target: Target) {
  if (target.garage_status === 'suspended') throw notOpen();
  if (['quoted', 'declined'].includes(target.recipient_status)) {
    throw alreadyAnswered();
  }
  if (target.recipient_status !== 'waiting') throw notOpen();
  if (!['sent', 'quoted'].includes(target.request_status)) throw notOpen();
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// A garage's answer to a request: its price range, duration and slot, with
// the asked jobs it does. The quote, the moves, the event and the entry are
// written together or not at all.
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async send(
    actor: Actor,
    key: string,
    dto: SendQuoteDto,
  ): Promise<GarageQuoteDto> {
    const garageId = actor.garageId;
    if (!ANSWERING.has(actor.role) || !garageId) throw new NotFoundException();
    assertBody(dto);
    try {
      const { created, quote } = await this.prisma.$transaction((tx) =>
        this.store(tx, actor, garageId, key, dto),
      );
      if (created) this.logger.log(`quote sent: ${quote.id}`);
      return quoteOf(quote);
    } catch (error) {
      // The one quote per garage and request, kept by the database.
      if (isUniqueViolation(error)) throw alreadyAnswered();
      throw error;
    }
  }

  private async store(
    tx: Tx,
    actor: Actor,
    garageId: string,
    key: string,
    dto: SendQuoteDto,
  ): Promise<{ created: boolean; quote: Quote & { jobs: QuoteJob[] } }> {
    const [target] = await tx.$queryRaw<Target[]>`
      SELECT rr.id AS recipient_id, rr.status::text AS recipient_status,
             qr.status::text AS request_status, qr.driver_id, qr.car_brand,
             g.status::text AS garage_status
      FROM request_recipient rr
      JOIN quote_request qr ON qr.id = rr.request_id
      JOIN garage g ON g.id = rr.garage_id
      WHERE rr.request_id = ${dto.requestId}::uuid
        AND rr.garage_id = ${garageId}::uuid
      FOR UPDATE OF rr`;
    if (!target) throw new NotFoundException();
    if (actor.role === 'mechanic' && !actor.permissions.canAnswerQuotes) {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Nu ai dreptul să trimiți oferte',
      );
    }
    const sent = await tx.quote.findUnique({
      include: { jobs: true },
      where: { garageId_idempotencyKey: { garageId, idempotencyKey: key } },
    });
    if (sent) return { created: false, quote: sent };
    judge(target);
    const quote = await this.write(tx, actor, garageId, key, dto, target);
    await this.announce(tx, actor, garageId, dto, target, quote);
    return { created: true, quote };
  }

  // The quote with one row per asked job, included when the garage ticked
  // the job for the car's brand, and its entry, which never holds the note's
  // text.
  private async write(
    tx: Tx,
    actor: Actor,
    garageId: string,
    key: string,
    dto: SendQuoteDto,
    target: Target,
  ) {
    const asked = await tx.requestJob.findMany({
      orderBy: { position: 'asc' },
      where: { requestId: dto.requestId },
    });
    const ticks = await tx.garageBrandJob.findMany({
      select: { jobTypeId: true },
      where: {
        garageBrand: { brand: { name: target.car_brand } },
        garageId,
        jobTypeId: { in: asked.map((job) => job.jobTypeId) },
      },
    });
    const ticked = new Set(ticks.map((tick) => tick.jobTypeId));
    const sentAt = new Date();
    const quote = await tx.quote.create({
      data: {
        durationMinutes: dto.durationMinutes,
        expiresAt: addLocalDays(sentAt, QUOTE_VALIDITY_DAYS),
        fromBani: leiToBani(dto.fromLei),
        garageId,
        idempotencyKey: key,
        jobs: {
          create: asked.map((job) => ({
            included: ticked.has(job.jobTypeId),
            requestJobId: job.id,
          })),
        },
        note: dto.note ?? null,
        recipientId: target.recipient_id,
        requestId: dto.requestId,
        sentAt,
        slot: new Date(dto.slot),
        toBani: leiToBani(dto.toLei),
      },
      include: { jobs: true },
    });
    await this.audit.record(tx, {
      action: 'create',
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      newValue: {
        durationMinutes: dto.durationMinutes,
        fromLei: dto.fromLei,
        noteSet: quote.note !== null,
        slot: dto.slot,
        toLei: dto.toLei,
      },
      subjectId: quote.id,
      subjectType: 'quote',
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    });
    return quote;
  }

  // The recipient and the request move to quoted with their own entries;
  // the send itself has one event.
  private async announce(
    tx: Tx,
    actor: Actor,
    garageId: string,
    dto: SendQuoteDto,
    target: Target,
    quote: Quote,
  ) {
    const by = { accountId: actor.accountId, role: actor.role };
    const audience = {
      driverAccountId: target.driver_id,
      garageId,
      type: 'quote' as const,
    };
    const event = { audience, kind: 'quote.sent' as const };
    const ports = { audit: this.audit, events: noEvents };
    await moveRecipient(tx, ports, {
      actor: by,
      event,
      id: target.recipient_id,
      to: 'quoted',
    });
    if (target.request_status === 'sent') {
      await moveRequest(tx, ports, {
        actor: by,
        event,
        id: dto.requestId,
        to: 'quoted',
      });
    }
    await this.events.record(tx, {
      audience,
      kind: 'quote.sent',
      payload: {
        driverId: target.driver_id,
        garageId,
        quoteId: quote.id,
        requestId: dto.requestId,
      },
      subjectId: quote.id,
    });
  }
}
