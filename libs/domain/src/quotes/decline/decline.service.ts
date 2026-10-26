import type {
  DeclineReasonCode,
  GarageRecipientDto,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import {
  Prisma,
  type PrismaClient,
  type RequestRecipient,
} from '../../generated/prisma/client';
import {
  ANSWERING,
  type AnswerTarget,
  answerOutcomeOf,
  judgeAnswer,
} from '../answers';
import { recordRequestDecline } from '../quotes/quotes.metrics';
import { moveRecipient } from '../transitions';

type Tx = Prisma.TransactionClient;

// What an assistant tells the person before declining: no phone, no plate.
export interface DeclinePreview {
  car: { brand: string; model: string; year: number };
  driverFirstName: string;
  garageName: string;
  receivedAt: Date;
}

type Target = AnswerTarget & {
  garage_id: string;
  car_brand: string;
  car_model: string;
  car_year: number;
  driver_name: string;
  garage_name: string;
  received_at: Date;
};

const iso = (at: Date | null) => at?.toISOString() ?? null;

const recipientAnswerOf = (row: RequestRecipient): GarageRecipientDto => ({
  answeredAt: iso(row.answeredAt),
  declinedAt: iso(row.declinedAt),
  declineReason: row.declineReason,
  source: row.source,
  status: row.status,
});

// A garage turning a request down with one of the four reasons. The move,
// its entry and the garage's event are written together or not at all; the
// driver hears of it only once the undo window has passed (DeclineWindow).
@Injectable()
export class DeclineService {
  private readonly logger = new Logger('Declines');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async decline(
    actor: Actor,
    requestId: string,
    reason: DeclineReasonCode,
  ): Promise<GarageRecipientDto> {
    try {
      return await this.prisma.$transaction((tx) =>
        this.run(tx, actor, requestId, reason),
      );
    } catch (error) {
      const outcome = answerOutcomeOf(error, 'invalid');
      if (outcome) {
        recordRequestDecline(outcome, reason);
        this.logger.warn(`decline of request ${requestId}: ${outcome}`);
      }
      throw error;
    }
  }

  // The decline's checks without a lock or a write, and what it concerns.
  async preview(actor: Actor, requestId: string): Promise<DeclinePreview> {
    const target = await this.target(this.prisma, actor, requestId, false);
    return {
      car: {
        brand: target.car_brand,
        model: target.car_model,
        year: target.car_year,
      },
      driverFirstName: target.driver_name.trim().split(/\s+/)[0] ?? '',
      garageName: target.garage_name,
      receivedAt: target.received_at,
    };
  }

  // The decline inside the caller's transaction: the screen's own, or an
  // assistant's confirmed one.
  async run(
    tx: Tx,
    actor: Actor,
    requestId: string,
    reason: DeclineReasonCode,
  ): Promise<GarageRecipientDto> {
    const row = await this.store(tx, actor, requestId, reason);
    recordRequestDecline('declined', reason);
    this.logger.log(`recipient ${row.id} of request ${requestId}: declined`);
    return recipientAnswerOf(row);
  }

  // The recipient row the actor's garage holds for the request, judged as
  // an answer would be; locked for the write when `lock` is set.
  private async target(
    db: Tx | PrismaClient,
    actor: Actor,
    requestId: string,
    lock: boolean,
  ): Promise<Target> {
    const garageId = actor.garageId;
    if (!ANSWERING.has(actor.role) || !garageId) throw new NotFoundException();
    const [target] = await db.$queryRaw<Target[]>`
      SELECT rr.id AS recipient_id, rr.status::text AS recipient_status,
             qr.status::text AS request_status, qr.driver_id,
             rr.garage_id, g.status::text AS garage_status, g.name AS garage_name,
             qr.car_brand, qr.car_model, qr.car_year,
             qr.created_at AS received_at, a.name AS driver_name
      FROM request_recipient rr
      JOIN quote_request qr ON qr.id = rr.request_id
      JOIN garage g ON g.id = rr.garage_id
      JOIN account a ON a.id = qr.driver_id
      WHERE rr.request_id = ${requestId}::uuid
        AND rr.garage_id = ${garageId}::uuid
      ${lock ? Prisma.sql`FOR UPDATE OF rr` : Prisma.empty}`;
    if (!target) throw new NotFoundException();
    if (actor.role === 'mechanic' && !actor.permissions.canAnswerQuotes) {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Nu ai dreptul să răspunzi la cereri',
      );
    }
    judgeAnswer(target);
    return target;
  }

  private async store(
    tx: Tx,
    actor: Actor,
    requestId: string,
    reason: DeclineReasonCode,
  ): Promise<RequestRecipient> {
    const target = await this.target(tx, actor, requestId, true);
    const garageId = target.garage_id;
    const payload = {
      driverId: target.driver_id,
      garageId,
      reason,
      recipientId: target.recipient_id,
      requestId,
    };
    await moveRecipient(
      tx,
      { audit: this.audit, events: this.events },
      {
        actor: {
          accountId: actor.accountId,
          role: actor.role,
          ...(actor.via === 'assistant' && {
            assistantGrantId: actor.assistantGrantId,
            requestId: actor.requestId,
          }),
        },
        declineReason: reason,
        event: {
          audience: { garageIds: [garageId], type: 'garage' },
          kind: 'request.declined',
          payload,
        },
        id: target.recipient_id,
        newValue: { reason, status: 'declined' },
        to: 'declined',
      },
    );
    return tx.requestRecipient.findUniqueOrThrow({
      where: { id: target.recipient_id },
    });
  }
}
