import type { RequestDto } from '@motor-fix/contracts';
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
import { recordCancellation } from '../quotes/quotes.metrics';
import { cancelRefused } from '../refusals';
import { RequestsService } from '../requests/requests.service';
import { moveQuote, moveRecipient, moveRequest } from '../transitions';

type Tx = Prisma.TransactionClient;

// A request still waiting for quotes, or holding some, can be cancelled; one
// already booked is cancelled through its booking.
const CANCELLABLE = ['sent', 'quoted'];

// The driver withdraws a request no garage has been booked on: every garage
// still answering is closed, every waiting quote lost, and the garages hear
// it once, all in one transaction.
@Injectable()
export class CancelRequestService {
  private readonly logger = new Logger('RequestCancel');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly requests: RequestsService,
  ) {}

  async cancel(actor: Actor, requestId: string): Promise<RequestDto> {
    requireCapability(actor, 'driver.requests');
    let garageIds: string[];
    try {
      garageIds = await this.prisma.$transaction((tx) =>
        this.store(tx, actor, requestId),
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        recordCancellation('request', 'refused', false);
        this.logger.warn(`request ${requestId}: cancel refused`);
      }
      throw error;
    }
    recordCancellation('request', 'cancelled', false);
    this.logger.log(
      `request ${requestId}: cancelled by the driver, garages ${garageIds.join(', ') || 'none'} told`,
    );
    return this.requests.get(actor, requestId);
  }

  private async store(tx: Tx, actor: Actor, requestId: string) {
    const [request] = await tx.$queryRaw<
      { driverId: string; status: string }[]
    >`
      SELECT driver_id AS "driverId", status::text AS status
      FROM quote_request WHERE id = ${requestId}::uuid FOR UPDATE`;
    if (request?.driverId !== actor.accountId) {
      throw new NotFoundException();
    }
    if (!CANCELLABLE.includes(request.status)) {
      throw cancelRefused(actor, 'quote_request', request.status);
    }
    const by: TransitionActor = {
      accountId: actor.accountId,
      role: actor.role,
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    };
    const silent = { audit: this.audit, events: noEvents };
    const recipients = await tx.requestRecipient.findMany({
      select: { garageId: true, id: true, status: true },
      where: { requestId, status: { in: ['waiting', 'quoted'] } },
    });
    const garageIds = recipients.map((r) => r.garageId);
    const event = {
      audience: {
        driverAccountId: actor.accountId,
        garageIds,
        type: 'request' as const,
      },
      kind: 'request.cancelled' as const,
    };
    for (const recipient of recipients.filter((r) => r.status === 'waiting')) {
      await moveRecipient(tx, silent, {
        actor: by,
        event,
        id: recipient.id,
        to: 'closed',
      });
    }
    const waiting = await tx.quote.findMany({
      select: { id: true },
      where: { requestId, status: 'waiting' },
    });
    for (const quote of waiting) {
      await moveQuote(tx, silent, {
        actor: by,
        event,
        id: quote.id,
        to: 'lost',
      });
    }
    await moveRequest(tx, silent, {
      actor: by,
      closedReason: 'cancelled',
      event,
      id: requestId,
      to: 'closed',
    });
    await this.events.record(tx, {
      ...event,
      payload: { garageIds, reason: 'driver', requestId },
      subjectId: requestId,
    });
    return garageIds;
  }
}
