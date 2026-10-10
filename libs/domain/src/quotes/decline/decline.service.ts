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
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  Prisma,
  PrismaClient,
  RequestRecipient,
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
      const row = await this.prisma.$transaction((tx) =>
        this.store(tx, actor, requestId, reason),
      );
      recordRequestDecline('declined', reason);
      this.logger.log(`recipient ${row.id} of request ${requestId}: declined`);
      return recipientAnswerOf(row);
    } catch (error) {
      const outcome = answerOutcomeOf(error, 'invalid');
      if (outcome) {
        recordRequestDecline(outcome, reason);
        this.logger.warn(`decline of request ${requestId}: ${outcome}`);
      }
      throw error;
    }
  }

  private async store(
    tx: Tx,
    actor: Actor,
    requestId: string,
    reason: DeclineReasonCode,
  ): Promise<RequestRecipient> {
    const garageId = actor.garageId;
    if (!ANSWERING.has(actor.role) || !garageId) throw new NotFoundException();
    const [target] = await tx.$queryRaw<AnswerTarget[]>`
      SELECT rr.id AS recipient_id, rr.status::text AS recipient_status,
             qr.status::text AS request_status, qr.driver_id,
             g.status::text AS garage_status
      FROM request_recipient rr
      JOIN quote_request qr ON qr.id = rr.request_id
      JOIN garage g ON g.id = rr.garage_id
      WHERE rr.request_id = ${requestId}::uuid
        AND rr.garage_id = ${garageId}::uuid
      FOR UPDATE OF rr`;
    if (!target) throw new NotFoundException();
    if (actor.role === 'mechanic' && !actor.permissions.canAnswerQuotes) {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Nu ai dreptul să răspunzi la cereri',
      );
    }
    judgeAnswer(target);
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
