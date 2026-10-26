import { Logger } from '@nestjs/common';

import type { AuditPort } from '../../../audit/audit.port';
import type { EventPort } from '../../../events/event.port';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { DailyTask } from '../../../scheduler/daily';
import { recordStep } from '../transfers';
import { recordExpiries } from '../transfers.metrics';

// Once a day: every sent transfer at or past its expiry becomes expired, each
// in its own transaction with its entry and event. One that fails is logged
// by its id and left for the next day; one cancelled meanwhile stays so.
export class CarTransferExpirySweep implements DailyTask {
  private readonly logger = new Logger('CarTransferExpirySweep');

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditPort,
    private readonly events: EventPort,
  ) {}

  async run(now: Date): Promise<void> {
    const due = await this.prisma.carTransfer.findMany({
      select: { carId: true, id: true, sellerId: true },
      where: { expiresAt: { lte: now }, status: 'sent' },
    });
    let expired = 0;
    for (const transfer of due) {
      try {
        const moved = await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.carTransfer.updateMany({
            data: { status: 'expired' },
            where: { id: transfer.id, status: 'sent' },
          });
          if (count === 0) return false;
          await recordStep(
            tx,
            { audit: this.audit, events: this.events },
            transfer,
            'expired',
            { accountId: null, role: 'system' },
          );
          return true;
        });
        if (moved) expired += 1;
      } catch (error) {
        this.logger.error(
          `car transfer ${transfer.id} not expired: ${(error as Error).message}`,
        );
      }
    }
    this.logger.log(`expired ${expired} car transfers`);
    recordExpiries(expired);
  }
}
