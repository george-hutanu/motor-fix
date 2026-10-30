import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import type { PrismaClient } from '../../generated/prisma/client';
import { countRepairUpdatedNotice } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const REPAIR_UPDATED_QUEUE = 'repair-updated';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const REPAIR_UPDATED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const REPAIR_UPDATED_CONSUMER = {
  jobs: REPAIR_UPDATED_RUN,
  kinds: ['repair.updated'] as readonly EventKind[],
  queue: REPAIR_UPDATED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface RepairUpdatedEvent {
  id: string;
  payload: {
    by: string;
    ownerId: string | null;
    repairId: string;
  };
  subjectId?: string;
}

// Tells the car's owner the event names that a garage or an admin corrected
// one of its repairs; a driver's own edit tells nobody. The service applies
// the owner's mute and the no-device fallback; the outbox event id keeps a
// retry from building anything twice.
@Injectable()
export class RepairUpdatedFanOut {
  private readonly logger = new Logger('RepairUpdated');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<RepairUpdatedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { by, ownerId, repairId } = payload ?? {};
    // The driver's own edit, the repair a handover wrote (the job already
    // told the driver), or a car with no owner: nobody to tell.
    if (
      by === 'driver' ||
      by === 'system' ||
      !isId(ownerId) ||
      !isId(repairId)
    ) {
      countRepairUpdatedNotice('skipped');
      this.logger.log(`event ${eventId} has nobody to tell`);
      return;
    }
    const [repair, owner] = await Promise.all([
      this.prisma.repair.findUnique({
        select: {
          car: {
            select: {
              brand: { select: { name: true } },
              model: true,
              year: true,
            },
          },
          garage: { select: { name: true } },
          garageName: true,
        },
        where: { id: repairId },
      }),
      this.prisma.account.findUnique({
        select: { status: true },
        where: { id: ownerId as string },
      }),
    ]);
    if (!repair || !owner || owner.status === 'deleted') {
      countRepairUpdatedNotice('skipped');
      this.logger.log(`repair ${repairId} or its owner gone, nobody told`);
      return;
    }
    const recipients = [ownerId as string];
    const again = await this.notifications.announced(
      'REPAIR_UPDATED',
      eventId,
      recipients,
    );
    const { car } = repair;
    const queued = await this.notifications.notify({
      eventId,
      kind: 'REPAIR_UPDATED',
      params: {
        by,
        car: `${car.brand.name} ${car.model} ${car.year}`,
        // An admin corrects as MotorFix, whichever garage the repair names.
        garage:
          by === 'admin'
            ? 'MotorFix'
            : (repair.garage?.name ?? repair.garageName),
        link: `${this.config.webUrl}/app/driver?view=cars`,
      },
      recipients,
      subjectId: repairId as string,
    });
    // Nothing queued: the owner muted it, unless the event came again.
    if (queued > 0) countRepairUpdatedNotice('built');
    else if (!again) countRepairUpdatedNotice('muted');
    this.logger.log(`repair ${repairId} correction told to the owner`);
  }
}

const isId = (value: unknown): boolean =>
  typeof value === 'string' && isUUID(value);
