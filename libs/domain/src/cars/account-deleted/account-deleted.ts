import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import { NOTIFICATIONS_PRISMA } from '../../notifications/notifications.service';

export const CAR_ACCOUNT_DELETED_QUEUE = 'car-account-deleted';

const RUN: JobsOptions = {
  attempts: 3,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

const KINDS: readonly EventKind[] = ['account.deleted'];

export const CAR_ACCOUNT_DELETED_CONSUMER = {
  jobs: RUN,
  kinds: KINDS,
  queue: CAR_ACCOUNT_DELETED_QUEUE,
};

export interface CarAccountDeletedEvent {
  id: string;
  kind: string;
  payload: { accountId?: string } & Record<string, unknown>;
  subjectId?: string;
}

// A deleted account's cars stay for the garages' history, without the plate
// that would name their driver.
@Injectable()
export class CarAccountDeleted {
  private readonly logger = new Logger('CarAccountDeleted');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async onEvent(job: Pick<Job<CarAccountDeletedEvent>, 'data'>) {
    const { kind, payload } = job.data;
    if (!KINDS.includes(kind as EventKind) || !payload.accountId) return;
    const { count } = await this.prisma.car.updateMany({
      data: { plate: null },
      where: { ownerId: payload.accountId, plate: { not: null } },
    });
    this.logger.log(`account ${payload.accountId}: ${count} plates cleared`);
  }
}
