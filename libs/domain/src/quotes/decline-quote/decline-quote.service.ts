import type { DeclinedQuoteDto } from '@motor-fix/contracts';
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
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  type QuoteDeclineOutcome,
  recordQuoteDecline,
} from '../quotes/quotes.metrics';
import { quoteRefused, SUSPENDED } from '../refusals';
import { moveQuote } from '../transitions';

type Tx = Prisma.TransactionClient;

const TO = 'declined_by_driver';

const outcomeOf = (error: unknown): QuoteDeclineOutcome | null => {
  if (!(error instanceof HttpException)) return null;
  const { code } = error.getResponse() as { code?: string };
  if (code === 'invalid_transition') return code;
  return error.getStatus() < 500 ? 'refused' : null;
};

// The driver turns one waiting quote down, without a reason and for good.
// The move, its entry and the event the garage hears are written together;
// the request keeps waiting for the other garages.
@Injectable()
export class DeclineQuoteService {
  private readonly logger = new Logger('QuoteDecline');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async decline(actor: Actor, quoteId: string): Promise<DeclinedQuoteDto> {
    try {
      requireCapability(actor, 'driver.requests');
      const declined = await this.prisma.$transaction((tx) =>
        this.store(tx, actor, quoteId),
      );
      recordQuoteDecline('declined');
      this.logger.log(`quote ${quoteId}: declined`);
      return declined;
    } catch (error) {
      const outcome = outcomeOf(error);
      if (outcome) {
        recordQuoteDecline(outcome);
        this.logger.warn(`quote ${quoteId}: ${outcome}`);
      }
      throw error;
    }
  }

  private async store(
    tx: Tx,
    actor: Actor,
    quoteId: string,
  ): Promise<DeclinedQuoteDto> {
    const quote = await tx.quote.findUnique({
      select: {
        expiresAt: true,
        garage: { select: { status: true } },
        garageId: true,
        request: { select: { driverId: true } },
        requestId: true,
        status: true,
      },
      where: { id: quoteId },
    });
    if (quote?.request.driverId !== actor.accountId) {
      throw new NotFoundException();
    }
    const at = new Date();
    // A quote past its validity is expired, whether or not the sweep has
    // moved it yet; a suspended garage's reads as withdrawn.
    if (quote.status === 'waiting' && quote.expiresAt <= at) {
      throw quoteRefused(actor, 'expired', TO);
    }
    if (quote.status === 'waiting' && quote.garage.status === 'suspended') {
      throw quoteRefused(actor, 'withdrawn', TO, SUSPENDED);
    }
    await moveQuote(
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
        at,
        event: {
          audience: {
            driverAccountId: actor.accountId,
            garageId: quote.garageId,
            type: 'quote',
          },
          kind: 'quote.declined_by_driver',
          payload: {
            garageId: quote.garageId,
            quoteId,
            requestId: quote.requestId,
          },
        },
        id: quoteId,
        to: TO,
      },
    ).catch((error: unknown) => {
      const body =
        error instanceof HttpException
          ? (error.getResponse() as { code?: string; currentStatus?: string })
          : {};
      if (body.code === 'invalid_transition' && body.currentStatus) {
        throw quoteRefused(actor, body.currentStatus, TO);
      }
      throw error;
    });
    return { declinedAt: at.toISOString(), id: quoteId, status: TO };
  }
}
