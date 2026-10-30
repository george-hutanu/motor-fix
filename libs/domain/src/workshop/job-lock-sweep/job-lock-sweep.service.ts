import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { PRISMA } from '../../auth/prisma';
import { publishLive } from '../../events/live/live.hub';
import type { PrismaClient } from '../../generated/prisma/client';
import { countJobLock } from '../job-lock/job-lock.metrics';
import { type HeldLock, lockKey } from '../job-lock/job-lock.service';

const KEYS = 'job:lock:*';

// Redis decides who holds a job; this keeps the job's row in step with it.
// A key that ran out leaves its copy on the row: the sweep clears it and
// tells the job's readers. A key the row lost is written back.
@Injectable()
export class JobLockSweep {
  private readonly logger = new Logger('JobLockSweep');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  async sweep(): Promise<number> {
    const cleared = await this.clearExpired();
    await this.remirror();
    if (cleared) countJobLock('expired', cleared);
    return cleared;
  }

  private async clearExpired() {
    const mirrored = await this.prisma.job.findMany({
      select: {
        garageId: true,
        id: true,
        lockHolderId: true,
        mechanicId: true,
      },
      where: { lockHolderId: { not: null } },
    });
    let cleared = 0;
    for (const job of mirrored) {
      if (await this.redis.exists(lockKey(job.id))) continue;
      // Only the holder the sweep read: a take since then keeps its copy.
      const { count } = await this.prisma.job.updateMany({
        data: {
          lockHolderId: null,
          lockHolderRole: null,
          lockLastChangeAt: null,
          lockSince: null,
        },
        where: { id: job.id, lockHolderId: job.lockHolderId },
      });
      if (!count) continue;
      cleared++;
      await publishLive(
        this.redis,
        { at: new Date().toISOString(), id: job.id, kind: 'job.lock_changed' },
        [
          `garage:${job.garageId}`,
          ...(job.mechanicId ? [`mechanic:${job.mechanicId}`] : []),
        ],
      ).catch((error: Error) =>
        this.logger.warn(`job.lock_changed not sent: ${error.message}`),
      );
    }
    return cleared;
  }

  private async remirror() {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        KEYS,
        'COUNT',
        100,
      );
      cursor = next;
      for (const key of keys) {
        const stored = await this.redis.get(key);
        if (!stored) continue;
        const held: HeldLock = JSON.parse(stored);
        await this.prisma.job.updateMany({
          data: {
            lockHolderId: held.holderId,
            lockHolderRole: held.role,
            lockLastChangeAt: new Date(held.lastChangeAt),
            lockSince: new Date(held.since),
          },
          where: { id: key.slice(KEYS.length - 1), lockHolderId: null },
        });
      }
    } while (cursor !== '0');
  }
}
