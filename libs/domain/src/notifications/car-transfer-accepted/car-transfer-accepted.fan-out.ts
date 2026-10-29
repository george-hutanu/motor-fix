import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import type { PrismaClient } from '../../generated/prisma/client';
import { countCarTransferAcceptedNotice } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const CAR_TRANSFER_ACCEPTED_QUEUE = 'car-transfer-accepted';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const CAR_TRANSFER_ACCEPTED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const CAR_TRANSFER_ACCEPTED_CONSUMER = {
  jobs: CAR_TRANSFER_ACCEPTED_RUN,
  kinds: ['car_transfer.accepted'] as readonly EventKind[],
  queue: CAR_TRANSFER_ACCEPTED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface CarTransferAcceptedEvent {
  id: string;
  payload: {
    carId: string;
    sellerAccountId: string;
    transferId: string;
  };
  subjectId?: string;
}

// Tells the seller the buyer took the car over. Names the car, never the
// buyer. The service applies the seller's mute and the no-device fallback;
// the outbox event id keeps a retry from building anything twice.
@Injectable()
export class CarTransferAcceptedFanOut {
  private readonly logger = new Logger('CarTransferAccepted');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(
    job: Pick<Job<CarTransferAcceptedEvent>, 'data'>,
  ): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { carId, sellerAccountId, transferId } = payload ?? {};
    // A payload that names no car, seller or transfer can never succeed.
    if (![carId, sellerAccountId, transferId].every(isId)) {
      countCarTransferAcceptedNotice('skipped');
      this.logger.warn(`event ${eventId} names no transfer, nobody told`);
      return;
    }
    const [car, seller] = await Promise.all([
      this.prisma.car.findUnique({
        select: { brand: { select: { name: true } }, model: true },
        where: { id: carId },
      }),
      this.prisma.account.findUnique({
        select: { status: true },
        where: { id: sellerAccountId },
      }),
    ]);
    if (!car || !seller || seller.status === 'deleted') {
      countCarTransferAcceptedNotice('skipped');
      this.logger.log(`transfer ${transferId} car or seller gone, nobody told`);
      return;
    }
    const recipients = [sellerAccountId as string];
    const again = await this.notifications.announced(
      'CAR_TRANSFER_ACCEPTED',
      eventId,
      recipients,
    );
    const queued = await this.notifications.notify({
      eventId,
      kind: 'CAR_TRANSFER_ACCEPTED',
      params: {
        car: `${car.brand.name} ${car.model}`,
        link: `${this.config.webUrl}/app/driver?view=cars`,
      },
      recipients,
      subjectId: transferId as string,
    });
    // Nothing queued: the seller muted it, unless the event came again.
    if (queued > 0) countCarTransferAcceptedNotice('built');
    else if (!again) countCarTransferAcceptedNotice('muted');
    this.logger.log(`transfer ${transferId} takeover told to the seller`);
  }
}

const isId = (value: unknown): boolean =>
  typeof value === 'string' && isUUID(value);
