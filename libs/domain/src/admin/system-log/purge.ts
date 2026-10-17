import type { PrismaClient } from '../../generated/prisma/client';

// How long an entry is kept (OD-33): the nightly purge deletes what is older.
export const RETENTION_DAYS = 90;

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
