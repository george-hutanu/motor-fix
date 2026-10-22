import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { loadGarageAccess } from '../../events/garage-access';
import type { PrismaClient } from '../../generated/prisma/client';
import { shortName } from '../../quotes/reads';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const REQUEST_CANCELLED_QUEUE = 'request-cancelled';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const REQUEST_CANCELLED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const REQUEST_CANCELLED_CONSUMER = {
  jobs: REQUEST_CANCELLED_RUN,
  kinds: ['request.cancelled'] as readonly EventKind[],
  queue: REQUEST_CANCELLED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface RequestCancelledEvent {
  id: string;
  payload: { garageIds: string[]; reason: string; requestId: string };
}

// Tells the owners and receptionists of every garage still holding the
// request that it is cancelled; mechanics and the driver are never told. The
// outbox event id keeps a retry or a second relay from building anything
// twice.
@Injectable()
export class RequestCancelledFanOut {
  private readonly logger = new Logger('RequestCancelled');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<RequestCancelledEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const request = await this.prisma.quoteRequest.findUnique({
      select: {
        carBrand: true,
        carModel: true,
        driver: { select: { name: true } },
      },
      where: { id: payload.requestId },
    });
    if (!request) {
      this.logger.log(`request ${payload.requestId} missing; nobody told`);
      return;
    }
    let queued = 0;
    for (const garageId of payload.garageIds) {
      const { owners, receptionists } = await this.access(garageId);
      const staff = [...new Set([...owners, ...receptionists])];
      if (!staff.length) continue;
      queued += await this.notifications.notify({
        eventId,
        garageId,
        kind: 'REQUEST_CANCELLED',
        params: {
          car: `${request.carBrand} ${request.carModel}`,
          driver: shortName(request.driver.name),
          link: `${this.config.webUrl}/app/garage/requests`,
          reason: payload.reason,
        },
        recipients: staff,
        subjectId: payload.requestId,
      });
    }
    this.logger.log(
      `request ${payload.requestId} cancellation told to ${payload.garageIds.length} garages, ${queued} queued`,
    );
  }
}
