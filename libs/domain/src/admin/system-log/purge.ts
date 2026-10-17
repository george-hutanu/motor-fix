import { SYSTEM_LOG_RETENTION_DAYS } from '@motor-fix/contracts';

import type { PrismaClient } from '../../generated/prisma/client';

// The nightly purge deletes what is older than the retention.

export async function purgeSystemLog(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const before = new Date(
    now.getTime() - SYSTEM_LOG_RETENTION_DAYS * 86_400_000,
  );
  const { count } = await prisma.systemLogEntry.deleteMany({
    where: { at: { lt: before } },
  });
  return count;
}
