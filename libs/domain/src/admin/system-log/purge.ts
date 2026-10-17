import type { PrismaClient } from '../../generated/prisma/client';

// How long an entry is kept: the nightly purge deletes what is older.
const RETENTION_DAYS = 90;

export async function purgeSystemLog(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.systemLogEntry.deleteMany({
    where: { at: { lt: before } },
  });
  return count;
}
