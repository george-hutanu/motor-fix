import type {
  DeclineReasonCode,
  GarageRecipientDto,
} from '@motor-fix/contracts';
import {
  HttpException,
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
  type RequestDeclineOutcome,
  recordRequestDecline,
} from '../quotes/quotes.metrics';
import { moveRecipient } from '../transitions';

type Tx = Prisma.TransactionClient;

// The garage's row of the request, locked so a decline and a send, or two
// declines, are judged one after the other.
interface Target {
  recipient_id: string;
  recipient_status: string;
  request_status: string;
  driver_id: string;
  garage_status: string;
}

const ANSWERING = new Set(['garage', 'receptionist', 'mechanic']);

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

// A decline, as a quote, answers only an open request the garage has not
// answered yet.
function judge(target: Target) {
  if (target.garage_status === 'suspended') throw notOpen();
  if (['quoted', 'declined'].includes(target.recipient_status)) {
    throw alreadyAnswered();
  }
  if (target.recipient_status !== 'waiting') throw notOpen();
  if (!['sent', 'quoted'].includes(target.request_status)) throw notOpen();
}

// The two conflicts by name; any other client error (403, 404) as invalid.
function outcomeOf(error: unknown): RequestDeclineOutcome | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse() as { code?: string };
  if (body.code === 'already_answered') return 'already_answered';
  if (body.code === 'request_not_open') return 'request_not_open';
  const status = error.getStatus();
  return status >= 400 && status < 500 ? 'invalid' : null;
}

const iso = (at: Date | null) => at?.toISOString() ?? null;

export const recipientAnswerOf = (
  row: RequestRecipient,
): GarageRecipientDto => ({
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
      const outcome = outcomeOf(error);
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
    const [target] = await tx.$queryRaw<Target[]>`
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
    judge(target);
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
